import type { INestApplication, Type } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  EventsConnectErrors,
  TELEMETRY_NAMESPACE,
  type TelemetryClientToServerEvents,
  TelemetryEvents,
  type TelemetryOverview,
  type TelemetryServerToClientEvents,
  type TelemetrySnapshot,
  type TelemetryStatus,
} from '@occ/contracts';
import { io, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client';
import request from 'supertest';
import type { AppModule as AppModuleClass } from '../src/app.module';
import { TokenVerifier } from '../src/auth/token-verifier';
import { type Env, validateEnv } from '../src/config/env.validation';
import { OffTelemetrySource } from '../src/telemetry/off-telemetry-source';
import { TelemetryIngestService } from '../src/telemetry/telemetry-ingest.service';
import type {
  AssetStatusReport,
  RawReading,
  TelemetrySource,
  Unsubscribe,
  UpstreamState,
} from '../src/telemetry/telemetry-source';
import { TELEMETRY_SOURCE } from '../src/telemetry/telemetry-source.provider';
import { assertTestDatabase, eventually, startApp, unusedPort } from './support/app';
import { signToken, unsignedToken } from './support/tokens';

type TelemetrySocket = Socket<TelemetryServerToClientEvents, TelemetryClientToServerEvents>;

/** Everything a socket was sent, in order, recorded from before it connected. */
interface Received {
  event: string;
  payload: unknown;
  at: number;
}

const ROLES = ['operator', 'supervisor', 'technician', 'viewer'] as const;

/**
 * The `/telemetry` namespace through the whole app (ADR-0019): the handshake and its refusals, a
 * snapshot and the status on connect, the overview about every second, and the status following
 * the source. Delivery to a console that cannot keep up is a property of the transport, proved in
 * the gateway's unit spec by the emit path, not here.
 *
 * `AppModule` validates the environment when it is imported, so the source is set to `mock` first
 * and the module is loaded afterwards. A file-level setup migrates and seeds once and closes that
 * app; every `describe` then boots its own, so one app is alive at a time and each finds the
 * catalogue when its ingest service reads it at start.
 */
describe('Telemetry namespace (e2e)', () => {
  let AppModule: Type<unknown>;
  const sockets: TelemetrySocket[] = [];

  beforeAll(async () => {
    process.env.TELEMETRY_SOURCE = 'mock';

    // A `require`, not a static import: loading the module loads `.env.test` into `process.env`
    // and validates it, which must already say `mock`. Under `module: nodenext` an `import()`
    // needs a file extension that Jest has no `.js` for. The static `import type` is erased.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ AppModule } = require('../src/app.module') as { AppModule: typeof AppModuleClass });
    assertTestDatabase(validateEnv(process.env).DB_NAME);

    await (await startApp(AppModule)).close();
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.close();
  });

  /** Connects to an app's `/telemetry`. Rejects, and closes the client, if the handshake is refused. */
  async function connect(
    target: INestApplication,
    options: Partial<ManagerOptions & SocketOptions> = {},
  ): Promise<{ socket: TelemetrySocket; received: Received[] }> {
    const url = (await target.getUrl()).replace('[::1]', 'localhost');
    const socket: TelemetrySocket = io(`${url}${TELEMETRY_NAMESPACE}`, {
      transports: ['websocket'],
      reconnection: false,
      ...options,
    });
    sockets.push(socket);
    const received: Received[] = [];
    // Before `connect` resolves: the server sends the snapshot as soon as the socket is in.
    socket.onAny((event: string, payload: unknown) => {
      received.push({ event, payload, at: Date.now() });
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', (error) => {
        socket.close();
        reject(error);
      });
    });
    return { socket, received };
  }

  const withToken = async (roles?: string[] | null) => ({
    auth: { token: await signToken(roles === undefined ? {} : { roles }) },
  });

  describe('with the mock source', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await startApp(AppModule);
      const ingest = app.get(TelemetryIngestService);
      // `start()` is not awaited by the ingest service: wait until there is something to snapshot.
      await eventually(
        () => Object.keys(ingest.latestState()).length,
        (held) => held > 0,
        'readings held by the ingest service',
      );
    });

    afterAll(async () => {
      await app?.close();
    });

    describe('the handshake', () => {
      it.each([
        ['no token', async () => ({}), EventsConnectErrors.Unauthorized],
        [
          'a token signed by another key',
          async () => ({ auth: { token: await signToken({ key: 'other' }) } }),
          EventsConnectErrors.Unauthorized,
        ],
        [
          'an unsigned token',
          async () => ({ auth: { token: unsignedToken() } }),
          EventsConnectErrors.Unauthorized,
        ],
        [
          'an expired token',
          async () => ({ auth: { token: await signToken({ expiresIn: -60 }) } }),
          EventsConnectErrors.Unauthorized,
        ],
        ['a token with no role claim', () => withToken(null), EventsConnectErrors.Forbidden],
        ['a token with an unknown role', () => withToken(['guest']), EventsConnectErrors.Forbidden],
      ])('refuses %s with its `EventsConnectErrors` message', async (_name, options, message) => {
        await expect(connect(app, await options())).rejects.toThrow(message);
      });

      it.each(ROLES)('lets a `%s` in and sends it a snapshot', async (role) => {
        const { received } = await connect(app, await withToken([role]));

        await eventually(
          () => received.map((message) => message.event),
          (events) => events.includes(TelemetryEvents.Snapshot),
          'a snapshot',
        );
      });
    });

    describe('on connect', () => {
      it('sends the snapshot first, then the status, to a socket that just connected', async () => {
        const { received } = await connect(app, await withToken());

        await eventually(
          () => received.length,
          (count) => count >= 2,
          'a snapshot and a status',
        );
        expect(received[0]?.event).toBe(TelemetryEvents.Snapshot);
        expect(received[1]?.event).toBe(TelemetryEvents.Status);

        const snapshot = received[0]?.payload as TelemetrySnapshot;
        expect(Number.isNaN(Date.parse(snapshot.at))).toBe(false);
        const held = Object.values(snapshot.assets);
        expect(held.length).toBeGreaterThan(0);
        expect(held[0]).toEqual({
          online: true,
          receivedAt: expect.any(String),
          values: expect.any(Object),
        });
        // The mock source is up, and it had said so before this socket connected.
        expect(received[1]?.payload).toMatchObject({ upstream: 'live' });
      });
    });

    describe('the overview', () => {
      it('arrives about once a second, with the headline of each asset that has a reading', async () => {
        const { received } = await connect(app, await withToken());
        const overviews = () =>
          received.filter((message) => message.event === TelemetryEvents.Overview);

        await eventually(
          () => overviews().length,
          (count) => count >= 3,
          'three overviews',
          15_000,
        );

        // Not an exact period: a loaded machine delays a tick, and the first one depends on when
        // the socket connected within the timer's second.
        const times = overviews().map((message) => message.at);
        for (let i = 1; i < 3; i++) {
          const gap = (times[i] ?? 0) - (times[i - 1] ?? 0);
          expect(gap).toBeGreaterThan(500);
          expect(gap).toBeLessThan(2_000);
        }
        const overview = overviews()[0]?.payload as TelemetryOverview;
        expect(Number.isNaN(Date.parse(overview.at))).toBe(false);
        expect(Object.values(overview.assets)[0]).toEqual({
          online: true,
          receivedAt: expect.any(String),
          headline: expect.any(Object),
        });
      });
    });
  });

  describe('with the `off` source', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await startApp(AppModule, (builder) =>
        builder.overrideProvider(TELEMETRY_SOURCE).useValue(new OffTelemetrySource()),
      );
    });

    afterAll(async () => {
      await app?.close();
    });

    it('sends an empty snapshot and an empty overview, rather than failing', async () => {
      const { received } = await connect(app, await withToken());

      await eventually(
        () => received.map((message) => message.event),
        (events) => events.includes(TelemetryEvents.Overview),
        'an overview',
        15_000,
      );

      const snapshot = received.find((m) => m.event === TelemetryEvents.Snapshot)?.payload;
      const overview = received.find((m) => m.event === TelemetryEvents.Overview)?.payload;
      const status = received.find((m) => m.event === TelemetryEvents.Status)?.payload;
      expect(snapshot).toMatchObject({ assets: {} });
      expect(overview).toMatchObject({ assets: {} });
      // `off` reports live: no consumer is waiting on a connection that could be down.
      expect(status).toMatchObject({ upstream: 'live' });
    });
  });

  /** The port, with the source's state in the test's hands (ADR-0019: "a test double of the port"). */
  class ControllableSource implements TelemetrySource {
    readonly kind = 'controllable';
    private readonly upstreams = new Set<(state: UpstreamState) => void>();

    async start(): Promise<void> {
      // Reports nothing: the ingest service holds `paused` until `report` says otherwise.
    }

    async stop(): Promise<void> {
      // Nothing is held.
    }

    onReading(_listener: (reading: RawReading) => void): Unsubscribe {
      return () => undefined;
    }

    onStatus(_listener: (report: AssetStatusReport) => void): Unsubscribe {
      return () => undefined;
    }

    onUpstream(listener: (state: UpstreamState) => void): Unsubscribe {
      this.upstreams.add(listener);
      return () => {
        this.upstreams.delete(listener);
      };
    }

    report(upstream: UpstreamState['upstream']): UpstreamState {
      const state: UpstreamState = { upstream, since: new Date().toISOString() };
      for (const listener of [...this.upstreams]) listener(state);
      return state;
    }
  }

  describe('with a source whose connection the test controls', () => {
    let app: INestApplication;
    let source: ControllableSource;

    beforeAll(async () => {
      source = new ControllableSource();
      app = await startApp(AppModule, (builder) =>
        builder.overrideProvider(TELEMETRY_SOURCE).useValue(source),
      );
    });

    afterAll(async () => {
      await app?.close();
    });

    const statuses = (received: Received[]) =>
      received
        .filter((message) => message.event === TelemetryEvents.Status)
        .map((message) => message.payload as TelemetryStatus);

    it('tells a console that connects before the source has reported that it is paused', async () => {
      const { received } = await connect(app, await withToken());

      await eventually(
        () => statuses(received),
        (all) => all.length >= 1,
        'a status',
      );
      expect(statuses(received)[0]).toMatchObject({ upstream: 'paused' });
    });

    it('follows the source, and stays ready while it is paused', async () => {
      const { received } = await connect(app, await withToken());
      await eventually(
        () => statuses(received).length,
        (count) => count >= 1,
        'the status on connect',
      );

      const live = source.report('live');
      await eventually(
        () => statuses(received),
        (all) => all.some((status) => status.upstream === 'live'),
        'live',
      );
      expect(statuses(received).at(-1)).toEqual(live);
      await request(app.getHttpServer()).get('/api/health/ready').expect(200);

      const paused = source.report('paused');
      await eventually(
        () => statuses(received).at(-1),
        (status) => status?.upstream === 'paused',
        'paused',
      );
      expect(statuses(received).at(-1)).toEqual(paused);
      // A telemetry outage is not a readiness failure: the replica still serves incidents (ADR-0013).
      await request(app.getHttpServer()).get('/api/health/ready').expect(200);
    });

    it('tells a console that connects later the state the source has now', async () => {
      const live = source.report('live');

      const { received } = await connect(app, await withToken());

      await eventually(
        () => statuses(received),
        (all) => all.length >= 1,
        'a status',
      );
      expect(statuses(received)[0]).toEqual(live);
    });
  });

  describe('with the identity provider unreachable', () => {
    let app: INestApplication;

    beforeAll(async () => {
      // The real `TokenVerifier`, pointed at a port nothing listens on (as `incidents.e2e-spec.ts`).
      const deadJwksUrl = `http://127.0.0.1:${await unusedPort()}/certs`;
      const config = {
        get: (name: keyof Env) => (name === 'OIDC_JWKS_URL' ? deadJwksUrl : process.env[name]),
      } as unknown as ConfigService<Env, true>;
      app = await startApp(AppModule, (builder) =>
        builder.overrideProvider(TokenVerifier).useValue(new TokenVerifier(config)),
      );
    });

    afterAll(async () => {
      await app?.close();
    });

    it('refuses the handshake with "Identity provider unavailable"', async () => {
      await expect(connect(app, await withToken())).rejects.toThrow(
        EventsConnectErrors.IdentityProviderUnavailable,
      );
    });
  });
});
