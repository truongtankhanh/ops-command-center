import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Registry } from '@prometheus-io/client';
import { TelemetryEvents } from '@occ/contracts';
import { IS_PUBLIC_KEY } from '../auth/auth.decorators';
import { RolesGuard } from '../auth/roles.guard';
import { TelemetryMetrics } from '../metrics/telemetry.metrics';
import type { SocketAuth } from '../realtime/socket-auth';
import { TelemetryGateway } from './telemetry.gateway';
import type { TelemetryChange, TelemetryIngestService } from './telemetry-ingest.service';
import type { UpstreamState } from './telemetry-source';

const NOW = Date.parse('2026-10-13T08:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const SINCE = iso(NOW - 60_000);

/** The assets the fake catalogue holds. */
const KNOWN_ASSETS = new Set(['CT-01', 'CT-02', 'CT-03', 'CT-04', 'CT-05']);

/** `@nestjs/throttler` does not export its metadata keys: `THROTTLER_SKIP` + the throttler name. */
const THROTTLER_SKIP_DEFAULT = 'THROTTLER:SKIPdefault';

type Namespace = Parameters<TelemetryGateway['afterInit']>[0];
type Client = Parameters<TelemetryGateway['handleConnection']>[0];

/**
 * The namespace as the gateway uses it: sockets to count and to emit to, a middleware slot, the
 * namespace's own emit paths (status, overview), and the adapter's rooms, which is where the
 * gateway reads what is watched. A frame goes to a socket's `volatile.emit`, recorded in
 * `frameEmit` as `(socketId, event, payload)`.
 */
function fakeNamespace() {
  const emit = jest.fn();
  const volatileEmit = jest.fn();
  const frameEmit = jest.fn();
  const use = jest.fn();
  const sockets = new Map<string, unknown>();
  const rooms = new Map<string, Set<string>>();
  const namespace = {
    sockets,
    use,
    emit,
    volatile: { emit: volatileEmit },
    adapter: { rooms },
  };
  /** A socket that is in the namespace and records the frames it is sent. */
  const addSocket = (id: string) => {
    sockets.set(id, {
      id,
      volatile: { emit: (event: string, payload: unknown) => frameEmit(id, event, payload) },
    });
  };
  return {
    namespace: namespace as unknown as Namespace,
    sockets,
    rooms,
    emit,
    volatileEmit,
    frameEmit,
    addSocket,
    use,
  };
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
    knows: jest.fn((code: string) => KNOWN_ASSETS.has(code)),
    snapshotOf: jest.fn((_codes: readonly string[]): Record<string, unknown> => ({})),
    changedSince: jest.fn((version: number): { version: number; changes: TelemetryChange[] } => ({
      version,
      changes: [],
    })),
  };
  return {
    ingest,
    unsubscribe,
    report: (state: UpstreamState) => listener?.(state),
    listening: () => listener !== undefined,
  };
}

/**
 * A socket that records what it is sent. With `rooms` it also joins and leaves them the way
 * Socket.IO does, and is in the room named by its own id, so `watchedBy` has something to skip.
 */
function fakeClient(
  id = 'socket-1',
  rooms?: Map<string, Set<string>>,
  onVolatile?: (event: string, payload: unknown) => void,
) {
  const emit = jest.fn();
  const joined = new Set<string>([id]);
  const enter = (name: string) => {
    joined.add(name);
    const members = rooms?.get(name) ?? new Set<string>();
    members.add(id);
    rooms?.set(name, members);
  };
  const join = jest.fn((names: string | string[]) => {
    for (const name of Array.isArray(names) ? names : [names]) enter(name);
  });
  const leave = jest.fn((name: string) => {
    joined.delete(name);
    const members = rooms?.get(name);
    members?.delete(id);
    if (members?.size === 0) rooms?.delete(name);
  });
  enter(id);
  const volatile = { emit: (event: string, payload: unknown) => onVolatile?.(event, payload) };
  const client = {
    id,
    data: { user: { subject: 'user-1' } },
    emit,
    volatile,
    rooms: joined,
    join,
    leave,
  };
  return { client: client as unknown as Client, emit, join, leave, rooms: joined };
}

/** A console that has connected: in the namespace, and in the namespace's rooms. */
function connected(ns: ReturnType<typeof fakeNamespace>, id = 'socket-1') {
  const fake = fakeClient(id, ns.rooms, (event, payload) => ns.frameEmit(id, event, payload));
  ns.sockets.set(id, fake.client);
  return fake;
}

const change = (
  assetCode: string,
  values: Record<string, number | boolean | string>,
): TelemetryChange => ({
  assetCode,
  assetId: `id-${assetCode}`,
  values,
  at: iso(NOW),
  receivedAt: iso(NOW),
});

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
  const ns = fakeNamespace();
  // What `@WebSocketServer()` injects: `handleWatch` asks it who is in a room.
  gateway.server = ns.namespace;
  return { gateway, auth, registry, warn, ...ingest, ns };
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
      const timer = gateway['tickTimer'] as NodeJS.Timeout;

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

  describe('telemetry.watch', () => {
    it('joins the room of each accepted code and answers with those codes', async () => {
      const { gateway, ns } = build();
      gateway.afterInit(ns.namespace);
      const { client, rooms } = connected(ns);

      const ack = await gateway.handleWatch(client, { assets: ['CT-01', 'CT-02'] });

      expect(ack).toEqual({ accepted: ['CT-01', 'CT-02'] });
      expect(rooms.has('asset:CT-01')).toBe(true);
      expect(rooms.has('asset:CT-02')).toBe(true);
      expect(ns.rooms.get('asset:CT-01')).toEqual(new Set(['socket-1']));
    });

    it('replaces the previous set: it leaves the old rooms and joins the new one', async () => {
      const { gateway, ns } = build();
      gateway.afterInit(ns.namespace);
      const { client, leave, rooms } = connected(ns);
      await gateway.handleWatch(client, { assets: ['CT-01', 'CT-02'] });

      const ack = await gateway.handleWatch(client, { assets: ['CT-03'] });

      expect(ack).toEqual({ accepted: ['CT-03'] });
      expect(leave).toHaveBeenCalledWith('asset:CT-01');
      expect(leave).toHaveBeenCalledWith('asset:CT-02');
      expect([...rooms].filter((room) => room.startsWith('asset:'))).toEqual(['asset:CT-03']);
      expect(ns.rooms.has('asset:CT-01')).toBe(false);
    });

    it('neither leaves nor joins a code that is in both sets, and snapshots only the new one', async () => {
      const { gateway, ingest, ns } = build();
      gateway.afterInit(ns.namespace);
      const { client, join, leave } = connected(ns);
      await gateway.handleWatch(client, { assets: ['CT-01'] });
      join.mockClear();
      ingest.snapshotOf.mockClear();

      await gateway.handleWatch(client, { assets: ['CT-01', 'CT-02'] });

      expect(leave).not.toHaveBeenCalled();
      expect(join).toHaveBeenCalledTimes(1);
      expect(join).toHaveBeenCalledWith(['asset:CT-02']);
      expect(ingest.snapshotOf).toHaveBeenCalledWith(['CT-02']);
    });

    it('keeps four of five, and an unknown code is absent and never joined', async () => {
      const { gateway, ns } = build();
      gateway.afterInit(ns.namespace);
      const { client, rooms } = connected(ns);

      const ack = await gateway.handleWatch(client, {
        assets: ['XX-99', 'CT-01', 'CT-02', 'CT-03', 'CT-04', 'CT-05'],
      });

      expect(ack).toEqual({ accepted: ['CT-01', 'CT-02', 'CT-03', 'CT-04'] });
      expect(rooms.has('asset:XX-99')).toBe(false);
      expect(rooms.has('asset:CT-05')).toBe(false);
    });

    it('treats a malformed payload as a list that accepts nothing, which clears the set', async () => {
      const { gateway, ns } = build();
      gateway.afterInit(ns.namespace);
      const { client, leave } = connected(ns);
      await gateway.handleWatch(client, { assets: ['CT-01'] });

      const ack = await gateway.handleWatch(client, null);

      expect(ack).toEqual({ accepted: [] });
      expect(leave).toHaveBeenCalledWith('asset:CT-01');
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['a number', 7],
      ['a string', 'CT-01'],
      ['an array', ['CT-01']],
      ['an empty object', {}],
      ['`assets` as a string', { assets: 'CT-01' }],
      ['`assets` of things that are not codes', { assets: [1, null, {}, [], true] }],
    ])(
      'answers %s with an empty acknowledgement, and joins and sends nothing',
      async (_, payload) => {
        const { gateway, ns } = build();
        gateway.afterInit(ns.namespace);
        const { client, emit, join } = connected(ns);

        await expect(gateway.handleWatch(client, payload)).resolves.toEqual({ accepted: [] });

        expect(join).not.toHaveBeenCalled();
        expect(emit).not.toHaveBeenCalled();
      },
    );

    describe('the snapshot', () => {
      it('holds exactly the newly watched assets, goes to that socket only, and is a plain emit', async () => {
        const { gateway, ingest, ns } = build();
        const assets = { 'CT-01': { online: true, receivedAt: iso(NOW), values: { temp: 20 } } };
        ingest.snapshotOf.mockReturnValue(assets);
        gateway.afterInit(ns.namespace);
        const { client, emit } = connected(ns);

        await gateway.handleWatch(client, { assets: ['CT-01'] });

        expect(ingest.snapshotOf).toHaveBeenCalledWith(['CT-01']);
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith(TelemetryEvents.Snapshot, { at: iso(NOW), assets });
        expect(ns.emit).not.toHaveBeenCalled();
        expect(ns.volatileEmit).not.toHaveBeenCalled();
        expect(ns.frameEmit).not.toHaveBeenCalled();
      });

      it('is sent even when no asset holds a reading yet, so "nothing" is told', async () => {
        const { gateway, ns } = build();
        gateway.afterInit(ns.namespace);
        const { client, emit } = connected(ns);

        await gateway.handleWatch(client, { assets: ['CT-01'] });

        expect(emit).toHaveBeenCalledWith(TelemetryEvents.Snapshot, { at: iso(NOW), assets: {} });
      });

      it('is not sent when the set is unchanged, shrinks, or is emptied', async () => {
        const { gateway, ns } = build();
        gateway.afterInit(ns.namespace);
        const { client, emit } = connected(ns);
        await gateway.handleWatch(client, { assets: ['CT-01', 'CT-02'] });
        emit.mockClear();

        await gateway.handleWatch(client, { assets: ['CT-01', 'CT-02'] });
        await gateway.handleWatch(client, { assets: ['CT-01'] });
        await gateway.handleWatch(client, { assets: [] });

        expect(emit).not.toHaveBeenCalled();
      });

      it('is sent, and the rooms are changed, before the handler first yields', async () => {
        const { gateway, ns } = build();
        gateway.afterInit(ns.namespace);
        const { client, emit, rooms } = connected(ns);

        const pending = gateway.handleWatch(client, { assets: ['CT-01'] });

        // No `await` yet: a second message read in the same turn must see these rooms.
        expect(rooms.has('asset:CT-01')).toBe(true);
        expect(emit).toHaveBeenCalledWith(TelemetryEvents.Snapshot, expect.anything());
        await pending;
      });
    });

    describe('the rate limit', () => {
      it('applies five calls in a second and drops the sixth, leaving the set as it was', async () => {
        const { gateway, ingest, ns } = build();
        gateway.afterInit(ns.namespace);
        const { client, rooms } = connected(ns);
        for (let i = 0; i < 5; i++) {
          await expect(gateway.handleWatch(client, { assets: ['CT-01'] })).resolves.toEqual({
            accepted: ['CT-01'],
          });
        }
        ingest.knows.mockClear();

        const sixth = await gateway.handleWatch(client, { assets: ['CT-02'] });

        expect(sixth).toEqual({ accepted: [] });
        expect(rooms.has('asset:CT-01')).toBe(true);
        expect(rooms.has('asset:CT-02')).toBe(false);
        // Dropped before the payload was looked at.
        expect(ingest.knows).not.toHaveBeenCalled();
      });

      it('lets the socket watch again once a second has passed', async () => {
        const { gateway, ns } = build();
        gateway.afterInit(ns.namespace);
        const { client } = connected(ns);
        for (let i = 0; i < 6; i++) await gateway.handleWatch(client, { assets: ['CT-01'] });

        jest.advanceTimersByTime(1_000);

        await expect(gateway.handleWatch(client, { assets: ['CT-02'] })).resolves.toEqual({
          accepted: ['CT-02'],
        });
      });

      it('counts each socket on its own, and counts a malformed call like any other', async () => {
        const { gateway, ns } = build();
        gateway.afterInit(ns.namespace);
        const first = connected(ns, 'socket-1');
        const second = connected(ns, 'socket-2');
        for (let i = 0; i < 5; i++) await gateway.handleWatch(first.client, null);

        await expect(gateway.handleWatch(first.client, { assets: ['CT-01'] })).resolves.toEqual({
          accepted: [],
        });
        await expect(gateway.handleWatch(second.client, { assets: ['CT-01'] })).resolves.toEqual({
          accepted: ['CT-01'],
        });
      });
    });

    describe('the global guards', () => {
      const reflector = new Reflector();
      const handler = TelemetryGateway.prototype.handleWatch;
      const socketMessage = (method: (...args: never[]) => unknown) =>
        ({
          getHandler: () => method,
          getClass: () => TelemetryGateway,
          getType: () => 'ws',
        }) as unknown as ExecutionContext;

      it('is public and skips the throttler on the handler, not on the whole gateway', () => {
        expect(reflector.get(IS_PUBLIC_KEY, handler)).toBe(true);
        expect(reflector.get(THROTTLER_SKIP_DEFAULT, handler)).toBe(true);
        expect(reflector.get(IS_PUBLIC_KEY, TelemetryGateway)).toBeUndefined();
        expect(reflector.get(THROTTLER_SKIP_DEFAULT, TelemetryGateway)).toBeUndefined();
      });

      it('passes `RolesGuard` as a socket message, and a method that did not opt in does not', () => {
        const guard = new RolesGuard(reflector);

        expect(guard.canActivate(socketMessage(handler))).toBe(true);
        expect(guard.canActivate(socketMessage(TelemetryGateway.prototype.handleConnection))).toBe(
          false,
        );
      });
    });
  });

  describe('frames', () => {
    /** Sockets that watch assets: in the namespace, and in the room of each code. */
    const watching = (ns: ReturnType<typeof fakeNamespace>, ...codes: string[]) => {
      ns.addSocket('a');
      ns.rooms.set('a', new Set(['a']));
      for (const code of codes) ns.rooms.set(`asset:${code}`, new Set(['a']));
    };

    /** What each socket was sent, as `[socketId, frames]`, in order. */
    const batches = (ns: ReturnType<typeof fakeNamespace>) =>
      ns.frameEmit.mock.calls.map(([id, , payload]) => [
        id as string,
        (payload as { frames: unknown[] }).frames,
      ]);
    const valuesOf = (ns: ReturnType<typeof fakeNamespace>) =>
      ns.frameEmit.mock.calls.map(
        ([, , payload]) =>
          (payload as { frames: { values: Record<string, unknown> }[] }).frames[0]?.values,
      );

    it('is one volatile emit to the socket that watches an asset, with the change as its frame', () => {
      const { gateway, ingest, ns } = build();
      watching(ns, 'CT-01');
      ingest.changedSince.mockReturnValue({
        version: 4,
        changes: [change('CT-01', { temp: 21, running: true })],
      });
      gateway.afterInit(ns.namespace);

      jest.advanceTimersByTime(100);

      expect(ns.frameEmit).toHaveBeenCalledTimes(1);
      expect(ns.frameEmit).toHaveBeenCalledWith('a', TelemetryEvents.Frames, {
        frames: [
          {
            assetCode: 'CT-01',
            at: iso(NOW),
            receivedAt: iso(NOW),
            values: { temp: 21, running: true },
          },
        ],
      });
      // Never a plain emit, and not through the overview's broadcast.
      expect(ns.emit).not.toHaveBeenCalled();
      expect(ns.volatileEmit).not.toHaveBeenCalled();
    });

    it('sends two assets that changed in one tick as one packet with two frames, in order', () => {
      const { gateway, ingest, ns } = build();
      watching(ns, 'CT-01', 'CT-02');
      ingest.changedSince.mockReturnValue({
        version: 1,
        changes: [change('CT-02', { temp: 30 }), change('CT-01', { temp: 20 })],
      });
      gateway.afterInit(ns.namespace);

      jest.advanceTimersByTime(100);

      // One emit, because a second volatile emit in the same turn is discarded by the transport.
      expect(ns.frameEmit).toHaveBeenCalledTimes(1);
      const [[, frames]] = batches(ns) as [[string, { assetCode: string }[]]];
      expect(frames.map((frame) => frame.assetCode)).toEqual(['CT-02', 'CT-01']);
    });

    it('gives each socket the frames of the assets it watches, and only those', () => {
      const { gateway, ingest, ns } = build();
      ns.addSocket('a');
      ns.addSocket('b');
      ns.rooms.set('a', new Set(['a']));
      ns.rooms.set('b', new Set(['b']));
      ns.rooms.set('asset:CT-01', new Set(['a']));
      ns.rooms.set('asset:CT-02', new Set(['a', 'b']));
      ingest.changedSince.mockReturnValue({
        version: 1,
        changes: [change('CT-01', { temp: 20 }), change('CT-02', { temp: 30 })],
      });
      gateway.afterInit(ns.namespace);

      jest.advanceTimersByTime(100);

      const codes = batches(ns).map(([id, frames]) => [
        id,
        (frames as { assetCode: string }[]).map((frame) => frame.assetCode),
      ]);
      expect(codes).toEqual([
        ['a', ['CT-01', 'CT-02']],
        ['b', ['CT-02']],
      ]);
    });

    it('merges an asset listed twice in a tick instead of dropping the first entry', () => {
      const { gateway, ingest, ns } = build();
      watching(ns, 'CT-01');
      ingest.changedSince.mockReturnValue({
        version: 1,
        changes: [change('CT-01', { temp: 20 }), change('CT-01', { pressure: 4 })],
      });
      gateway.afterInit(ns.namespace);

      jest.advanceTimersByTime(100);

      expect(valuesOf(ns)).toEqual([{ temp: 20, pressure: 4 }]);
    });

    it('sends nothing for an asset that nobody watches', () => {
      const { gateway, ingest, ns } = build();
      watching(ns, 'CT-01');
      ingest.changedSince.mockReturnValue({
        version: 1,
        changes: [change('CT-02', { temp: 30 })],
      });
      gateway.afterInit(ns.namespace);

      jest.advanceTimersByTime(100);

      expect(ns.frameEmit).not.toHaveBeenCalled();
    });

    it('skips a socket that has left the namespace since the rooms were read, without a warning', () => {
      const { gateway, ingest, warn, ns } = build();
      watching(ns, 'CT-01');
      ns.sockets.delete('a');
      ingest.changedSince.mockReturnValue({
        version: 1,
        changes: [change('CT-01', { temp: 20 })],
      });
      gateway.afterInit(ns.namespace);

      expect(() => jest.advanceTimersByTime(100)).not.toThrow();

      expect(ns.frameEmit).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });

    it('carries the keys that changed since the previous frame to that socket, and nothing when none did', () => {
      const { gateway, ingest, ns } = build();
      watching(ns, 'CT-01');
      gateway.afterInit(ns.namespace);
      const arrives = (values: Record<string, number>) =>
        ingest.changedSince.mockReturnValueOnce({
          version: 1,
          changes: [change('CT-01', values)],
        });

      arrives({ temp: 20, pressure: 4 });
      jest.advanceTimersByTime(100);
      arrives({ temp: 20, pressure: 5 });
      jest.advanceTimersByTime(100);
      arrives({ temp: 20, pressure: 5 });
      jest.advanceTimersByTime(100);

      expect(valuesOf(ns)).toEqual([{ temp: 20, pressure: 4 }, { pressure: 5 }]);
    });

    it('is not a repeat of the snapshot the watch returned', async () => {
      const { gateway, ingest, ns } = build();
      ingest.snapshotOf.mockReturnValue({
        'CT-01': { online: true, receivedAt: iso(NOW), values: { temp: 20, pressure: 4 } },
      });
      gateway.afterInit(ns.namespace);
      const { client } = connected(ns);
      await gateway.handleWatch(client, { assets: ['CT-01'] });

      ingest.changedSince.mockReturnValueOnce({
        version: 1,
        changes: [change('CT-01', { temp: 20, pressure: 4 })],
      });
      jest.advanceTimersByTime(100);
      expect(ns.frameEmit).not.toHaveBeenCalled();

      ingest.changedSince.mockReturnValueOnce({
        version: 2,
        changes: [change('CT-01', { temp: 21, pressure: 4 })],
      });
      jest.advanceTimersByTime(100);
      expect(valuesOf(ns)).toEqual([{ temp: 21 }]);
    });

    it('takes the baseline again when an emptied room is watched anew, even before a tick saw it empty', async () => {
      const { gateway, ingest, ns } = build();
      gateway.afterInit(ns.namespace);
      const first = connected(ns);
      ingest.snapshotOf.mockReturnValue({
        'CT-01': { online: true, receivedAt: iso(NOW), values: { temp: 20 } },
      });
      await gateway.handleWatch(first.client, { assets: ['CT-01'] });
      // The only watcher goes away, and no tick runs before the next watch.
      await gateway.handleWatch(first.client, { assets: [] });

      ingest.snapshotOf.mockReturnValue({
        'CT-01': { online: true, receivedAt: iso(NOW), values: { temp: 25 } },
      });
      await gateway.handleWatch(first.client, { assets: ['CT-01'] });
      ingest.changedSince.mockReturnValueOnce({
        version: 3,
        changes: [change('CT-01', { temp: 25 })],
      });
      jest.advanceTimersByTime(100);

      // A baseline left over from the first watch (20) would make 25 a change.
      expect(ns.frameEmit).not.toHaveBeenCalled();
    });

    it('leaves the baseline of a room that already has a watcher as that watcher was last sent', async () => {
      const { gateway, ingest, ns } = build();
      gateway.afterInit(ns.namespace);
      const first = connected(ns, 'socket-1');
      const second = connected(ns, 'socket-2');
      ingest.snapshotOf.mockReturnValue({
        'CT-01': { online: true, receivedAt: iso(NOW), values: { temp: 20 } },
      });
      await gateway.handleWatch(first.client, { assets: ['CT-01'] });
      // The value moved on, and the room has not been sent it yet: it is what the next frame is for.
      ingest.snapshotOf.mockReturnValue({
        'CT-01': { online: true, receivedAt: iso(NOW), values: { temp: 21 } },
      });
      await gateway.handleWatch(second.client, { assets: ['CT-01'] });

      ingest.changedSince.mockReturnValueOnce({
        version: 1,
        changes: [change('CT-01', { temp: 21 })],
      });
      jest.advanceTimersByTime(100);

      // One frame, built once for the room, and each of its two sockets gets its own packet.
      expect(ns.frameEmit).toHaveBeenCalledTimes(2);
      expect(ns.frameEmit.mock.calls.map(([id]) => id).sort()).toEqual(['socket-1', 'socket-2']);
      expect(valuesOf(ns)).toEqual([{ temp: 21 }, { temp: 21 }]);
    });

    it('reads the ingest service once per tick, from the cursor it was last given', () => {
      const { gateway, ingest, ns } = build();
      watching(ns, 'CT-01', 'CT-02', 'CT-03');
      ingest.changedSince.mockReturnValueOnce({ version: 7, changes: [] });
      gateway.afterInit(ns.namespace);

      jest.advanceTimersByTime(200);

      expect(ingest.changedSince.mock.calls).toEqual([[0], [7]]);
    });

    it('does not read the ingest service while nothing is watched', () => {
      const { gateway, ingest, ns } = build();
      watching(ns);
      gateway.afterInit(ns.namespace);

      jest.advanceTimersByTime(1_000);

      expect(ingest.changedSince).not.toHaveBeenCalled();
    });

    it('sends at most ten a second for an asset, however fast readings arrive', () => {
      const { gateway, ingest, ns } = build();
      watching(ns, 'CT-01');
      let temp = 0;
      ingest.changedSince.mockImplementation((version: number) => ({
        version: version + 1,
        changes: [change('CT-01', { temp: ++temp })],
      }));
      gateway.afterInit(ns.namespace);

      jest.advanceTimersByTime(1_000);

      // Nine ticks of frames: the tenth tick of the second is the overview's.
      expect(ns.frameEmit).toHaveBeenCalledTimes(9);
    });

    it('does no frame work in the tick that sends the overview, and loses nothing by it', () => {
      const { gateway, ingest, ns } = build();
      watching(ns, 'CT-01');
      ingest.changedSince.mockImplementation((version: number) => ({
        version: version + 1,
        changes: [change('CT-01', { temp: version })],
      }));
      gateway.afterInit(ns.namespace);

      jest.advanceTimersByTime(1_000);

      // Nine reads, from cursors 0 to 8; the overview went out on the tenth tick.
      expect(ingest.changedSince.mock.calls.map(([version]) => version)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8,
      ]);
      expect(ns.volatileEmit).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(100);

      // The next tick carries on from the cursor the ninth left: what arrived meanwhile is read then.
      expect(ingest.changedSince.mock.calls.at(-1)).toEqual([9]);
      expect(ns.frameEmit).toHaveBeenCalledTimes(10);
    });

    it('does not keep the process alive, and stops when the module is destroyed', () => {
      const { gateway, ingest, ns } = build();
      watching(ns, 'CT-01');
      ingest.changedSince.mockReturnValue({ version: 1, changes: [change('CT-01', { temp: 1 })] });
      gateway.afterInit(ns.namespace);
      const timer = gateway['tickTimer'] as NodeJS.Timeout;

      expect(timer.hasRef()).toBe(false);

      gateway.onModuleDestroy();
      jest.advanceTimersByTime(1_000);

      expect(ns.frameEmit).not.toHaveBeenCalled();
    });

    it('survives a failed tick: warns once, and the next tick still runs', () => {
      const { gateway, ingest, warn, ns } = build();
      watching(ns, 'CT-01');
      ingest.changedSince.mockImplementationOnce(() => {
        throw new Error('boom');
      });
      ingest.changedSince.mockImplementationOnce(() => {
        throw new Error('boom again');
      });
      ingest.changedSince.mockReturnValue({ version: 1, changes: [change('CT-01', { temp: 1 })] });
      gateway.afterInit(ns.namespace);

      expect(() => jest.advanceTimersByTime(200)).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(ns.frameEmit).not.toHaveBeenCalled();

      jest.advanceTimersByTime(100);

      expect(ns.frameEmit).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("survives the adapter's rooms being unreadable, which is also inside the guarded tick", () => {
      const { gateway, warn, ns } = build();
      const adapter = (ns.namespace as unknown as { adapter: object }).adapter;
      Object.defineProperty(adapter, 'rooms', {
        get() {
          throw new Error('no adapter');
        },
      });
      gateway.afterInit(ns.namespace);

      expect(() => jest.advanceTimersByTime(300)).not.toThrow();
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
