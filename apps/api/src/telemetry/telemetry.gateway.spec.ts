import { Registry } from '@prometheus-io/client';
import { TelemetryEvents } from '@occ/contracts';
import { TelemetryMetrics } from '../metrics/telemetry.metrics';
import type { SocketAuth } from '../realtime/socket-auth';
import { TelemetryGateway } from './telemetry.gateway';
import type { TelemetryIngestService } from './telemetry-ingest.service';
import type { UpstreamState } from './telemetry-source';

const NOW = Date.parse('2026-10-13T08:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const SINCE = iso(NOW - 60_000);

type Namespace = Parameters<TelemetryGateway['afterInit']>[0];
type Client = Parameters<TelemetryGateway['handleConnection']>[0];

/** The namespace as the gateway uses it: sockets to count, a middleware slot, two emit paths. */
function fakeNamespace() {
  const emit = jest.fn();
  const volatileEmit = jest.fn();
  const use = jest.fn();
  const sockets = new Map<string, unknown>();
  const namespace = { sockets, use, emit, volatile: { emit: volatileEmit } };
  return { namespace: namespace as unknown as Namespace, sockets, emit, volatileEmit, use };
}

/** The ingest service's reads, with the one upstream listener the gateway registers. */
function fakeIngest() {
  let listener: ((state: UpstreamState) => void) | undefined;
  const unsubscribe = jest.fn(() => {
    listener = undefined;
  });
  const ingest = {
    latestState: jest.fn((): Record<string, unknown> => ({})),
    overview: jest.fn((): Record<string, unknown> => ({})),
    upstream: jest.fn((): UpstreamState => ({ upstream: 'paused', since: SINCE })),
    onUpstream: jest.fn((next: (state: UpstreamState) => void) => {
      listener = next;
      return unsubscribe;
    }),
  };
  return {
    ingest,
    unsubscribe,
    report: (state: UpstreamState) => listener?.(state),
    listening: () => listener !== undefined,
  };
}

function fakeClient(id = 'socket-1') {
  const emit = jest.fn();
  const client = { id, data: { user: { subject: 'user-1' } }, emit };
  return { client: client as unknown as Client, emit };
}

/** A gateway over fakes, its logger silenced and spied. */
function build() {
  const auth = {
    authenticate: jest.fn().mockResolvedValue(undefined),
    closeAtExpiry: jest.fn(),
    clearExpiry: jest.fn(),
  };
  const registry = new Registry();
  const metrics = new TelemetryMetrics(registry);
  const ingest = fakeIngest();
  const gateway = new TelemetryGateway(
    auth as unknown as SocketAuth,
    ingest.ingest as unknown as TelemetryIngestService,
    metrics,
  );
  const warn = jest.spyOn(gateway['logger'], 'warn').mockImplementation(() => undefined);
  jest.spyOn(gateway['logger'], 'debug').mockImplementation(() => undefined);
  return { gateway, auth, registry, warn, ...ingest, ns: fakeNamespace() };
}

/** Lets a `.then` registered on an already-settled promise run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await Promise.resolve();
}

describe('TelemetryGateway', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('the handshake', () => {
    it('lets a socket in when `SocketAuth` accepts it, and refuses it with its error otherwise', async () => {
      const { gateway, auth, ns } = build();
      gateway.afterInit(ns.namespace);
      const middleware = ns.use.mock.calls[0]?.[0] as (socket: unknown, next: jest.Mock) => void;
      const socket = { handshake: { auth: {} } };

      const accepted = jest.fn();
      middleware(socket, accepted);
      await settle();
      expect(auth.authenticate).toHaveBeenCalledWith(socket);
      expect(accepted).toHaveBeenCalledWith();

      const refusal = new Error('Forbidden');
      auth.authenticate.mockRejectedValueOnce(refusal);
      const refused = jest.fn();
      middleware(socket, refused);
      await settle();
      expect(refused).toHaveBeenCalledWith(refusal);
    });

    it('closes the transport at token expiry, and lets go of that timer on disconnect', () => {
      const { gateway, auth } = build();
      const { client } = fakeClient();

      gateway.handleConnection(client);
      gateway.handleDisconnect(client);

      expect(auth.closeAtExpiry).toHaveBeenCalledWith(client);
      expect(auth.clearExpiry).toHaveBeenCalledWith(client);
    });
  });

  describe('on connect', () => {
    it('sends that socket a snapshot, then the status, as plain emits', () => {
      const { gateway, ingest, ns } = build();
      const assets = { 'CT-01': { online: true, receivedAt: iso(NOW), values: { running: true } } };
      ingest.latestState.mockReturnValue(assets);
      const { client, emit } = fakeClient();
      gateway.afterInit(ns.namespace);

      gateway.handleConnection(client);

      expect(emit.mock.calls).toEqual([
        [TelemetryEvents.Snapshot, { at: iso(NOW), assets }],
        [TelemetryEvents.Status, { upstream: 'paused', since: SINCE }],
      ]);
      // To this socket only: the namespace was not asked to emit anything.
      expect(ns.emit).not.toHaveBeenCalled();
      expect(ns.volatileEmit).not.toHaveBeenCalled();
    });

    it('still sends a snapshot when nothing is held, so "nothing" is told, not silent', () => {
      const { gateway, ns } = build();
      const { client, emit } = fakeClient();
      gateway.afterInit(ns.namespace);

      gateway.handleConnection(client);

      expect(emit).toHaveBeenCalledWith(TelemetryEvents.Snapshot, { at: iso(NOW), assets: {} });
    });

    it('tells the state the source has now, not the one it had at start', () => {
      const { gateway, ingest, ns } = build();
      ingest.upstream.mockReturnValue({ upstream: 'live', since: iso(NOW) });
      const { client, emit } = fakeClient();
      gateway.afterInit(ns.namespace);

      gateway.handleConnection(client);

      expect(emit).toHaveBeenCalledWith(TelemetryEvents.Status, {
        upstream: 'live',
        since: iso(NOW),
      });
    });
  });

  describe('status', () => {
    it('is forwarded to every socket on a change, as a plain emit that is always delivered', () => {
      const { gateway, report, ns } = build();
      gateway.afterInit(ns.namespace);

      report({ upstream: 'live', since: iso(NOW) });

      expect(ns.emit).toHaveBeenCalledTimes(1);
      expect(ns.emit).toHaveBeenCalledWith(TelemetryEvents.Status, {
        upstream: 'live',
        since: iso(NOW),
      });
      expect(ns.volatileEmit).not.toHaveBeenCalled();
    });

    it('is not forwarded after the module is destroyed', () => {
      const { gateway, report, listening, unsubscribe, ns } = build();
      gateway.afterInit(ns.namespace);
      expect(listening()).toBe(true);

      gateway.onModuleDestroy();
      report({ upstream: 'paused', since: iso(NOW) });

      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(ns.emit).not.toHaveBeenCalled();
    });
  });

  describe('overview', () => {
    it('is one volatile broadcast per tick, and never a plain emit', () => {
      const { gateway, ingest, ns } = build();
      const assets = { 'CT-01': { online: true, receivedAt: iso(NOW), headline: { temp: 21 } } };
      ingest.overview.mockReturnValue(assets);
      ns.sockets.set('a', {});
      gateway.afterInit(ns.namespace);

      jest.advanceTimersByTime(1_000);

      expect(ns.volatileEmit).toHaveBeenCalledTimes(1);
      expect(ns.volatileEmit).toHaveBeenCalledWith(TelemetryEvents.Overview, {
        at: iso(NOW + 1_000),
        assets,
      });
      expect(ns.emit).not.toHaveBeenCalled();
    });

    it('is built once per tick whatever the number of consoles', () => {
      const { gateway, ingest, ns } = build();
      for (const id of ['a', 'b', 'c', 'd', 'e']) ns.sockets.set(id, {});
      gateway.afterInit(ns.namespace);

      jest.advanceTimersByTime(3_000);

      expect(ingest.overview).toHaveBeenCalledTimes(3);
      expect(ns.volatileEmit).toHaveBeenCalledTimes(3);
    });

    it('is not built while no console is connected', () => {
      const { gateway, ingest, ns } = build();
      gateway.afterInit(ns.namespace);

      jest.advanceTimersByTime(3_000);

      expect(ingest.overview).not.toHaveBeenCalled();
      expect(ns.volatileEmit).not.toHaveBeenCalled();
    });

    it('keeps coming while the upstream is paused: the held state is still the latest known', () => {
      const { gateway, ingest, ns } = build();
      ingest.upstream.mockReturnValue({ upstream: 'paused', since: SINCE });
      ns.sockets.set('a', {});
      gateway.afterInit(ns.namespace);

      jest.advanceTimersByTime(1_000);

      expect(ns.volatileEmit).toHaveBeenCalledTimes(1);
    });

    it('does not keep the process alive, and stops when the module is destroyed', () => {
      const { gateway, ns } = build();
      ns.sockets.set('a', {});
      gateway.afterInit(ns.namespace);
      const timer = gateway['overviewTimer'] as NodeJS.Timeout;

      expect(timer.hasRef()).toBe(false);

      gateway.onModuleDestroy();
      jest.advanceTimersByTime(5_000);

      expect(ns.volatileEmit).not.toHaveBeenCalled();
    });

    it('survives a failed build: warns once, and the next tick still runs', () => {
      const { gateway, ingest, warn, ns } = build();
      ingest.overview.mockImplementationOnce(() => {
        throw new Error('boom');
      });
      ingest.overview.mockImplementationOnce(() => {
        throw new Error('boom again');
      });
      ns.sockets.set('a', {});
      gateway.afterInit(ns.namespace);

      expect(() => jest.advanceTimersByTime(2_000)).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(ns.volatileEmit).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1_000);

      expect(ns.volatileEmit).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('metrics', () => {
    it('reads the number of connected consoles from the namespace on scrape', async () => {
      const { gateway, registry, ns } = build();
      gateway.afterInit(ns.namespace);
      const scrape = async () =>
        (await registry.getSingleMetric('telemetry_connected_consoles')!.get()).values[0]?.value;

      expect(await scrape()).toBe(0);
      ns.sockets.set('a', {});
      ns.sockets.set('b', {});
      expect(await scrape()).toBe(2);
      ns.sockets.delete('a');
      expect(await scrape()).toBe(1);
    });
  });
});
