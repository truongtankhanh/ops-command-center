import type { AssetTelemetry, TelemetryFrames, TelemetryOverview } from '@occ/contracts';
import { api, ApiRequestError } from '../api/client';
import type * as ApiClient from '../api/client';
import { getAccessToken, renewSession } from '../auth/session';
import {
  createTelemetryClient,
  seriesFromHistory,
  seriesKey,
  type TargetsView,
  type TelemetryClientOptions,
  type WorkerLike,
} from './telemetryClient';
import type { AuthCallback, EngineSocket } from './telemetryEngine';
import { type TargetSlot, TELEMETRY_PROTOCOL_VERSION } from './telemetryProtocol';

vi.mock('../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  api: { get: vi.fn() },
}));

const v = TELEMETRY_PROTOCOL_VERSION;
const T0 = '2026-10-15T08:00:00.000Z';
const BASE = Date.parse(T0);

/** A socket the test drives by hand; the in-thread engine runs on it. */
class FakeSocket implements EngineSocket {
  active = true;
  connects = 0;
  handlers: {
    connect?: () => void;
    disconnect?: () => void;
    connectError?: (message: string) => void;
    overview?: (overview: TelemetryOverview) => void;
    frames?: (batch: TelemetryFrames) => void;
  } = {};
  onConnect(handler: () => void) {
    this.handlers.connect = handler;
  }
  onDisconnect(handler: () => void) {
    this.handlers.disconnect = handler;
  }
  onReconnectAttempt() {}
  onConnectError(handler: (message: string) => void) {
    this.handlers.connectError = handler;
  }
  onOverview(handler: (overview: TelemetryOverview) => void) {
    this.handlers.overview = handler;
  }
  onSnapshot() {}
  onFrames(handler: (batch: TelemetryFrames) => void) {
    this.handlers.frames = handler;
  }
  onStatus() {}
  watch() {}
  connect() {
    this.connects += 1;
  }
  disconnect() {}
}

/** Lets the microtasks of the in-thread engine and the async client calls run. */
async function settle() {
  for (let round = 0; round < 6; round++) await vi.advanceTimersByTimeAsync(0);
}

async function setupInThread(options: TelemetryClientOptions = {}) {
  let socket: FakeSocket | undefined;
  let auth: AuthCallback | undefined;
  const client = createTelemetryClient({
    createWorker: () => null,
    createSocket: (callback) => {
      auth = callback;
      return (socket = new FakeSocket());
    },
    ...options,
  });
  await settle();
  return { client, socket: socket!, auth: auth! };
}

function createFakeWorker() {
  const posted: { message: Record<string, unknown>; transfer?: Transferable[] }[] = [];
  const worker: WorkerLike & { posted: typeof posted; emit(data: unknown): void } = {
    posted,
    onmessage: null,
    postMessage: vi.fn((message: unknown, options?: { transfer?: Transferable[] }) => {
      posted.push({ message: message as Record<string, unknown>, transfer: options?.transfer });
    }),
    terminate: vi.fn(),
    emit(data) {
      worker.onmessage?.(new MessageEvent('message', { data }));
    },
  };
  return worker;
}

const history = (
  samples: { at: string; values: AssetTelemetry['samples'][number]['values'] }[],
): AssetTelemetry => ({
  assetCode: 'CT-01',
  from: T0,
  to: T0,
  bucketS: 5,
  samples,
});

const bucket = (seconds: number, values: AssetTelemetry['samples'][number]['values']) => ({
  at: new Date(BASE + seconds * 1000).toISOString(),
  values,
});

const frames = (assetCode: string, receivedAtMs: number, values: Record<string, number>) => ({
  frames: [
    {
      assetCode,
      at: new Date(receivedAtMs).toISOString(),
      receivedAt: new Date(receivedAtMs).toISOString(),
      values,
    },
  ],
});

describe('seriesFromHistory', () => {
  it('makes one series per key from numbers and booleans, in time order', () => {
    const series = seriesFromHistory(
      history([
        bucket(0, { fanSpeedRpm: 1000, running: true }),
        bucket(5, { fanSpeedRpm: 1100 }),
        bucket(10, { fanSpeedRpm: 1200, running: false }),
      ]),
    );

    const rpm = series.find((entry) => entry.key === 'fanSpeedRpm');
    const running = series.find((entry) => entry.key === 'running');
    expect([...(rpm?.t ?? [])]).toEqual([BASE, BASE + 5_000, BASE + 10_000]);
    expect([...(rpm?.v ?? [])]).toEqual([1000, 1100, 1200]);
    expect([...(running?.t ?? [])]).toEqual([BASE, BASE + 10_000]);
    expect([...(running?.v ?? [])]).toEqual([1, 0]);
    expect(rpm?.t).toBeInstanceOf(Float64Array);
    expect(rpm?.v).toBeInstanceOf(Float32Array);
  });

  it('leaves out enum strings and a sample with an unreadable time', () => {
    const series = seriesFromHistory(
      history([
        bucket(0, { armPosition: 'up', openCount: 3 }),
        { at: 'not a time', values: { openCount: 99 } },
      ]),
    );

    expect(series.map((entry) => entry.key)).toEqual(['openCount']);
    expect([...(series[0]?.v ?? [])]).toEqual([3]);
  });

  it('is empty for an asset with no samples', () => {
    expect(seriesFromHistory(history([]))).toEqual([]);
  });
});

/** Two slots of a cooling tower: a number and an enum. */
const SLOTS: TargetSlot[] = [
  { assetCode: 'CT-01', key: 'fanSpeedRpm', enumValues: null },
  { assetCode: 'CT-01', key: 'switchState', enumValues: ['off', 'auto', 'hand'] },
];

describe('telemetry client, engine in this thread', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.mocked(getAccessToken).mockResolvedValue('token-1');
    vi.mocked(renewSession).mockResolvedValue(true);
    vi.mocked(api.get).mockResolvedValue(history([]));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.mocked(api.get).mockReset();
    vi.mocked(getAccessToken).mockReset();
    vi.mocked(renewSession).mockReset();
  });

  describe('token', () => {
    it('answers the handshake with the current access token', async () => {
      const { auth } = await setupInThread();
      const send = vi.fn();

      auth(send);
      await settle();

      expect(send).toHaveBeenCalledExactlyOnceWith({ token: 'token-1' });
    });

    it('sends an empty token when there is no session', async () => {
      vi.mocked(getAccessToken).mockResolvedValue(null);
      const { auth } = await setupInThread();
      const send = vi.fn();

      auth(send);
      await settle();

      expect(send).toHaveBeenCalledExactlyOnceWith({ token: '' });
    });

    it('renews the session once for a refused handshake, then reconnects', async () => {
      const { socket } = await setupInThread();

      socket.active = false;
      socket.handlers.connectError?.('Unauthorized');
      await settle();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(renewSession).toHaveBeenCalledTimes(1);
      expect(socket.connects).toBe(1);
    });

    it('asks for no reconnect when the session could not be renewed', async () => {
      vi.mocked(renewSession).mockResolvedValue(false);
      const { socket } = await setupInThread();

      socket.active = false;
      socket.handlers.connectError?.('Unauthorized');
      await settle();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(socket.connects).toBe(0);
    });
  });

  describe('history', () => {
    it('seeds a newly watched asset from the history route, under the live points', async () => {
      vi.mocked(api.get).mockResolvedValue(
        history([
          bucket(-10, { fanSpeedRpm: 1000, armPosition: 'up' }),
          bucket(-5, { fanSpeedRpm: 1100 }),
        ]),
      );
      const { client, socket } = await setupInThread();
      socket.handlers.connect?.();

      client.setWatch(['CT-01']);
      await settle();
      socket.handlers.frames?.(frames('CT-01', BASE + 1_000, { fanSpeedRpm: 1200 }));
      await vi.advanceTimersByTimeAsync(1_000);
      await settle();

      expect(api.get).toHaveBeenCalledExactlyOnceWith('/assets/CT-01/telemetry');
      const series = client.getView().series;
      expect([...series.keys()]).toEqual([seriesKey('CT-01', 'fanSpeedRpm')]);
      expect([...(series.get('CT-01|fanSpeedRpm')?.v ?? [])]).toEqual([1000, 1100, 1200]);
    });

    it('seeds only the assets that are new to the set', async () => {
      const { client } = await setupInThread();

      client.setWatch(['CT-01']);
      client.setWatch(['CT-01', 'CT-02']);
      client.setWatch(['CT-01', 'CT-02']);
      await settle();

      expect(vi.mocked(api.get).mock.calls.map(([path]) => path)).toEqual([
        '/assets/CT-01/telemetry',
        '/assets/CT-02/telemetry',
      ]);
    });

    it('treats a failed history request as no history', async () => {
      vi.mocked(api.get).mockRejectedValue(new ApiRequestError(404, 'Not found'));
      const { client, socket } = await setupInThread();
      socket.handlers.connect?.();

      client.setWatch(['CT-01']);
      await settle();
      socket.handlers.frames?.(frames('CT-01', BASE + 1_000, { fanSpeedRpm: 1200 }));
      await vi.advanceTimersByTimeAsync(1_000);
      await settle();

      expect([...(client.getView().series.get('CT-01|fanSpeedRpm')?.v ?? [])]).toEqual([1200]);
    });

    it('drops a history answer for an asset that is no longer watched', async () => {
      let answer!: (value: AssetTelemetry) => void;
      vi.mocked(api.get).mockReturnValue(new Promise((resolve) => (answer = resolve)));
      const { client } = await setupInThread();

      client.setWatch(['CT-01']);
      client.setWatch([]);
      answer(history([bucket(-5, { fanSpeedRpm: 1 })]));
      await settle();
      await vi.advanceTimersByTimeAsync(2_000);

      expect(client.getView().series.size).toBe(0);
    });

    it('seeds again when the socket is back, to fill the gap', async () => {
      const { client, socket } = await setupInThread();
      client.setWatch(['CT-01']);
      socket.handlers.connect?.();
      await vi.advanceTimersByTimeAsync(250);
      await settle();
      expect(api.get).toHaveBeenCalledTimes(1);

      socket.handlers.disconnect?.();
      await vi.advanceTimersByTimeAsync(250);
      await settle();
      socket.handlers.connect?.();
      await vi.advanceTimersByTimeAsync(250);
      await settle();

      expect(api.get).toHaveBeenCalledTimes(2);
    });

    it('forgets the series of an asset that leaves the set', async () => {
      vi.mocked(api.get).mockResolvedValue(history([bucket(-5, { fanSpeedRpm: 1 })]));
      const { client, socket } = await setupInThread();
      socket.handlers.connect?.();
      client.setWatch(['CT-01', 'CT-02']);
      await settle();
      await vi.advanceTimersByTimeAsync(1_000);
      await settle();
      expect(client.getView().series.size).toBe(2);

      client.setWatch(['CT-02']);

      expect([...client.getView().series.keys()]).toEqual([seriesKey('CT-02', 'fanSpeedRpm')]);
    });
  });

  describe('state', () => {
    it('re-anchors the server clock on this thread, from the time the worker posted', async () => {
      vi.spyOn(performance, 'now').mockReturnValue(7_000);
      const { client, socket } = await setupInThread();
      const at = BASE + 1_000;

      socket.handlers.overview?.({ at: new Date(at).toISOString(), assets: {} });
      await settle();

      expect(client.getView().state.serverClock).toEqual({ at, mono: 7_000 });
    });

    it('keeps the identity of the view until something changes, and tells subscribers', async () => {
      const { client, socket } = await setupInThread();
      const listener = vi.fn();
      const stop = client.subscribe(listener);
      const before = client.getView();

      expect(client.getView()).toBe(before);
      socket.handlers.connect?.();
      await settle();

      expect(client.getView()).not.toBe(before);
      expect(client.getView().state.socket).toBe('live');
      expect(listener).toHaveBeenCalled();

      stop();
      listener.mockClear();
      socket.handlers.disconnect?.();
      await vi.advanceTimersByTimeAsync(250);
      await settle();
      expect(listener).not.toHaveBeenCalled();
    });

    it('reconnects on retry', async () => {
      const { client, socket } = await setupInThread();

      client.retry();
      await settle();

      expect(socket.connects).toBe(1);
    });
  });

  it('disposes once and ignores what follows', async () => {
    const { client, socket } = await setupInThread();
    socket.handlers.connect?.();
    await settle();
    const view = client.getView();

    client.dispose();
    client.dispose();
    await settle();
    socket.handlers.overview?.({ at: T0, assets: {} });
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();

    expect(client.getView()).toBe(view);
  });
});

describe('telemetry client targets, engine in this thread', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('delivers the buffer of the current layout through the engine, as a worker would', async () => {
    const { client, socket } = await setupInThread();
    const listener = vi.fn();
    client.onTargets(listener);

    const id = client.setLayout(SLOTS);
    await settle();
    socket.handlers.frames?.(frames('CT-01', BASE + 100, { fanSpeedRpm: 1420 }));
    await vi.advanceTimersByTimeAsync(20);
    await settle();

    expect(id).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    const received = listener.mock.calls[0]?.[0] as TargetsView;
    expect(received.layoutId).toBe(1);
    expect([...received.buffer]).toEqual([1420, Number.NaN]);
    expect(client.getTargets()).toBe(received);
  });

  it('does not put targets in the view, and carries the engine’s counts', async () => {
    const { client, socket } = await setupInThread();
    const viewListener = vi.fn();
    client.subscribe(viewListener);
    client.setLayout(SLOTS);
    await settle();

    socket.handlers.frames?.(frames('CT-01', BASE + 100, { fanSpeedRpm: 1420 }));
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();

    expect(client.getTargets()).not.toBeNull();
    expect(client.getView().series.size).toBe(0);
    expect(client.getStats()).toEqual({ messages: 1, targetPosts: 1 });
  });
});

describe('telemetry client, worker', () => {
  beforeEach(() => {
    vi.mocked(getAccessToken).mockResolvedValue('token-1');
    vi.mocked(renewSession).mockResolvedValue(true);
    vi.mocked(api.get).mockResolvedValue(history([]));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(api.get).mockReset();
    vi.mocked(getAccessToken).mockReset();
    vi.mocked(renewSession).mockReset();
  });

  it('starts the worker and passes it the watch set', () => {
    const worker = createFakeWorker();
    const client = createTelemetryClient({ createWorker: () => worker });

    client.setWatch(['CT-01', 'CT-01', 'CT-02']);

    expect(worker.posted.map((post) => post.message)).toEqual([
      { v, type: 'connect' },
      { v, type: 'watch', assets: ['CT-01', 'CT-02'] },
    ]);
  });

  it('answers a token request, and a renewal request after renewing', async () => {
    const worker = createFakeWorker();
    createTelemetryClient({ createWorker: () => worker });

    worker.emit({ v, type: 'tokenRequest', requestId: 1, renew: false });
    await vi.waitFor(() => expect(worker.posted).toHaveLength(2));
    worker.emit({ v, type: 'tokenRequest', requestId: 2, renew: true });
    await vi.waitFor(() => expect(worker.posted).toHaveLength(3));

    expect(worker.posted[1]?.message).toEqual({ v, type: 'token', requestId: 1, token: 'token-1' });
    expect(worker.posted[2]?.message).toEqual({ v, type: 'token', requestId: 2, token: 'token-1' });
    expect(renewSession).toHaveBeenCalledTimes(1);
  });

  it('answers null when the session cannot be renewed', async () => {
    vi.mocked(renewSession).mockResolvedValue(false);
    const worker = createFakeWorker();
    createTelemetryClient({ createWorker: () => worker });

    worker.emit({ v, type: 'tokenRequest', requestId: 5, renew: true });
    await vi.waitFor(() => expect(worker.posted).toHaveLength(2));

    expect(worker.posted[1]?.message).toEqual({ v, type: 'token', requestId: 5, token: null });
  });

  it('merges a state message and keeps unchanged assets by identity', () => {
    const worker = createFakeWorker();
    const client = createTelemetryClient({ createWorker: () => worker });
    const asset = (rpm: number) => ({
      online: true,
      receivedAt: T0,
      headline: {},
      values: { fanSpeedRpm: rpm },
      keyReceivedAt: { fanSpeedRpm: T0 },
    });
    const state = (assets: Record<string, ReturnType<typeof asset>>) => ({
      v,
      type: 'state',
      upstream: 'live',
      upstreamSince: T0,
      socket: 'live',
      socketSince: null,
      serverNowMs: BASE,
      assets,
    });

    worker.emit(state({ 'CT-01': asset(1000), 'CT-02': asset(500) }));
    const first = client.getView().state.assets['CT-02'];
    worker.emit(state({ 'CT-01': asset(1100) }));

    const { assets } = client.getView().state;
    expect(assets['CT-01']?.values.fanSpeedRpm).toBe(1100);
    expect(assets['CT-02']).toBe(first);
  });

  it('stores a series message under its asset and key', () => {
    const worker = createFakeWorker();
    const client = createTelemetryClient({ createWorker: () => worker });

    worker.emit({
      v,
      type: 'series',
      entries: [
        {
          assetCode: 'CT-01',
          key: 'fanSpeedRpm',
          t: new Float64Array([BASE]),
          v: new Float32Array([1420]),
        },
      ],
    });

    const series = client.getView().series.get(seriesKey('CT-01', 'fanSpeedRpm'));
    expect([...(series?.v ?? [])]).toEqual([1420]);
  });

  it('ignores a message of another version and one it does not know', () => {
    const worker = createFakeWorker();
    const client = createTelemetryClient({ createWorker: () => worker });
    const before = client.getView();

    worker.emit({ v: v + 1, type: 'state', assets: {} });
    worker.emit({ v, type: 'unknown' });
    worker.emit('state');

    expect(client.getView()).toBe(before);
  });

  it('terminates the worker once on dispose, after telling it', () => {
    const worker = createFakeWorker();
    const client = createTelemetryClient({ createWorker: () => worker });

    client.dispose();
    client.dispose();
    client.setWatch(['CT-01']);
    client.retry();

    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.posted.map((post) => post.message.type)).toEqual(['connect', 'dispose']);
  });

  describe('targets', () => {
    const targetsMessage = (layoutId: number, ...numbers: number[]) => ({
      v,
      type: 'targets',
      layoutId,
      buffer: Float32Array.from(numbers),
    });

    it('sends the layout to the worker as plain copies, and returns its id', () => {
      const worker = createFakeWorker();
      const client = createTelemetryClient({ createWorker: () => worker });

      const first = client.setLayout(SLOTS);
      const second = client.setLayout([]);

      expect([first, second]).toEqual([1, 2]);
      const message = worker.posted[1]?.message;
      expect(message).toEqual({ v, type: 'layout', layoutId: 1, slots: SLOTS });
      expect((message?.slots as TargetSlot[])[1]?.enumValues).not.toBe(SLOTS[1]?.enumValues);
      expect(worker.posted[2]?.message).toEqual({ v, type: 'layout', layoutId: 2, slots: [] });
    });

    it('gives a buffer of the current layout to every listener, and keeps the latest', () => {
      const worker = createFakeWorker();
      const client = createTelemetryClient({ createWorker: () => worker });
      const one = vi.fn();
      const two = vi.fn();
      client.onTargets(one);
      client.onTargets(two);
      client.setLayout(SLOTS);

      expect(client.getTargets()).toBeNull();
      worker.emit(targetsMessage(1, 1420, 2));

      expect(one).toHaveBeenCalledTimes(1);
      expect(two).toHaveBeenCalledTimes(1);
      const received = one.mock.calls[0]?.[0] as TargetsView;
      expect(received.layoutId).toBe(1);
      expect([...received.buffer]).toEqual([1420, 2]);
      expect(client.getTargets()).toBe(received);
    });

    it('ignores a buffer built for layout 3 once layout 4 is set', () => {
      const worker = createFakeWorker();
      const client = createTelemetryClient({ createWorker: () => worker });
      const listener = vi.fn();
      client.onTargets(listener);
      client.setLayout(SLOTS);
      client.setLayout(SLOTS);
      client.setLayout(SLOTS);

      worker.emit(targetsMessage(3, 1, 2));
      expect(listener).toHaveBeenCalledTimes(1);

      expect(client.setLayout(SLOTS)).toBe(4);
      worker.emit(targetsMessage(3, 5, 6));
      expect(listener).toHaveBeenCalledTimes(1);
      expect(client.getTargets()).toBeNull();

      worker.emit(targetsMessage(4, 7, 8));
      expect(listener).toHaveBeenCalledTimes(2);
      expect(client.getTargets()?.layoutId).toBe(4);
      expect([...(client.getTargets()?.buffer ?? [])]).toEqual([7, 8]);
    });

    it('ignores a buffer when no layout has been set', () => {
      const worker = createFakeWorker();
      const client = createTelemetryClient({ createWorker: () => worker });
      const listener = vi.fn();
      client.onTargets(listener);

      worker.emit(targetsMessage(0, 1));
      worker.emit(targetsMessage(1, 1));

      expect(listener).not.toHaveBeenCalled();
      expect(client.getTargets()).toBeNull();
    });

    it('stops calling a listener that has unsubscribed', () => {
      const worker = createFakeWorker();
      const client = createTelemetryClient({ createWorker: () => worker });
      const listener = vi.fn();
      const stop = client.onTargets(listener);
      client.setLayout(SLOTS);

      stop();
      worker.emit(targetsMessage(1, 1, 2));

      expect(listener).not.toHaveBeenCalled();
    });

    it('never touches the view, its listeners or React: a buffer is not a view change', () => {
      const worker = createFakeWorker();
      const client = createTelemetryClient({ createWorker: () => worker });
      const viewListener = vi.fn();
      client.subscribe(viewListener);
      client.setLayout(SLOTS);
      const before = client.getView();

      worker.emit(targetsMessage(1, 1420, 2));
      worker.emit({ v, type: 'stats', messages: 10, targetPosts: 3 });

      expect(client.getView()).toBe(before);
      expect(viewListener).not.toHaveBeenCalled();
    });

    it('keeps the worker’s counts, zeros before the first', () => {
      const worker = createFakeWorker();
      const client = createTelemetryClient({ createWorker: () => worker });
      expect(client.getStats()).toEqual({ messages: 0, targetPosts: 0 });

      worker.emit({ v, type: 'stats', messages: 120, targetPosts: 37 });

      expect(client.getStats()).toEqual({ messages: 120, targetPosts: 37 });
    });

    it('ignores a targets message of another version', () => {
      const worker = createFakeWorker();
      const client = createTelemetryClient({ createWorker: () => worker });
      const listener = vi.fn();
      client.onTargets(listener);
      client.setLayout(SLOTS);

      worker.emit({ ...targetsMessage(1, 1), v: v + 1 });

      expect(listener).not.toHaveBeenCalled();
    });

    it('sends nothing and calls no one after dispose', () => {
      const worker = createFakeWorker();
      const client = createTelemetryClient({ createWorker: () => worker });
      const listener = vi.fn();
      client.onTargets(listener);
      client.setLayout(SLOTS);

      client.dispose();
      const id = client.setLayout(SLOTS);
      worker.emit(targetsMessage(1, 1, 2));

      expect(id).toBe(1);
      expect(listener).not.toHaveBeenCalled();
      expect(worker.posted.map((post) => post.message.type)).toEqual([
        'connect',
        'layout',
        'dispose',
      ]);
    });
  });
});
