import {
  type EventsHandshakeAuth,
  EventsConnectErrors,
  TELEMETRY_NAMESPACE,
  TELEMETRY_WATCH_LIMIT,
  type TelemetryClientToServerEvents,
  TelemetryEvents,
  type TelemetryFrames,
  type TelemetryOverview,
  type TelemetryServerToClientEvents,
  type TelemetrySnapshot,
  type TelemetryStatus,
  type TelemetryValue,
} from '@occ/contracts';
import { io, type Socket } from 'socket.io-client';
import { createRingBuffer, encodeReading, type RingBuffer } from '../lib/telemetry/ringBuffer';
import { serverNow } from '../lib/telemetry/telemetryFreshness';
import {
  type AssetTelemetryState,
  applyMessage,
  initialTelemetryState,
  type SocketState,
  type TelemetryMessage,
  type TelemetryState,
} from '../lib/telemetry/telemetryState';
import {
  type FromWorker,
  type SeriesData,
  type TargetSlot,
  TELEMETRY_PROTOCOL_VERSION,
  type ToWorker,
} from './telemetryProtocol';

/**
 * The `/telemetry` socket and everything that depends on its behaviour: the token handshake,
 * reconnects, the watch set, the ring buffers and the coalesced posts to the main thread
 * (ADR-0019, ADR-0020 § State). It is the same code in the worker and, where there is no `Worker`,
 * in the main thread: both ends only differ in the `host` they hand it, so the console has one
 * set of rules and one place to test them.
 *
 * It decides nothing about freshness: that is a pure module the main thread calls with the
 * catalogue, which this engine never has (V2-08.4).
 */

/** The handshake's `auth`: Socket.IO calls it on every (re)connect, so the token is never stale. */
export type AuthCallback = (send: (payload: EventsHandshakeAuth) => void) => void;

/**
 * What the engine needs from a socket, in its own words, so a test can fake it without Socket.IO.
 * `createIoSocket` adapts the real client.
 */
export interface EngineSocket {
  /** Socket.IO is retrying by itself (a transport failure); `false` after a refused handshake. */
  readonly active: boolean;
  onConnect(handler: () => void): void;
  onDisconnect(handler: () => void): void;
  onReconnectAttempt(handler: () => void): void;
  onConnectError(handler: (message: string) => void): void;
  onOverview(handler: (overview: TelemetryOverview) => void): void;
  onSnapshot(handler: (snapshot: TelemetrySnapshot) => void): void;
  onFrames(handler: (batch: TelemetryFrames) => void): void;
  onStatus(handler: (status: TelemetryStatus) => void): void;
  /** `onAck(null)`: no answer in time, as an older replica never answers (ADR-0019). */
  watch(assets: string[], onAck: (accepted: readonly string[] | null) => void): void;
  connect(): void;
  disconnect(): void;
}

export type SocketFactory = (auth: AuthCallback) => EngineSocket;

export interface EngineHost {
  /** `transfer` lists the buffers to hand over instead of copying; a host may ignore it. */
  post(message: FromWorker, transfer?: Transferable[]): void;
}

export interface TelemetryEngine {
  receive(message: ToWorker): void;
}

export interface EngineOptions {
  host: EngineHost;
  createSocket?: SocketFactory;
}

/** Retries after a refused handshake: from 1 s, doubling up to 30 s, with ±50 % jitter. */
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 30_000;
/** The main thread normally answers at once; this only keeps a stuck one from hanging a connect. */
const TOKEN_TIMEOUT_MS = 10_000;
/** A renewal is a network round trip to the identity provider. */
const RENEW_TIMEOUT_MS = 30_000;
const WATCH_ACK_TIMEOUT_MS = 2000;
/** The server allows 5 `telemetry.watch` a second per socket (ADR-0019); this keeps to 4. */
const WATCH_MIN_INTERVAL_MS = 250;
/** One more try when the answer accepted nothing: the limit may have been hit. */
const WATCH_RETRY_MS = 1000;
/** The main thread hears about state at most 4 times a second (ADR-0019). */
const STATE_MIN_INTERVAL_MS = 250;
/** A ring takes at most one point a second per key, so a faster series has nothing new. */
const SERIES_MIN_INTERVAL_MS = 1000;
/**
 * The render loop hears about targets at most once per 60 FPS frame (V2-14.4). A frame is 16.7 ms, but a throttle
 * of 16 ms can post 63 times a second; 17 ms keeps to 58.8, within the 60 a second the task allows. No
 * `requestAnimationFrame` is assumed in a worker (not in every browser), so a timer stands in for the frame.
 */
const TARGETS_MIN_INTERVAL_MS = 17;
/** The HUD's counts (V2-19.1) are read once a second, so they are posted at most that often. */
const STATS_MIN_INTERVAL_MS = 1000;

/**
 * Socket.IO's own message for a namespace the server does not have. It is not in
 * `EventsConnectErrors` (those are the API's); an older replica during a rollout sends it
 * (ADR-0019 § Rolling deploys).
 */
const INVALID_NAMESPACE = 'Invalid namespace';

/**
 * Runs `run` at most once per `intervalMs`. With `leading` (the default) it runs at once when
 * idle and once more when the cooldown ends, however many requests came in between. Without it,
 * the first request only starts the interval, so a burst of requests (the keys of one frame) goes
 * out together. It reads no clock, so fake timers drive it, and no timer runs while nobody asks.
 */
function createThrottle(intervalMs: number, run: () => void, { leading = true } = {}) {
  let cooling: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  const fire = () => {
    run();
    cooling = setTimeout(cooled, intervalMs);
  };
  const cooled = () => {
    cooling = undefined;
    if (!pending) return;
    pending = false;
    fire();
  };
  return {
    request() {
      if (cooling !== undefined) {
        pending = true;
      } else if (leading) {
        fire();
      } else {
        pending = true;
        cooling = setTimeout(cooled, intervalMs);
      }
    },
    cancel() {
      clearTimeout(cooling);
      cooling = undefined;
      pending = false;
    },
  };
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((item, index) => item === b[index]);

/** Whether two buffers hold the same numbers, a `NaN` equal to a `NaN`: a slot with no value has not changed. */
function sameTargets(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    const x = a[index];
    const y = b[index];
    if (x !== y && !(Number.isNaN(x) && Number.isNaN(y))) return false;
  }
  return true;
}

/** The assets of `next` that are not the same object in `previous`. */
function changedAssets(
  previous: TelemetryState['assets'],
  next: TelemetryState['assets'],
): Record<string, AssetTelemetryState> {
  const changed: Record<string, AssetTelemetryState> = {};
  if (previous === next) return changed;
  for (const [code, asset] of Object.entries(next)) {
    if (previous[code] !== asset) changed[code] = asset;
  }
  return changed;
}

/** Whether the main thread has a reason to hear about `next`: nothing it holds is already it. */
function differs(previous: TelemetryState, next: TelemetryState): boolean {
  return (
    previous.assets !== next.assets ||
    previous.serverClock !== next.serverClock ||
    previous.upstream !== next.upstream ||
    previous.upstreamSince !== next.upstreamSince ||
    previous.socket !== next.socket ||
    previous.socketSince !== next.socketSince
  );
}

/** The real client behind the engine's socket interface. */
export const createIoSocket: SocketFactory = (auth) => {
  const socket: Socket<TelemetryServerToClientEvents, TelemetryClientToServerEvents> = io(
    TELEMETRY_NAMESPACE,
    // WebSocket only, as `/events` (ADR-0019). `auth` is a function so each reconnect asks again.
    { transports: ['websocket'], auth },
  );
  return {
    get active() {
      return socket.active;
    },
    onConnect: (handler) => void socket.on('connect', handler),
    onDisconnect: (handler) => void socket.on('disconnect', () => handler()),
    onReconnectAttempt: (handler) => void socket.io.on('reconnect_attempt', handler),
    onConnectError: (handler) => void socket.on('connect_error', (error) => handler(error.message)),
    onOverview: (handler) => void socket.on(TelemetryEvents.Overview, handler),
    onSnapshot: (handler) => void socket.on(TelemetryEvents.Snapshot, handler),
    onFrames: (handler) => void socket.on(TelemetryEvents.Frames, handler),
    onStatus: (handler) => void socket.on(TelemetryEvents.Status, handler),
    watch: (assets, onAck) =>
      void socket
        .timeout(WATCH_ACK_TIMEOUT_MS)
        .emit(TelemetryEvents.Watch, { assets }, (error, ack) =>
          onAck(error ? null : ack.accepted),
        ),
    connect: () => void socket.connect(),
    disconnect: () => void socket.disconnect(),
  };
};

export function createTelemetryEngine({
  host,
  createSocket = createIoSocket,
}: EngineOptions): TelemetryEngine {
  const v = TELEMETRY_PROTOCOL_VERSION;
  let socket: EngineSocket | undefined;
  let disposed = false;

  let state: TelemetryState = initialTelemetryState;
  let postedState: TelemetryState = initialTelemetryState;

  // Token round trips with the main thread, matched by request id.
  let nextRequestId = 1;
  const tokenWaiters = new Map<
    number,
    { resolve: (token: string | null) => void; timer: ReturnType<typeof setTimeout> }
  >();

  // Refused handshakes.
  let retryDelay = RETRY_FIRST_MS;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** One renewal per refusal run: a token that is refused again must not loop the renewal. */
  let renewedSinceConnect = false;

  // The watch set.
  let desired: string[] = [];
  /** The set last emitted on this connection; `null` before any, and after a reconnect. */
  let sentWatch: string[] | null = null;
  let watchRetried = false;
  let watchRetryTimer: ReturnType<typeof setTimeout> | undefined;

  // Rings, only for watched assets: asset → key → ring. `dirty` is what changed since the last post.
  const rings = new Map<string, Map<string, RingBuffer>>();
  const dirty = new Map<string, Set<string>>();

  // The targets path (V2-14.4): the layout the main thread set, and the engine's own copy of the last buffer
  // posted (a transfer detaches the posted one, and in the main thread the client keeps it).
  let layout: { id: number; slots: readonly TargetSlot[] } | null = null;
  let lastTargets: Float32Array | null = null;

  // Cumulative counts for the HUD: socket messages received, buffers posted.
  let messages = 0;
  let targetPosts = 0;
  let postedStats = { messages: 0, targetPosts: 0 };

  const reduce = (message: TelemetryMessage) => {
    state = applyMessage(state, message, performance.now());
    stateThrottle.request();
    if (layout) targetsThrottle.request();
  };

  const countMessage = () => {
    messages += 1;
    statsThrottle.request();
  };

  const setSocket = (next: SocketState) => reduce({ type: 'socket', state: next, at: Date.now() });

  const stateThrottle = createThrottle(STATE_MIN_INTERVAL_MS, () => {
    if (!differs(postedState, state)) return;
    host.post({
      v,
      type: 'state',
      upstream: state.upstream,
      upstreamSince: state.upstreamSince,
      socket: state.socket,
      socketSince: state.socketSince,
      serverNowMs: serverNow(state.serverClock, performance.now()),
      assets: changedAssets(postedState.assets, state.assets),
    });
    postedState = state;
  });

  const seriesThrottle = createThrottle(
    SERIES_MIN_INTERVAL_MS,
    () => {
      const entries: Extract<FromWorker, { type: 'series' }>['entries'] = [];
      const transfer: Transferable[] = [];
      for (const [assetCode, keys] of dirty) {
        for (const key of keys) {
          const ring = rings.get(assetCode)?.get(key);
          if (!ring) continue;
          const { t, v: values } = ring.toArrays();
          entries.push({ assetCode, key, t, v: values });
          // `toArrays` allocates plain ArrayBuffers; only the declared type is the wider one.
          transfer.push(t.buffer as ArrayBuffer, values.buffer as ArrayBuffer);
        }
      }
      dirty.clear();
      if (entries.length > 0) host.post({ v, type: 'series', entries }, transfer);
      // Not leading: the keys of one frame arrive one after another and belong in one post.
    },
    { leading: false },
  );

  const watchThrottle = createThrottle(WATCH_MIN_INTERVAL_MS, () => flushWatch());

  const statsThrottle = createThrottle(
    STATS_MIN_INTERVAL_MS,
    () => {
      if (messages === postedStats.messages && targetPosts === postedStats.targetPosts) return;
      postedStats = { messages, targetPosts };
      host.post({ v, type: 'stats', ...postedStats });
    },
    // Not leading, like the series: a burst of messages is one count, and nothing posts at connect.
    { leading: false },
  );

  /**
   * One buffer of the layout's current values, posted when it differs from the last one (and so never
   * for a quiet socket, nor for an overview that changed no slot). With no buffer posted yet the last
   * one counts as all `NaN`: a layout whose slots have no value yet posts nothing.
   */
  const targetsThrottle = createThrottle(TARGETS_MIN_INTERVAL_MS, () => {
    if (!layout) return;
    const buffer = buildTargets(layout.slots);
    const previous = lastTargets ?? new Float32Array(buffer.length).fill(Number.NaN);
    if (sameTargets(previous, buffer)) return;
    // Copied before the post: a transfer detaches `buffer` in a worker.
    lastTargets = buffer.slice();
    // `buffer.buffer` is a plain ArrayBuffer here; only the declared type is the wider one.
    host.post({ v, type: 'targets', layoutId: layout.id, buffer }, [buffer.buffer as ArrayBuffer]);
    targetPosts += 1;
    statsThrottle.request();
  });

  /** Slot *i* is the latest value of its key, as a number: `NaN` while the asset or key has none, or it does not encode. */
  function buildTargets(slots: readonly TargetSlot[]): Float32Array {
    const buffer = new Float32Array(slots.length);
    slots.forEach(({ assetCode, key, enumValues }, index) => {
      const value = state.assets[assetCode]?.values[key];
      buffer[index] = (value === undefined ? null : encodeReading(value, enumValues)) ?? Number.NaN;
    });
    return buffer;
  }

  function setLayout(id: number, slots: readonly TargetSlot[]) {
    // Plain copies: nothing of the message is kept, and nothing but the three fields is read.
    layout = {
      id,
      slots: slots.map(({ assetCode, key, enumValues }) => ({ assetCode, key, enumValues })),
    };
    // What was posted belongs to the old layout. The next build is a change whenever a slot has a value.
    lastTargets = null;
    targetsThrottle.request();
  }

  function ringFor(assetCode: string, key: string): RingBuffer | undefined {
    if (!desired.includes(assetCode)) return undefined;
    let byKey = rings.get(assetCode);
    if (!byKey) rings.set(assetCode, (byKey = new Map()));
    let ring = byKey.get(key);
    if (!ring) byKey.set(key, (ring = createRingBuffer()));
    return ring;
  }

  function markDirty(assetCode: string, key: string) {
    let keys = dirty.get(assetCode);
    if (!keys) dirty.set(assetCode, (keys = new Set()));
    keys.add(key);
    seriesThrottle.request();
  }

  /**
   * One point in a ring. Time is the API's receive time, never the device's `at`: the history
   * route buckets by receive time, so seeded and live points only share an axis that way. A value
   * that has no number (an enum string) gets no ring.
   */
  function pushReading(assetCode: string, key: string, value: TelemetryValue, receivedAt: string) {
    const t = Date.parse(receivedAt);
    const n = encodeReading(value, null);
    if (n === null || !Number.isFinite(t)) return;
    if (ringFor(assetCode, key)?.push(t, n)) markDirty(assetCode, key);
  }

  function requestToken(renew: boolean): Promise<string | null> {
    return new Promise((resolve) => {
      const requestId = nextRequestId++;
      const timer = setTimeout(
        () => {
          tokenWaiters.delete(requestId);
          resolve(null);
        },
        renew ? RENEW_TIMEOUT_MS : TOKEN_TIMEOUT_MS,
      );
      tokenWaiters.set(requestId, { resolve, timer });
      host.post({ v, type: 'tokenRequest', requestId, renew });
    });
  }

  function scheduleReconnect() {
    clearTimeout(retryTimer);
    const delay = retryDelay * (0.5 + Math.random());
    retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
    retryTimer = setTimeout(() => socket?.connect(), delay);
  }

  function flushWatch() {
    if (!socket || state.socket !== 'live') return;
    const wanted = sentWatch === null ? desired.length === 0 : sameList(sentWatch, desired);
    if (wanted) return;
    const requested = desired;
    sentWatch = requested;
    socket.watch(requested, (accepted) => {
      // Superseded by a newer set, or the connection it was sent on is gone.
      if (disposed || sentWatch !== requested) return;
      // No answer: an older replica that ignores the message. Nothing more to do until the next
      // connect, which sends the set again.
      if (accepted === null) return;
      // Accepted nothing for a set that was not empty: the rate limit, or codes the catalogue does
      // not know yet. One more try, then wait for a new set or a reconnect.
      if (accepted.length === 0 && requested.length > 0 && !watchRetried) {
        watchRetried = true;
        watchRetryTimer = setTimeout(() => {
          sentWatch = null;
          watchThrottle.request();
        }, WATCH_RETRY_MS);
      }
    });
  }

  function setDesired(assets: readonly string[]) {
    const next = [...new Set(assets)].slice(0, TELEMETRY_WATCH_LIMIT);
    for (const code of desired) {
      if (!next.includes(code)) {
        rings.delete(code);
        dirty.delete(code);
      }
    }
    desired = next;
    watchRetried = false;
    clearTimeout(watchRetryTimer);
    watchThrottle.request();
  }

  function seed(assetCode: string, series: SeriesData[]) {
    for (const { key, t, v: values } of series) {
      const ring = ringFor(assetCode, key);
      if (!ring) return; // not watched (any more): there is no ring to fill
      ring.seed(Array.from(t, (time, index) => ({ t: time, v: values[index] ?? Number.NaN })));
      markDirty(assetCode, key);
    }
  }

  function onRefused(message: string) {
    if (message === INVALID_NAMESPACE) {
      // A replica from before `/telemetry`: no telemetry from it, and not an error. The next
      // connect may meet a newer one.
      setSocket('unavailable');
      scheduleReconnect();
      return;
    }
    setSocket('reconnecting');
    if (message === EventsConnectErrors.Unauthorized && !renewedSinceConnect) {
      renewedSinceConnect = true;
      void requestToken(true).then((token) => {
        // `null`: no session left to renew. The console's session banner owns that, and a retry
        // loop would only hammer the identity provider; `retry` starts again.
        if (disposed || token === null) return;
        scheduleReconnect();
      });
      return;
    }
    scheduleReconnect();
  }

  function start() {
    if (socket) return;
    socket = createSocket((send) => {
      // Only a token the main thread just gave for this very handshake is ever sent.
      void requestToken(false).then((token) => {
        if (!disposed) send({ token: token ?? '' });
      });
    });
    const live = socket;
    const guarded =
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        if (!disposed) fn(...args);
      };

    live.onConnect(
      guarded(() => {
        retryDelay = RETRY_FIRST_MS;
        renewedSinceConnect = false;
        clearTimeout(retryTimer);
        // Server state is per connection: the set is sent again, whatever was sent before.
        sentWatch = null;
        watchRetried = false;
        setSocket('live');
        watchThrottle.request();
      }),
    );
    live.onDisconnect(guarded(() => setSocket('reconnecting')));
    live.onReconnectAttempt(guarded(() => setSocket('reconnecting')));
    live.onConnectError(
      guarded((message: string) => {
        // Still active: the transport failed and Socket.IO is already retrying.
        if (live.active) setSocket('reconnecting');
        else onRefused(message);
      }),
    );

    live.onOverview(
      guarded((payload: TelemetryOverview) => {
        countMessage();
        reduce({ type: 'overview', payload });
      }),
    );
    live.onStatus(
      guarded((payload: TelemetryStatus) => {
        countMessage();
        reduce({ type: 'status', payload });
      }),
    );
    live.onSnapshot(
      guarded((payload: TelemetrySnapshot) => {
        countMessage();
        reduce({ type: 'snapshot', payload });
        for (const [assetCode, asset] of Object.entries(payload.assets)) {
          for (const [key, value] of Object.entries(asset.values)) {
            pushReading(assetCode, key, value, asset.receivedAt);
          }
        }
      }),
    );
    live.onFrames(
      guarded((payload: TelemetryFrames) => {
        countMessage();
        reduce({ type: 'frames', payload });
        for (const frame of payload.frames) {
          for (const [key, value] of Object.entries(frame.values)) {
            pushReading(frame.assetCode, key, value, frame.receivedAt);
          }
        }
      }),
    );
  }

  function retryNow() {
    if (!socket) return;
    clearTimeout(retryTimer);
    retryDelay = RETRY_FIRST_MS;
    renewedSinceConnect = false;
    sentWatch = null;
    setSocket('reconnecting');
    socket.disconnect();
    socket.connect();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(retryTimer);
    clearTimeout(watchRetryTimer);
    stateThrottle.cancel();
    seriesThrottle.cancel();
    watchThrottle.cancel();
    targetsThrottle.cancel();
    statsThrottle.cancel();
    layout = null;
    lastTargets = null;
    for (const waiter of tokenWaiters.values()) clearTimeout(waiter.timer);
    tokenWaiters.clear();
    rings.clear();
    dirty.clear();
    socket?.disconnect();
  }

  return {
    receive(message) {
      if (disposed) return;
      switch (message.type) {
        case 'connect':
          start();
          return;
        case 'token': {
          const waiter = tokenWaiters.get(message.requestId);
          if (!waiter) return;
          clearTimeout(waiter.timer);
          tokenWaiters.delete(message.requestId);
          waiter.resolve(message.token);
          return;
        }
        case 'watch':
          setDesired(message.assets);
          return;
        case 'seed':
          seed(message.assetCode, message.series);
          return;
        case 'layout':
          setLayout(message.layoutId, message.slots);
          return;
        case 'retry':
          retryNow();
          return;
        case 'dispose':
          dispose();
          return;
      }
    },
  };
}
