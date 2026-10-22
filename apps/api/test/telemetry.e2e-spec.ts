import type { INestApplication, Type } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  EventsConnectErrors,
  TELEMETRY_NAMESPACE,
  type TelemetryClientToServerEvents,
  TelemetryEvents,
  type TelemetryFrame,
  type TelemetryFrames,
  type TelemetryOverview,
  type TelemetryServerToClientEvents,
  type TelemetrySnapshot,
  type TelemetryStatus,
  type TelemetryWatchAck,
  type TelemetryWatchRequest,
} from '@occ/contracts';
import { io, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { AppModule as AppModuleClass } from '../src/app.module';
import { TokenVerifier } from '../src/auth/token-verifier';
import { type Env, validateEnv } from '../src/config/env.validation';
import { OffTelemetrySource } from '../src/telemetry/sources/off-telemetry-source';
import {
  bucketOf,
  partitionName,
  partitionRange,
  partitionsToEnsure,
} from '../src/telemetry/samples/sample-partitions';
import { TelemetryIngestService } from '../src/telemetry/ingest/telemetry-ingest.service';
import { LEADER_CHECK_MS, TelemetryLeader } from '../src/telemetry/ingest/telemetry-leader.service';
import { TelemetrySamplePartitions } from '../src/telemetry/samples/telemetry-sample-partitions.service';
import { TelemetrySampleWriter } from '../src/telemetry/samples/telemetry-sample-writer.service';
import type {
  AssetStatusReport,
  RawReading,
  TelemetrySource,
  Unsubscribe,
  UpstreamState,
} from '../src/telemetry/sources/telemetry-source';
import { TELEMETRY_SOURCE } from '../src/telemetry/sources/telemetry-source.provider';
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
    // The shortest retention the variable allows, read once when `AppModule` loads, so the
    // retention case below has a partition that is expired without waiting a week.
    process.env.TELEMETRY_RETENTION_DAYS = '1';

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

    describe('telemetry.watch', () => {
      /** Sends a watch and resolves with its acknowledgement; rejects when none comes in time. */
      const watch = (socket: TelemetrySocket, assets: unknown): Promise<TelemetryWatchAck> =>
        socket.timeout(5_000).emitWithAck(TelemetryEvents.Watch, assets as TelemetryWatchRequest);

      /** Every frame received, in order, whichever `telemetry.frames` packet carried it. */
      const frames = (received: Received[]): TelemetryFrame[] =>
        received
          .filter((message) => message.event === TelemetryEvents.Frames)
          .flatMap((message) => (message.payload as TelemetryFrames).frames);

      const snapshots = (received: Received[]): TelemetrySnapshot[] =>
        received
          .filter((message) => message.event === TelemetryEvents.Snapshot)
          .map((message) => message.payload as TelemetrySnapshot);

      it('streams frames of the watched asset, and none of another', async () => {
        const { socket, received } = await connect(app, await withToken());

        await expect(watch(socket, { assets: ['CT-01'] })).resolves.toEqual({
          accepted: ['CT-01'],
        });
        await eventually(
          () => frames(received).length,
          (count) => count >= 2,
          'two frames',
          15_000,
        );

        expect(frames(received).every((frame) => frame.assetCode === 'CT-01')).toBe(true);
      });

      it('streams frames of every asset of a set of two, not only the first that changed', async () => {
        const { socket, received } = await connect(app, await withToken());

        await expect(watch(socket, { assets: ['CT-01', 'CT-02'] })).resolves.toEqual({
          accepted: ['CT-01', 'CT-02'],
        });
        // The mock source makes both due on the same second: with one frame per asset in a tick,
        // Socket.IO discarded all but the first, and the second asset never arrived (V2-06.12).
        const count = (code: string) =>
          frames(received).filter((frame) => frame.assetCode === code).length;
        await eventually(
          () => Math.min(count('CT-01'), count('CT-02')),
          (least) => least >= 2,
          'two frames of each asset',
          15_000,
        );

        // Never an empty batch, and a packet holds at most one frame per watched asset.
        const packets = received
          .filter((message) => message.event === TelemetryEvents.Frames)
          .map((message) => (message.payload as TelemetryFrames).frames);
        for (const packet of packets) {
          expect(packet.length).toBeGreaterThan(0);
          expect(new Set(packet.map((frame) => frame.assetCode)).size).toBe(packet.length);
        }
      });

      it("stops the first set's frames when a second set is watched", async () => {
        const { socket, received } = await connect(app, await withToken());
        await watch(socket, { assets: ['CT-01'] });
        await eventually(
          () => frames(received).filter((frame) => frame.assetCode === 'CT-01').length,
          (count) => count >= 1,
          'a frame of CT-01',
          15_000,
        );

        await expect(watch(socket, { assets: ['CT-02'] })).resolves.toEqual({
          accepted: ['CT-02'],
        });
        // Frames sent before the rooms changed arrived before the acknowledgement.
        const afterSwitch = received.length;
        await eventually(
          () => frames(received).filter((frame) => frame.assetCode === 'CT-02').length,
          (count) => count >= 2,
          'two frames of CT-02',
          15_000,
        );

        const later = frames(received.slice(afterSwitch));
        expect(later.some((frame) => frame.assetCode === 'CT-01')).toBe(false);
      });

      it('keeps four of five codes, and leaves an unknown one out of the acknowledgement', async () => {
        const { socket } = await connect(app, await withToken());

        const ack = await watch(socket, {
          assets: ['XX-99', 'CT-01', 'CT-02', 'GEN-01', 'AHU-H1', 'FH-L1'],
        });

        expect(ack).toEqual({ accepted: ['CT-01', 'CT-02', 'GEN-01', 'AHU-H1'] });
      });

      it('sends the newly watched assets as a snapshot, and nothing when the set only shrinks', async () => {
        const { socket, received } = await connect(app, await withToken());

        await watch(socket, { assets: ['CT-01'] });
        expect(Object.keys(snapshots(received).at(-1)?.assets ?? {})).toEqual(['CT-01']);

        await watch(socket, { assets: ['CT-01', 'CT-02'] });
        expect(Object.keys(snapshots(received).at(-1)?.assets ?? {})).toEqual(['CT-02']);

        const before = snapshots(received).length;
        await watch(socket, { assets: ['CT-02'] });
        expect(snapshots(received)).toHaveLength(before);
      });

      it('carries only the keys that changed, and at most ten frames in any second', async () => {
        const { socket, received } = await connect(app, await withToken());
        await watch(socket, { assets: ['CT-01'] });
        // What the socket holds once the watch is answered: the snapshot that preceded the ack.
        const known: Record<string, unknown> = {
          ...snapshots(received).at(-1)?.assets['CT-01']?.values,
        };

        await eventually(
          () => frames(received).length,
          (count) => count >= 4,
          'four frames',
          20_000,
        );

        const seen = frames(received);
        for (const frame of seen) {
          expect(Object.keys(frame.values).length).toBeGreaterThan(0);
          for (const [key, value] of Object.entries(frame.values)) {
            // Present in a frame only because it differs from what the socket already had.
            expect(known[key]).not.toBe(value);
            known[key] = value;
          }
        }
        // One time per frame, so a packet counts for every frame it carries.
        const times = received
          .filter((message) => message.event === TelemetryEvents.Frames)
          .flatMap((message) => (message.payload as TelemetryFrames).frames.map(() => message.at));
        for (const t of times) {
          expect(
            times.filter((other) => other > t - 1_000 && other <= t).length,
          ).toBeLessThanOrEqual(10);
        }
      });

      it('does not apply a sixth watch within a second, and the first set keeps streaming', async () => {
        const { socket, received } = await connect(app, await withToken());

        // Back to back, so all six fall inside one second whatever the machine's load.
        const acks = await Promise.all([
          ...Array.from({ length: 5 }, () => watch(socket, { assets: ['CT-01'] })),
          watch(socket, { assets: ['CT-02'] }),
        ]);

        expect(acks.slice(0, 5)).toEqual(Array(5).fill({ accepted: ['CT-01'] }));
        expect(acks[5]).toEqual({ accepted: [] });
        await eventually(
          () => frames(received).filter((frame) => frame.assetCode === 'CT-01').length,
          (count) => count >= 2,
          'two frames of CT-01',
          15_000,
        );
        expect(frames(received).some((frame) => frame.assetCode === 'CT-02')).toBe(false);
      });

      it('lets a `viewer` watch', async () => {
        const { socket } = await connect(app, await withToken(['viewer']));

        await expect(watch(socket, { assets: ['CT-01'] })).resolves.toEqual({
          accepted: ['CT-01'],
        });
      });

      it.each([
        ['null', null],
        ['a number', 7],
        ['a string', 'CT-01'],
        ['an empty object', {}],
        ['`assets` as a string', { assets: 'CT-01' }],
        ['`assets` of things that are not codes', { assets: [1, null, {}] }],
      ])(
        'answers %s with an empty acknowledgement and keeps the socket',
        async (_name, payload) => {
          const { socket } = await connect(app, await withToken());

          await expect(watch(socket, payload)).resolves.toEqual({ accepted: [] });

          expect(socket.connected).toBe(true);
          // Still served afterwards.
          await expect(watch(socket, { assets: ['CT-01'] })).resolves.toEqual({
            accepted: ['CT-01'],
          });
        },
      );
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

  /**
   * Two apps on one database, as two API replicas would be (ADR-0008, ADR-0019). Each has its own
   * ingest state, gateway and leader, so the only thing between them is PostgreSQL. Both run the
   * `mock` source, so each leader's own timer is on from boot: which one wins is not assumed.
   */
  describe('with a second instance', () => {
    let appA: INestApplication;
    let appB: INestApplication;

    beforeAll(async () => {
      appA = await startApp(AppModule);
      appB = await startApp(AppModule);
    });

    afterAll(async () => {
      // Closing releases the lock; a session left behind would keep it for the next suite.
      await appB?.close();
      await appA?.close();
    });

    const leaders = () => [appA.get(TelemetryLeader), appB.get(TelemetryLeader)] as const;

    it('elects exactly one telemetry leader', async () => {
      await eventually(
        () => leaders().filter((leader) => leader.isLeading()).length,
        (leading) => leading === 1,
        'exactly one telemetry leader',
      );
    });

    it('hands the lead to the other instance when the leader lets go of it', async () => {
      await eventually(
        () => leaders().filter((leader) => leader.isLeading()).length,
        (leading) => leading === 1,
        'exactly one telemetry leader',
      );
      const [first, second] = leaders();
      const [leader, follower] = first.isLeading() ? [first, second] : [second, first];

      // What closing the app does first, so the case does not have to close it.
      await leader.beforeApplicationShutdown();

      expect(leader.isLeading()).toBe(false);
      // At the follower's next check: one interval and the time to take the lock.
      await eventually(
        () => follower.isLeading(),
        (leading) => leading,
        'the other instance to take the lead',
        LEADER_CHECK_MS * 2 + 2_000,
      );
    });
  });

  const DAY_MS = 86_400_000;

  /**
   * The reading history (ADR-0018, V2-06.9) through the whole app: the partitions, the rows the
   * leader's own timer writes, what retention drops, and one row per asset and bucket however the
   * flushes fall. The app runs the `mock` source, so its leader and writer timers are on.
   */
  describe('with sample history', () => {
    let app: INestApplication;
    let db: DataSource;
    let startedAt: Date;

    const partitionNames = async (): Promise<string[]> => {
      const rows: { name: string }[] = await db.query(
        `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
          WHERE i.inhparent = 'telemetry_sample'::regclass ORDER BY c.relname`,
      );
      return rows.map((row) => row.name);
    };

    const assetId = async (code: string): Promise<string> => {
      const rows: { id: string }[] = await db.query(`SELECT "id" FROM "asset" WHERE "code" = $1`, [
        code,
      ]);
      return rows[0]!.id;
    };

    beforeAll(async () => {
      startedAt = new Date();
      app = await startApp(AppModule);
      db = app.get(DataSource);
    });

    afterAll(async () => {
      await app?.close();
    });

    it('has the partitions of today and the next two days, and takes a row in each', async () => {
      // The migration made them on a fresh database, and the leader's first flush keeps them on a
      // long-lived one: either way they exist soon after boot.
      const days = partitionsToEnsure(new Date());
      await eventually(
        partitionNames,
        (names) => days.every((day) => names.includes(partitionName(day))),
        'the partitions of today and two days ahead',
        15_000,
      );

      const id = await assetId('CT-01');
      for (const day of days) {
        const { from } = partitionRange(day);
        // A bucket in the far part of the day, so it never meets a row the writer made.
        const bucket = new Date(Date.parse(from) + 23 * 3_600_000 + 59 * 60_000 + 55_000);
        await db.query(
          `INSERT INTO "telemetry_sample" ("asset_id", "bucket_at", "values") VALUES ($1, $2, '{}')`,
          [id, bucket.toISOString()],
        );
        await db.query(
          `DELETE FROM "telemetry_sample" WHERE "asset_id" = $1 AND "bucket_at" = $2`,
          [id, bucket.toISOString()],
        );
      }
    });

    it('writes rows for assets, on 5 s buckets, with keys of the asset class', async () => {
      const rows = await eventually(
        () =>
          db.query(
            `SELECT s."bucket_at", s."values", a."code",
                      ARRAY(SELECT p."key" FROM "telemetry_point" p
                             WHERE p."asset_class_id" = a."asset_class_id") AS "pointKeys"
                 FROM "telemetry_sample" s JOIN "asset" a ON a."id" = s."asset_id"
                WHERE s."bucket_at" >= $1 ORDER BY s."bucket_at" DESC LIMIT 50`,
            [startedAt.toISOString()],
          ) as Promise<
            Array<{
              bucket_at: Date;
              values: Record<string, unknown>;
              code: string;
              pointKeys: string[];
            }>
          >,
        (found) => found.length > 0,
        'sample rows written by the leader',
        25_000,
      );

      for (const row of rows) {
        expect(row.bucket_at.getTime() % 5_000).toBe(0);
        const keys = Object.keys(row.values);
        expect(keys.length).toBeGreaterThan(0);
        expect(row.pointKeys).toEqual(expect.arrayContaining(keys));
      }
    }, 35_000);

    it('drops a partition past the retention and keeps the ones within it', async () => {
      const now = new Date();
      const expired = new Date(now.getTime() - 3 * DAY_MS);
      const yesterday = new Date(now.getTime() - DAY_MS);
      // Only what this case makes is dropped by it: on a database a leader has kept, yesterday's
      // partition may be a real one with rows.
      const made: string[] = [];
      const create = async (day: Date) => {
        const name = partitionName(day);
        if ((await partitionNames()).includes(name)) return;
        const { from, to } = partitionRange(day);
        await db.query(
          `CREATE TABLE "${name}" PARTITION OF "telemetry_sample"
             FOR VALUES FROM ('${from}') TO ('${to}')`,
        );
        made.push(name);
      };
      await create(expired);
      await create(yesterday);

      try {
        // Retention is 1 day here: yesterday and today are kept, the day before it is not.
        await app.get(TelemetrySamplePartitions).maintain(now);

        const names = await partitionNames();
        expect(names).not.toContain(partitionName(expired));
        expect(names).toContain(partitionName(yesterday));
        expect(names).toContain(partitionName(now));
      } finally {
        for (const name of made) await db.query(`DROP TABLE IF EXISTS "${name}"`);
      }
    });
  });

  /**
   * The writer driven by hand: its timer is stopped, so the only flushes are the ones the case
   * makes, and which bucket they fall in is the case's choice.
   */
  describe('with the writer driven by hand', () => {
    let app: INestApplication;
    let db: DataSource;

    beforeAll(async () => {
      app = await startApp(AppModule);
      db = app.get(DataSource);
      await eventually(
        () => app.get(TelemetryLeader).isLeading(),
        (leading) => leading,
        'the telemetry leader',
      );
      // Stops the timer and waits for a flush in flight: nothing else writes from here on.
      await app.get(TelemetrySampleWriter).beforeApplicationShutdown();
    });

    afterAll(async () => {
      await app?.close();
    });

    it('merges two flushes of one bucket into one row that holds the keys of both', async () => {
      const writer = app.get(TelemetrySampleWriter);
      const ingest = app.get(TelemetryIngestService);
      const points: { key: string; min: number | null }[] = await db.query(
        `SELECT p."key", p."min" FROM "asset" a
           JOIN "telemetry_point" p ON p."asset_class_id" = a."asset_class_id"
          WHERE a."code" = 'CT-01' AND p."kind" = 'number' ORDER BY p."key" LIMIT 2`,
      );
      expect(points).toHaveLength(2);
      const [first, second] = points as [(typeof points)[number], (typeof points)[number]];

      // The first leading flush keeps the partitions and starts the cursor; it writes nothing.
      const boundary = bucketOf(new Date());
      await writer.flush(new Date(boundary.getTime() + 1_000));

      ingest.ingest({ assetCode: 'CT-01', values: { [first.key]: first.min ?? 0 } });
      await writer.flush(new Date(boundary.getTime() + 1_500));
      ingest.ingest({ assetCode: 'CT-01', values: { [second.key]: second.min ?? 0 } });
      await writer.flush(new Date(boundary.getTime() + 3_500));

      const rows: { values: Record<string, unknown> }[] = await db.query(
        `SELECT s."values" FROM "telemetry_sample" s JOIN "asset" a ON a."id" = s."asset_id"
          WHERE a."code" = 'CT-01' AND s."bucket_at" = $1`,
        [boundary.toISOString()],
      );
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0]!.values)).toEqual(expect.arrayContaining([first.key, second.key]));
    });
  });

  /**
   * Two replicas on one database: the lock decides who writes, and the primary key makes a second
   * row for one asset and bucket impossible, so a failover cannot duplicate (ADR-0019).
   */
  describe('with a second instance writing', () => {
    let apps: INestApplication[];
    let inserts: Map<INestApplication, jest.SpyInstance>;

    const insertsOf = (target: INestApplication) =>
      inserts
        .get(target)!
        .mock.calls.filter(
          ([sql]) => typeof sql === 'string' && sql.startsWith('INSERT INTO "telemetry_sample"'),
        ).length;

    const leading = () => apps.filter((target) => target.get(TelemetryLeader).isLeading());

    beforeAll(async () => {
      apps = [await startApp(AppModule), await startApp(AppModule)];
      inserts = new Map(
        apps.map((target) => [target, jest.spyOn(target.get(DataSource), 'query')] as const),
      );
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      for (const target of apps.reverse()) await target?.close();
    });

    it('writes from the leader only', async () => {
      await eventually(
        () => leading().length,
        (count) => count === 1,
        'exactly one telemetry leader',
      );
      const [leader] = leading() as [INestApplication];
      const follower = apps.find((target) => target !== leader)!;

      await eventually(
        () => insertsOf(leader),
        (count) => count > 0,
        'the leader to write',
        30_000,
      );

      expect(insertsOf(follower)).toBe(0);
    }, 45_000);

    it('continues from the other instance after the leader lets go, with no row twice', async () => {
      const [leader] = leading() as [INestApplication];
      const follower = apps.find((target) => target !== leader)!;

      // What closing the app does first, so the case does not have to close it.
      await leader.get(TelemetryLeader).beforeApplicationShutdown();

      await eventually(
        () => insertsOf(follower),
        (count) => count > 0,
        'the other instance to write',
        45_000,
      );

      // The released replica no longer writes, whatever its timer does.
      const stopped = insertsOf(leader);
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      expect(insertsOf(leader)).toBe(stopped);

      const duplicates = await follower.get(DataSource).query(
        `SELECT "asset_id", "bucket_at" FROM "telemetry_sample"
              GROUP BY "asset_id", "bucket_at" HAVING count(*) > 1`,
      );
      expect(duplicates).toEqual([]);
    }, 75_000);
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
