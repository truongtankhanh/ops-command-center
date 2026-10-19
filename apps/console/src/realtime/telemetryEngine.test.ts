import type {
  TelemetryFrames,
  TelemetryOverview,
  TelemetrySnapshot,
  TelemetryStatus,
} from '@occ/contracts';
import {
  type AuthCallback,
  createTelemetryEngine,
  type EngineSocket,
  type SocketFactory,
} from './telemetryEngine';
import {
  type FromWorker,
  type TargetSlot,
  TELEMETRY_PROTOCOL_VERSION,
  type ToWorker,
} from './telemetryProtocol';

const v = TELEMETRY_PROTOCOL_VERSION;
const T0 = '2026-10-15T08:00:00.000Z';
const iso = (ms: number) => new Date(ms).toISOString();

/** A socket that does nothing by itself: the test fires its events by hand. */
class FakeSocket implements EngineSocket {
  active = true;
  connects = 0;
  disconnects = 0;
  watches: { assets: string[]; ack: (accepted: readonly string[] | null) => void }[] = [];
  handlers: {
    connect?: () => void;
    disconnect?: () => void;
    reconnectAttempt?: () => void;
    connectError?: (message: string) => void;
    overview?: (overview: TelemetryOverview) => void;
    snapshot?: (snapshot: TelemetrySnapshot) => void;
    frames?: (batch: TelemetryFrames) => void;
    status?: (status: TelemetryStatus) => void;
  } = {};

  onConnect(handler: () => void) {
    this.handlers.connect = handler;
  }
  onDisconnect(handler: () => void) {
    this.handlers.disconnect = handler;
  }
  onReconnectAttempt(handler: () => void) {
    this.handlers.reconnectAttempt = handler;
  }
  onConnectError(handler: (message: string) => void) {
    this.handlers.connectError = handler;
  }
  onOverview(handler: (overview: TelemetryOverview) => void) {
    this.handlers.overview = handler;
  }
  onSnapshot(handler: (snapshot: TelemetrySnapshot) => void) {
    this.handlers.snapshot = handler;
  }
  onFrames(handler: (batch: TelemetryFrames) => void) {
    this.handlers.frames = handler;
  }
  onStatus(handler: (status: TelemetryStatus) => void) {
    this.handlers.status = handler;
  }
  watch(assets: string[], ack: (accepted: readonly string[] | null) => void) {
    this.watches.push({ assets, ack });
  }
  connect() {
    this.connects += 1;
  }
  disconnect() {
    this.disconnects += 1;
  }
}

function setup() {
  const posts: { message: FromWorker; transfer: Transferable[]; at: number }[] = [];
  let auth: AuthCallback | undefined;
  let socket: FakeSocket | undefined;
  const createSocket: SocketFactory = (callback) => {
    auth = callback;
    socket = new FakeSocket();
    return socket;
  };
  const engine = createTelemetryEngine({
    host: {
      post: (message, transfer = []) => void posts.push({ message, transfer, at: Date.now() }),
    },
    createSocket,
  });
  engine.receive({ v, type: 'connect' });

  const ofType = <T extends FromWorker['type']>(type: T) =>
    posts
      .map((post) => post.message)
      .filter((message): message is Extract<FromWorker, { type: T }> => message.type === type);
  const send = (message: ToWorker) => engine.receive(message);

  return {
    engine,
    socket: socket!,
    auth: auth!,
    posts,
    ofType,
    send,
    lastState: () => ofType('state').at(-1)!,
    watch: (...assets: string[]) => send({ v, type: 'watch', assets }),
    answerToken: (token: string | null, which = -1) => {
      const request = ofType('tokenRequest').at(which)!;
      send({ v, type: 'token', requestId: request.requestId, token });
    },
    /** The socket connects and the server's first messages arrive. */
    goLive: () => socket!.handlers.connect?.(),
  };
}

/** Lets promise callbacks (the token round trip) run. */
const flush = () => vi.advanceTimersByTimeAsync(0);
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

const frames = (
  assetCode: string,
  receivedAtMs: number,
  values: TelemetryFrames['frames'][number]['values'],
): TelemetryFrames => ({
  frames: [{ assetCode, at: '2026-10-15T07:00:00.000Z', receivedAt: iso(receivedAtMs), values }],
});

const snapshotOf = (
  assets: Record<string, { receivedAt: string; values: Record<string, number | boolean | string> }>,
): TelemetrySnapshot => ({
  at: T0,
  assets: Object.fromEntries(
    Object.entries(assets).map(([code, asset]) => [code, { online: true, ...asset }]),
  ),
});

const slot = (assetCode: string, key: string, enumValues: string[] | null = null): TargetSlot => ({
  assetCode,
  key,
  enumValues,
});

describe('telemetry engine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // jitter factor 1: delays are exactly 1 s, 2 s, 4 s
    vi.spyOn(performance, 'now').mockReturnValue(5_000);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('token handshake', () => {
    it('asks the main thread on every handshake and sends only the token it answers with', async () => {
      const { auth, ofType, answerToken } = setup();
      const send = vi.fn();

      auth(send);
      expect(ofType('tokenRequest')).toEqual([
        { v, type: 'tokenRequest', requestId: expect.any(Number), renew: false },
      ]);
      expect(send).not.toHaveBeenCalled();

      answerToken('token-1');
      await flush();
      expect(send).toHaveBeenCalledExactlyOnceWith({ token: 'token-1' });

      auth(send);
      expect(ofType('tokenRequest')).toHaveLength(2);
      expect(ofType('tokenRequest')[1]?.requestId).not.toBe(ofType('tokenRequest')[0]?.requestId);
      answerToken('token-2');
      await flush();
      expect(send).toHaveBeenLastCalledWith({ token: 'token-2' });
    });

    it('sends an empty token, never a stale one, when the main thread does not answer', async () => {
      const { auth } = setup();
      const send = vi.fn();

      auth(send);
      await advance(9_999);
      expect(send).not.toHaveBeenCalled();
      await advance(1);

      expect(send).toHaveBeenCalledExactlyOnceWith({ token: '' });
    });

    it('ignores an answer to a request it is not waiting for', async () => {
      const { auth, send: receive } = setup();
      const send = vi.fn();
      auth(send);

      receive({ v, type: 'token', requestId: 999, token: 'wrong' });
      await flush();

      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('refused handshakes', () => {
    it('renews once after Unauthorized, then reconnects with backoff', async () => {
      const { socket, ofType, answerToken } = setup();

      socket.active = false;
      socket.handlers.connectError?.('Unauthorized');
      expect(ofType('tokenRequest')).toEqual([
        { v, type: 'tokenRequest', requestId: expect.any(Number), renew: true },
      ]);

      answerToken('renewed');
      await flush();
      await advance(999);
      expect(socket.connects).toBe(0);
      await advance(1);
      expect(socket.connects).toBe(1);
    });

    it('does not renew again until a connect succeeds: no loop', async () => {
      const { socket, ofType, answerToken, goLive } = setup();
      socket.active = false;
      socket.handlers.connectError?.('Unauthorized');
      answerToken('renewed');
      await flush();
      await advance(1_000);

      socket.handlers.connectError?.('Unauthorized');
      await advance(2_000);

      expect(ofType('tokenRequest').filter((request) => request.renew)).toHaveLength(1);
      expect(socket.connects).toBe(2);

      goLive();
      socket.active = false;
      socket.handlers.connectError?.('Unauthorized');
      expect(ofType('tokenRequest').filter((request) => request.renew)).toHaveLength(2);
    });

    it('stops when there is no session to renew', async () => {
      const { socket, answerToken } = setup();
      socket.active = false;
      socket.handlers.connectError?.('Unauthorized');

      answerToken(null);
      await flush();
      await advance(120_000);

      expect(socket.connects).toBe(0);
    });

    it('reads Invalid namespace as unavailable, retries it, and raises no renewal', async () => {
      const { socket, ofType, lastState } = setup();

      socket.active = false;
      socket.handlers.connectError?.('Invalid namespace');

      expect(lastState().socket).toBe('unavailable');
      expect(ofType('tokenRequest')).toHaveLength(0);
      await advance(1_000);
      expect(socket.connects).toBe(1);
      socket.handlers.connectError?.('Invalid namespace');
      await advance(1_999);
      expect(socket.connects).toBe(1);
      await advance(1);
      expect(socket.connects).toBe(2);
    });

    it.each(['Forbidden', 'Identity provider unavailable', 'something else'])(
      'backs off and retries after %s without renewing',
      async (reason) => {
        const { socket, ofType } = setup();

        socket.active = false;
        socket.handlers.connectError?.(reason);
        await advance(1_000);

        expect(ofType('tokenRequest')).toHaveLength(0);
        expect(socket.connects).toBe(1);
      },
    );

    it('leaves a transport failure to Socket.IO, which is still retrying', async () => {
      const { socket, lastState } = setup();

      socket.active = true;
      socket.handlers.connectError?.('xhr poll error');
      await advance(60_000);

      expect(lastState().socket).toBe('reconnecting');
      expect(socket.connects).toBe(0);
    });
  });

  describe('socket state', () => {
    it('follows the connection', async () => {
      const { socket, lastState, goLive } = setup();

      goLive();
      expect(lastState().socket).toBe('live');
      expect(lastState().socketSince).toBeNull();

      socket.handlers.disconnect?.();
      await advance(250);
      expect(lastState().socket).toBe('reconnecting');
      expect(lastState().socketSince).toBe(Date.parse(T0) + 0);

      socket.handlers.reconnectAttempt?.();
      goLive();
      await advance(250);
      expect(lastState().socket).toBe('live');
      expect(lastState().socketSince).toBeNull();
    });

    it('reports the upstream status the server sends', async () => {
      const { socket, lastState, goLive } = setup();
      goLive();

      socket.handlers.status?.({ upstream: 'paused', since: T0 });
      await advance(250);

      expect(lastState().upstream).toBe('paused');
      expect(lastState().upstreamSince).toBe(T0);
    });

    it('posts the server time evaluated at post time, not the worker clock', async () => {
      const { socket, lastState, goLive } = setup();
      goLive();
      const at = Date.parse('2026-10-15T08:00:01.000Z');
      socket.handlers.overview?.({ at: iso(at), assets: {} });
      await advance(250);
      expect(lastState().serverNowMs).toBe(at);

      vi.mocked(performance.now).mockReturnValue(9_000);
      socket.handlers.status?.({ upstream: 'live', since: T0 });
      await advance(250);

      expect(lastState().serverNowMs).toBe(at + 4_000);
    });
  });

  describe('watching assets', () => {
    it('sends nothing until it is connected, then the set', async () => {
      const { socket, watch, goLive } = setup();

      watch('CT-01', 'CT-02');
      await advance(1_000);
      expect(socket.watches).toHaveLength(0);

      goLive();
      await advance(250);

      expect(socket.watches.map((call) => call.assets)).toEqual([['CT-01', 'CT-02']]);
    });

    it('sends at most 4 a second and ends on the latest set', async () => {
      const { socket, watch, goLive } = setup();
      goLive();

      // A different set every 25 ms, so no trailing send is skipped as unchanged.
      for (let step = 0; step < 39; step++) {
        watch(`CT-${step}`);
        await advance(25);
      }
      expect(socket.watches.length).toBeLessThanOrEqual(4);
      expect(socket.watches.length).toBeGreaterThanOrEqual(2);

      await advance(1_000);
      expect(socket.watches.at(-1)?.assets).toEqual(['CT-38']);
    });

    it('does not send an unchanged set again', async () => {
      const { socket, watch, goLive } = setup();
      goLive();
      watch('CT-01');
      await advance(250);
      socket.watches[0]?.ack(['CT-01']);

      watch('CT-01');
      await advance(2_000);

      expect(socket.watches).toHaveLength(1);
    });

    it('sends the set again after a reconnect: server state is per connection', async () => {
      const { socket, watch, goLive } = setup();
      goLive();
      watch('CT-01');
      await advance(250);
      socket.watches[0]?.ack(['CT-01']);

      socket.handlers.disconnect?.();
      goLive();
      await advance(250);

      expect(socket.watches.map((call) => call.assets)).toEqual([['CT-01'], ['CT-01']]);
    });

    it('keeps at most the limit, de-duplicated, in order', async () => {
      const { socket, watch, goLive } = setup();
      goLive();

      watch('AA-01', 'AA-01', 'BB-02', 'CC-03', 'DD-04', 'EE-05');
      await advance(250);

      expect(socket.watches[0]?.assets).toEqual(['AA-01', 'BB-02', 'CC-03', 'DD-04']);
    });

    it('stops watching with an empty set once something was sent', async () => {
      const { socket, watch, goLive } = setup();
      goLive();
      watch('CT-01');
      await advance(250);
      socket.watches[0]?.ack(['CT-01']);

      watch();
      await advance(250);

      expect(socket.watches.map((call) => call.assets)).toEqual([['CT-01'], []]);
    });

    it('survives an unanswered watch and waits for the next connect', async () => {
      const { socket, watch, goLive } = setup();
      goLive();
      watch('CT-01');
      await advance(250);

      expect(() => socket.watches[0]?.ack(null)).not.toThrow();
      await advance(10_000);
      expect(socket.watches).toHaveLength(1);

      socket.handlers.disconnect?.();
      goLive();
      await advance(250);
      expect(socket.watches).toHaveLength(2);
    });

    it('retries once when nothing was accepted, then waits', async () => {
      const { socket, watch, goLive } = setup();
      goLive();
      watch('CT-01');
      await advance(250);

      socket.watches[0]?.ack([]);
      await advance(1_000);
      expect(socket.watches).toHaveLength(2);

      socket.watches[1]?.ack([]);
      await advance(10_000);
      expect(socket.watches).toHaveLength(2);
    });
  });

  describe('state posts', () => {
    it('sends at most 4 a second under 10 Hz frames, and only what changed', async () => {
      const { socket, ofType, posts, watch, goLive } = setup();
      goLive();
      watch('CT-01');
      socket.handlers.snapshot?.(
        snapshotOf({
          'CT-01': { receivedAt: T0, values: { fanSpeedRpm: 1000 } },
          'CT-02': { receivedAt: T0, values: { fanSpeedRpm: 500 } },
        }),
      );
      await advance(1_000);
      const settled = ofType('state').length;
      const firstFrameAt = posts.length;

      for (let step = 0; step < 20; step++) {
        socket.handlers.frames?.(
          frames('CT-01', Date.parse(T0) + 1_000 + step * 100, { fanSpeedRpm: 1000 + step }),
        );
        await advance(100);
      }
      await advance(250);

      const states = posts.slice(firstFrameAt).filter((post) => post.message.type === 'state');
      expect(states.length).toBeGreaterThan(0);
      expect(ofType('state').length).toBeGreaterThan(settled);
      for (const post of states) {
        const inWindow = states.filter(
          (other) => other.at >= post.at && other.at < post.at + 1_000,
        );
        expect(inWindow.length).toBeLessThanOrEqual(4);
        if (post.message.type === 'state') {
          expect(Object.keys(post.message.assets)).toEqual(['CT-01']);
        }
      }
    });

    it('does not post when a message changed nothing the main thread holds', async () => {
      const { socket, ofType, goLive } = setup();
      goLive();
      socket.handlers.snapshot?.(
        snapshotOf({ 'CT-01': { receivedAt: T0, values: { fanSpeedRpm: 1000 } } }),
      );
      await advance(1_000);
      const before = ofType('state').length;

      socket.handlers.frames?.({ frames: [] });
      await advance(1_000);

      expect(ofType('state')).toHaveLength(before);
    });
  });

  describe('series', () => {
    it('buffers numeric and boolean keys of watched assets only, on the receive time', async () => {
      const { socket, ofType, posts, watch, goLive } = setup();
      goLive();
      watch('CT-01');
      const receivedAt = Date.parse(T0) + 1_000;

      socket.handlers.frames?.(
        frames('CT-01', receivedAt, { fanSpeedRpm: 1420, running: true, state: 'up' }),
      );
      socket.handlers.frames?.(frames('CT-09', receivedAt, { fanSpeedRpm: 1 }));
      expect(ofType('series')).toHaveLength(0); // one post a second, never in the same turn
      await advance(1_000);

      const series = ofType('series');
      expect(series).toHaveLength(1);
      expect(series[0]?.entries.map((entry) => `${entry.assetCode}.${entry.key}`).sort()).toEqual([
        'CT-01.fanSpeedRpm',
        'CT-01.running',
      ]);
      const rpm = series[0]?.entries.find((entry) => entry.key === 'fanSpeedRpm');
      expect([...(rpm?.t ?? [])]).toEqual([receivedAt]); // not the device's `at`
      expect([...(rpm?.v ?? [])]).toEqual([1420]);
      const running = series[0]?.entries.find((entry) => entry.key === 'running');
      expect([...(running?.v ?? [])]).toEqual([1]);
      const transfer = posts.find((post) => post.message.type === 'series')?.transfer ?? [];
      expect(transfer).toHaveLength(4);
      expect(transfer.every((item) => item instanceof ArrayBuffer)).toBe(true);
    });

    it('posts at most once a second, with every point since', async () => {
      const { socket, ofType, watch, goLive } = setup();
      goLive();
      watch('CT-01');
      const base = Date.parse(T0);

      for (let second = 1; second <= 3; second++) {
        socket.handlers.frames?.(frames('CT-01', base + second * 1_000, { fanSpeedRpm: second }));
      }
      await advance(1_000);

      expect(ofType('series')).toHaveLength(1);
      expect([...(ofType('series')[0]?.entries[0]?.v ?? [])]).toEqual([1, 2, 3]);

      socket.handlers.frames?.(frames('CT-01', base + 4_000, { fanSpeedRpm: 4 }));
      await advance(999);
      expect(ofType('series')).toHaveLength(1);
      await advance(1);
      expect(ofType('series')).toHaveLength(2);
    });

    it('seeds older history under the live points', async () => {
      const { socket, send, ofType, watch, goLive } = setup();
      goLive();
      watch('CT-01');
      const base = Date.parse(T0);

      send({
        v,
        type: 'seed',
        assetCode: 'CT-01',
        series: [
          {
            key: 'fanSpeedRpm',
            t: new Float64Array([base - 10_000, base - 5_000]),
            v: new Float32Array([10, 20]),
          },
        ],
      });
      socket.handlers.frames?.(frames('CT-01', base + 1_000, { fanSpeedRpm: 30 }));
      await advance(1_000);

      const last = ofType('series').at(-1)?.entries[0];
      expect([...(last?.v ?? [])]).toEqual([10, 20, 30]);
    });

    it('ignores a seed for an asset it is not watching', async () => {
      const { send, ofType, watch } = setup();
      watch('CT-01');

      send({
        v,
        type: 'seed',
        assetCode: 'CT-02',
        series: [{ key: 'fanSpeedRpm', t: new Float64Array([1_000]), v: new Float32Array([1]) }],
      });
      await advance(2_000);

      expect(ofType('series')).toHaveLength(0);
    });

    it('drops the rings of an asset that leaves the set', async () => {
      const { socket, ofType, watch, goLive } = setup();
      goLive();
      const base = Date.parse(T0);
      watch('CT-01');
      socket.handlers.frames?.(frames('CT-01', base + 1_000, { fanSpeedRpm: 1 }));
      await advance(1_000);

      watch();
      watch('CT-01');
      socket.handlers.frames?.(frames('CT-01', base + 5_000, { fanSpeedRpm: 2 }));
      await advance(1_000);

      expect([...(ofType('series').at(-1)?.entries[0]?.v ?? [])]).toEqual([2]);
    });
  });

  describe('targets', () => {
    /** An engine that is live, with `slots` as layout 1 and its window over, as when the stage has been open a moment. */
    async function start(slots: TargetSlot[], layoutId = 1) {
      const rig = setup();
      rig.goLive();
      rig.send({ v, type: 'layout', layoutId, slots });
      await advance(20);
      return rig;
    }
    const targetPosts = (posts: ReturnType<typeof setup>['posts']) =>
      posts.filter((post) => post.message.type === 'targets');
    const at = (ms: number) => Date.parse(T0) + ms;

    it('holds each slot’s latest value as a number, in the order of the layout', async () => {
      const { socket, ofType } = await start([
        slot('CT-01', 'fanSpeedRpm'),
        slot('CT-01', 'running'),
        slot('CT-01', 'switchState', ['off', 'auto', 'hand']),
        slot('CT-02', 'fanSpeedRpm'),
      ]);

      socket.handlers.snapshot?.(
        snapshotOf({
          'CT-01': {
            receivedAt: T0,
            values: { fanSpeedRpm: 1420, running: true, switchState: 'hand' },
          },
        }),
      );
      await advance(20);

      const [first, ...rest] = ofType('targets');
      expect(rest).toHaveLength(0);
      expect(first?.layoutId).toBe(1);
      expect([...(first?.buffer ?? [])]).toEqual([1420, 1, 2, Number.NaN]);
    });

    it('is NaN for an asset or key with no value, a word that is not an enum value, a string for a number slot and a number that is not finite', async () => {
      const { socket, ofType } = await start([
        slot('CT-01', 'fanSpeedRpm'),
        slot('CT-99', 'fanSpeedRpm'),
        slot('CT-01', 'vibrationMms'),
        slot('CT-01', 'switchState', ['off', 'auto']),
        slot('CT-01', 'note'),
        slot('CT-01', 'motorTempC'),
      ]);

      socket.handlers.snapshot?.(
        snapshotOf({
          'CT-01': {
            receivedAt: T0,
            values: {
              fanSpeedRpm: 900,
              switchState: 'hand',
              note: 'text',
              motorTempC: Number.POSITIVE_INFINITY,
            },
          },
        }),
      );
      await advance(20);

      expect([...(ofType('targets')[0]?.buffer ?? [])]).toEqual([
        900,
        ...Array.from({ length: 5 }, () => Number.NaN),
      ]);
    });

    it('posts one buffer for a change and nothing for what changed no slot', async () => {
      const { socket, ofType } = await start([slot('CT-01', 'fanSpeedRpm')]);
      socket.handlers.snapshot?.(
        snapshotOf({ 'CT-01': { receivedAt: T0, values: { fanSpeedRpm: 1000 } } }),
      );
      await advance(20);
      expect(ofType('targets')).toHaveLength(1);

      // The same reading again, and another asset's overview: no slot holds a different number.
      socket.handlers.frames?.(frames('CT-01', at(1_000), { fanSpeedRpm: 1000 }));
      socket.handlers.overview?.({
        at: iso(at(1_000)),
        assets: {
          'CT-02': { online: true, receivedAt: iso(at(1_000)), headline: { fanSpeedRpm: 500 } },
        },
      });
      await advance(1_000);
      expect(ofType('targets')).toHaveLength(1);

      socket.handlers.frames?.(frames('CT-01', at(2_000), { fanSpeedRpm: 1001 }));
      await advance(20);
      expect(ofType('targets')).toHaveLength(2);
    });

    it('posts the first change at once and coalesces the rest of a 17 ms window into one more', async () => {
      const { socket, posts } = await start([slot('CT-01', 'fanSpeedRpm')]);

      socket.handlers.frames?.(frames('CT-01', at(100), { fanSpeedRpm: 1 }));
      expect(targetPosts(posts)).toHaveLength(1);
      await advance(5);
      socket.handlers.frames?.(frames('CT-01', at(105), { fanSpeedRpm: 2 }));
      await advance(5);
      socket.handlers.frames?.(frames('CT-01', at(110), { fanSpeedRpm: 3 }));
      expect(targetPosts(posts)).toHaveLength(1);
      await advance(20);

      const sent = targetPosts(posts);
      expect(sent).toHaveLength(2);
      const last = sent[1]?.message;
      expect(last?.type === 'targets' ? [...last.buffer] : null).toEqual([3]);
      expect((sent[1]?.at ?? 0) - (sent[0]?.at ?? 0)).toBeGreaterThanOrEqual(17);
    });

    it('never posts more than 60 buffers in any second, however fast values change', async () => {
      const { socket, posts } = await start([slot('CT-01', 'fanSpeedRpm')]);

      for (let step = 1; step <= 1_000; step++) {
        socket.handlers.frames?.(frames('CT-01', at(step), { fanSpeedRpm: step }));
        await advance(1);
      }
      await advance(20);

      const times = targetPosts(posts).map((post) => post.at);
      for (const time of times) {
        expect(
          times.filter((other) => other >= time && other < time + 1_000).length,
        ).toBeLessThanOrEqual(60);
      }
      expect(times.length).toBeGreaterThan(50);
    });

    it('posts one buffer per changed frame for 30 slots and a frame every 100 ms, and none on a quiet socket', async () => {
      const keys = Array.from({ length: 30 }, (_, index) => `k${index}`);
      const { socket, posts } = await start(keys.map((key) => slot('CT-01', key)));

      for (let frame = 0; frame < 30; frame++) {
        socket.handlers.frames?.(
          frames('CT-01', at(frame * 100), { [keys[frame] ?? '']: frame + 1 }),
        );
        await advance(100);
      }

      expect(targetPosts(posts)).toHaveLength(30);
      for (const post of targetPosts(posts)) {
        expect(post.message.type === 'targets' ? post.message.buffer.length : 0).toBe(30);
      }

      await advance(5_000);
      expect(targetPosts(posts)).toHaveLength(30);
    });

    it('posts nothing while every slot is still without a value', async () => {
      const { socket, ofType } = await start([
        slot('CT-01', 'fanSpeedRpm'),
        slot('CT-02', 'running'),
      ]);

      socket.handlers.status?.({ upstream: 'live', since: T0 });
      socket.handlers.overview?.({ at: iso(at(1_000)), assets: {} });
      await advance(5_000);

      expect(ofType('targets')).toHaveLength(0);
    });

    it('posts the held values again, with the new id, when the layout changes', async () => {
      const { socket, send, ofType } = await start([slot('CT-01', 'fanSpeedRpm')], 1);
      socket.handlers.snapshot?.(
        snapshotOf({ 'CT-01': { receivedAt: T0, values: { fanSpeedRpm: 1000 } } }),
      );
      await advance(20);

      send({ v, type: 'layout', layoutId: 2, slots: [slot('CT-01', 'fanSpeedRpm')] });
      await advance(20);

      const sent = ofType('targets');
      expect(sent.map((message) => message.layoutId)).toEqual([1, 2]);
      expect([...(sent[1]?.buffer ?? [])]).toEqual([1000]);
    });

    it('stops posting for an empty layout', async () => {
      const { socket, send, ofType } = await start([slot('CT-01', 'fanSpeedRpm')]);
      socket.handlers.snapshot?.(
        snapshotOf({ 'CT-01': { receivedAt: T0, values: { fanSpeedRpm: 1000 } } }),
      );
      await advance(20);

      send({ v, type: 'layout', layoutId: 2, slots: [] });
      await advance(20);
      socket.handlers.frames?.(frames('CT-01', at(1_000), { fanSpeedRpm: 1200 }));
      await advance(1_000);

      expect(ofType('targets')).toHaveLength(1);
    });

    it('takes a layout before the socket is live, and posts when the first values arrive', async () => {
      const { socket, send, ofType } = setup();

      send({ v, type: 'layout', layoutId: 1, slots: [slot('CT-01', 'fanSpeedRpm')] });
      await advance(20);
      socket.handlers.snapshot?.(
        snapshotOf({ 'CT-01': { receivedAt: T0, values: { fanSpeedRpm: 700 } } }),
      );
      await advance(20);

      expect([...(ofType('targets')[0]?.buffer ?? [])]).toEqual([700]);
    });

    it('posts nothing after dispose', async () => {
      const { socket, send, ofType } = await start([slot('CT-01', 'fanSpeedRpm')]);

      send({ v, type: 'dispose' });
      socket.handlers.frames?.(frames('CT-01', at(1_000), { fanSpeedRpm: 5 }));
      send({ v, type: 'layout', layoutId: 2, slots: [slot('CT-01', 'fanSpeedRpm')] });
      await advance(1_000);

      expect(ofType('targets')).toHaveLength(0);
    });

    it('sends no message per reading: a thousand readings are a handful of posts', async () => {
      const slots = Array.from({ length: 100 }, (_, index) => slot('CT-01', `k${index}`));
      const { socket, posts } = await start(slots);

      for (let batch = 0; batch < 10; batch++) {
        socket.handlers.frames?.({
          frames: Array.from({ length: 5 }, (_, asset) => ({
            assetCode: `CT-0${asset + 1}`,
            at: '2026-10-15T07:00:00.000Z',
            receivedAt: iso(at(1_000 + batch)),
            values: Object.fromEntries(
              Array.from({ length: 20 }, (_, key) => [`k${key}`, batch * 100 + asset * 20 + key]),
            ),
          })),
        });
      }
      await advance(1_000);

      for (const post of posts) {
        expect(['tokenRequest', 'state', 'series', 'targets', 'stats']).toContain(
          post.message.type,
        );
      }
      // One at once and one when the window ends, however many frames came in that window.
      expect(targetPosts(posts).length).toBeLessThanOrEqual(2);
      expect(posts.length).toBeLessThan(20);
    });

    it('allocates a buffer for each post, and compares with its own copy once a transfer has detached the posted one', async () => {
      const { socket, posts } = await start([slot('CT-01', 'fanSpeedRpm')]);
      socket.handlers.frames?.(frames('CT-01', at(100), { fanSpeedRpm: 1000 }));
      await advance(20);
      const first = targetPosts(posts)[0];
      if (first?.message.type !== 'targets') throw new Error('no targets post');

      expect(first.transfer).toEqual([first.message.buffer.buffer]);
      // What a worker's post does to the buffer it transfers.
      structuredClone(first.message.buffer, { transfer: first.transfer });
      expect(first.message.buffer.byteLength).toBe(0);

      socket.handlers.frames?.(frames('CT-01', at(200), { fanSpeedRpm: 1000 }));
      await advance(20);
      expect(targetPosts(posts)).toHaveLength(1);

      socket.handlers.frames?.(frames('CT-01', at(300), { fanSpeedRpm: 1001 }));
      await advance(20);
      const second = targetPosts(posts)[1]?.message;
      expect(second?.type === 'targets' ? [...second.buffer] : null).toEqual([1001]);
      // `Object.is`, not `.not.toBe`: on a pass the matcher still builds a diff hint, which reads the detached buffer.
      expect(
        Object.is(second?.type === 'targets' ? second.buffer : null, first.message.buffer),
      ).toBe(false);
    });
  });

  describe('stats', () => {
    it('counts the overview, snapshot, frames and status messages, and posts the count once a second', async () => {
      const { socket, ofType, goLive } = setup();
      goLive();

      socket.handlers.status?.({ upstream: 'live', since: T0 });
      socket.handlers.overview?.({ at: T0, assets: {} });
      socket.handlers.snapshot?.(snapshotOf({}));
      socket.handlers.frames?.({ frames: [] });
      expect(ofType('stats')).toHaveLength(0);
      await advance(1_000);

      expect(ofType('stats')).toEqual([{ v, type: 'stats', messages: 4, targetPosts: 0 }]);
    });

    it('posts nothing while the counts have not changed', async () => {
      const { socket, ofType, goLive } = setup();
      goLive();
      socket.handlers.frames?.({ frames: [] });
      await advance(1_000);

      await advance(10_000);

      expect(ofType('stats')).toHaveLength(1);
    });

    it('counts the buffers it posts', async () => {
      const { socket, send, ofType, goLive } = setup();
      goLive();
      send({ v, type: 'layout', layoutId: 1, slots: [slot('CT-01', 'fanSpeedRpm')] });
      await advance(20);

      socket.handlers.frames?.(frames('CT-01', Date.parse(T0) + 100, { fanSpeedRpm: 1 }));
      await advance(20);
      socket.handlers.frames?.(frames('CT-01', Date.parse(T0) + 200, { fanSpeedRpm: 2 }));
      await advance(1_000);

      expect(ofType('stats').at(-1)).toEqual({ v, type: 'stats', messages: 2, targetPosts: 2 });
    });

    it('is cumulative and at most once a second under a message every 100 ms', async () => {
      const { socket, posts, goLive } = setup();
      goLive();

      for (let step = 0; step < 25; step++) {
        socket.handlers.frames?.(
          frames('CT-01', Date.parse(T0) + step * 100, { fanSpeedRpm: step }),
        );
        await advance(100);
      }
      await advance(1_000);

      const stats = posts.filter((post) => post.message.type === 'stats');
      const counts = stats.map((post) =>
        post.message.type === 'stats' ? post.message.messages : 0,
      );
      expect(counts.at(-1)).toBe(25);
      expect([...counts].sort((a, b) => a - b)).toEqual(counts);
      for (let index = 1; index < stats.length; index++) {
        expect((stats[index]?.at ?? 0) - (stats[index - 1]?.at ?? 0)).toBeGreaterThanOrEqual(1_000);
      }
    });
  });

  describe('retry and dispose', () => {
    it('reconnects on retry and sends the set again', async () => {
      const { socket, send, watch, goLive, lastState } = setup();
      goLive();
      watch('CT-01');
      await advance(250);
      socket.watches[0]?.ack(['CT-01']);

      send({ v, type: 'retry' });
      expect(socket.disconnects).toBe(1);
      expect(socket.connects).toBe(1);
      await advance(250);
      expect(lastState().socket).toBe('reconnecting');

      goLive();
      await advance(250);
      expect(socket.watches).toHaveLength(2);
    });

    it('disposes once, and then ignores everything', async () => {
      const { socket, send, ofType, goLive } = setup();
      goLive();
      await advance(250);
      const before = ofType('state').length;

      send({ v, type: 'dispose' });
      send({ v, type: 'dispose' });
      socket.handlers.overview?.({ at: T0, assets: {} });
      socket.handlers.disconnect?.();
      await advance(60_000);

      expect(socket.disconnects).toBe(1);
      expect(ofType('state')).toHaveLength(before);
    });
  });
});
