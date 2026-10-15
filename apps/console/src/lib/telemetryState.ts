import type {
  TelemetryAssetOverview,
  TelemetryAssetSnapshot,
  TelemetryFrame,
  TelemetryFrames,
  TelemetryOverview,
  TelemetrySnapshot,
  TelemetryStatus,
  TelemetryValue,
} from '@occ/contracts';
import type { ServerClock } from './telemetryFreshness';

/**
 * What the console knows from `/telemetry`, and how each server message changes it (ADR-0019,
 * ADR-0020 § State). Pure: no socket, no timer, no clock. The worker (V2-08.4) feeds it messages
 * and the store (V2-08.5) exposes it, so Vitest can test the rules without either.
 */

/** The console's own `/telemetry` socket, as opposed to the API's upstream source. */
export type SocketState = 'connecting' | 'live' | 'reconnecting' | 'unavailable';

/** What one asset holds. An asset the API has sent nothing about is absent from the state. */
export interface AssetTelemetryState {
  /** `false` once the device's last will fired; its next reading makes it `true` again. */
  online: boolean;
  /** ISO time the API received the asset's latest reading: the only freshness of an unwatched asset. */
  receivedAt: string;
  /** The headline values of the last overview. `values` is the freshest copy of them. */
  headline: Readonly<Record<string, TelemetryValue>>;
  /** The latest value of every key received: the snapshot, then frames and overviews laid over it. */
  values: Readonly<Record<string, TelemetryValue>>;
  /**
   * ISO time of the message that last brought each key a new value. A frame carries changed keys
   * only, so for a steady key this is when it last changed, not when the device last reported:
   * it is for display and must never decide freshness, which is `receivedAt`'s job (V2-08.3).
   */
  keyReceivedAt: Readonly<Record<string, string>>;
}

export interface TelemetryState {
  /** This replica's connection to its source. `null` until the first `telemetry.status`. */
  upstream: TelemetryStatus['upstream'] | null;
  upstreamSince: string | null;
  socket: SocketState;
  /**
   * Epoch ms, on the console's own clock, since which the socket has not been `live`; `null` while
   * it is. Only for the "connection lost since" label: no freshness decision reads it.
   */
  socketSince: number | null;
  /** The API's clock as last anchored by an overview or snapshot: see `serverNow`. */
  serverClock: ServerClock | null;
  assets: Readonly<Record<string, AssetTelemetryState>>;
}

export type TelemetryMessage =
  | { type: 'overview'; payload: TelemetryOverview }
  | { type: 'snapshot'; payload: TelemetrySnapshot }
  | { type: 'frames'; payload: TelemetryFrames }
  | { type: 'status'; payload: TelemetryStatus }
  /** `at` is the console's wall-clock time (epoch ms), supplied by the caller for the label only. */
  | { type: 'socket'; state: SocketState; at: number };

export const initialTelemetryState: TelemetryState = {
  upstream: null,
  upstreamSince: null,
  socket: 'connecting',
  socketSince: null,
  serverClock: null,
  assets: {},
};

/** The pill's five states (V2-08.1). */
export type TelemetryPillState = 'connecting' | 'live' | 'paused' | 'reconnecting' | 'unavailable';

/**
 * The pill's state from the two things that can be wrong: the console's own socket first, since
 * nothing the upstream says matters while it is down, then the API's source. A live socket that has
 * not heard `telemetry.status` yet is still connecting: the server sends `paused` until its source
 * is up, so showing "live" now would be a guess (docs/api/telemetry.md § Status).
 */
export function telemetryPillState(state: TelemetryState): TelemetryPillState {
  if (state.socket !== 'live') return state.socket;
  if (state.upstream === 'paused') return 'paused';
  return state.upstream === 'live' ? 'live' : 'connecting';
}

const NO_VALUES: Readonly<Record<string, TelemetryValue>> = {};
const NO_STAMPS: Readonly<Record<string, string>> = {};

const isInstant = (iso: string): boolean => Number.isFinite(Date.parse(iso));

/** The later of the asset's held `receivedAt` and `incoming` (valid), as its original string. */
function newest(current: AssetTelemetryState | undefined, incoming: string): string {
  if (current === undefined) return incoming;
  return Date.parse(incoming) > Date.parse(current.receivedAt) ? incoming : current.receivedAt;
}

function sameRecord<T>(a: Readonly<Record<string, T>>, b: Readonly<Record<string, T>>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/** `incoming` laid over `current`; `current` itself when it changes nothing. */
function overlay<T>(
  current: Readonly<Record<string, T>>,
  incoming: Readonly<Record<string, T>>,
): Readonly<Record<string, T>> {
  const same = Object.keys(incoming).every((key) => current[key] === incoming[key]);
  return same ? current : { ...current, ...incoming };
}

/** `current` with `keys` set to `at`; `current` itself when they already are. */
function stamp(
  current: Readonly<Record<string, string>>,
  keys: readonly string[],
  at: string,
): Readonly<Record<string, string>> {
  if (keys.every((key) => current[key] === at)) return current;
  return { ...current, ...Object.fromEntries(keys.map((key) => [key, at])) };
}

/**
 * `next`, unless it says what `current` already says, in which case `current` itself: an asset
 * that did not change keeps its identity, so a component reading it does not re-render (V2-08.5).
 */
function settle(
  current: AssetTelemetryState | undefined,
  next: AssetTelemetryState,
): AssetTelemetryState {
  if (
    current !== undefined &&
    current.online === next.online &&
    current.receivedAt === next.receivedAt &&
    current.values === next.values &&
    current.keyReceivedAt === next.keyReceivedAt &&
    sameRecord(current.headline, next.headline)
  ) {
    return current;
  }
  return next;
}

/**
 * The overview carries headline values only and keeps coming while the upstream is paused. Its
 * headline is laid over `values` too: the contract says the overview corrects a frame the socket
 * skipped, which only works if it reaches the value a reader sees.
 */
function fromOverview(
  current: AssetTelemetryState | undefined,
  entry: TelemetryAssetOverview,
): AssetTelemetryState | undefined {
  if (!isInstant(entry.receivedAt)) return current;
  const held = current?.values ?? NO_VALUES;
  const changed = Object.keys(entry.headline).filter((key) => held[key] !== entry.headline[key]);
  return settle(current, {
    online: entry.online,
    receivedAt: newest(current, entry.receivedAt),
    headline: entry.headline,
    values: overlay(held, entry.headline),
    keyReceivedAt: stamp(current?.keyReceivedAt ?? NO_STAMPS, changed, entry.receivedAt),
  });
}

/**
 * A snapshot replaces the asset's `values` (it lists every key received so far). A key whose value
 * is unchanged keeps its stamp: the snapshot a watch returns repeats what the console holds, and
 * that is not a change.
 */
function fromSnapshot(
  current: AssetTelemetryState | undefined,
  entry: TelemetryAssetSnapshot,
): AssetTelemetryState | undefined {
  if (!isInstant(entry.receivedAt)) return current;
  const held = current?.values ?? NO_VALUES;
  const heldStamps = current?.keyReceivedAt ?? NO_STAMPS;
  const stamps = Object.fromEntries(
    Object.keys(entry.values).map((key) => [
      key,
      held[key] === entry.values[key] ? (heldStamps[key] ?? entry.receivedAt) : entry.receivedAt,
    ]),
  );
  return settle(current, {
    online: entry.online,
    receivedAt: newest(current, entry.receivedAt),
    headline: current?.headline ?? NO_VALUES,
    values: sameRecord(held, entry.values) ? held : entry.values,
    keyReceivedAt: sameRecord(heldStamps, stamps) ? heldStamps : stamps,
  });
}

/**
 * A frame carries the changed keys only: the rest are left alone, and a key it lists is stamped
 * with its `receivedAt`. A reading arrived, so the device is online. `frame.at` is the device's
 * clock, which may be minutes off, and is never used.
 */
function fromFrame(
  current: AssetTelemetryState | undefined,
  frame: TelemetryFrame,
): AssetTelemetryState | undefined {
  if (!isInstant(frame.receivedAt)) return current;
  return settle(current, {
    online: true,
    receivedAt: newest(current, frame.receivedAt),
    headline: current?.headline ?? NO_VALUES,
    values: overlay(current?.values ?? NO_VALUES, frame.values),
    keyReceivedAt: stamp(
      current?.keyReceivedAt ?? NO_STAMPS,
      Object.keys(frame.values),
      frame.receivedAt,
    ),
  });
}

/**
 * Applies `update` to each incoming entry. Assets the message does not list are untouched, and
 * the same `assets` object comes back when nothing changed.
 */
function withAssets<E>(
  assets: TelemetryState['assets'],
  incoming: Iterable<[string, E]>,
  update: (current: AssetTelemetryState | undefined, entry: E) => AssetTelemetryState | undefined,
): TelemetryState['assets'] {
  let changed: Record<string, AssetTelemetryState> | null = null;
  for (const [code, entry] of incoming) {
    const current = changed?.[code] ?? assets[code];
    const updated = update(current, entry);
    if (updated === undefined || updated === current) continue;
    changed ??= {};
    changed[code] = updated;
  }
  return changed === null ? assets : { ...assets, ...changed };
}

/**
 * Applies one message. Pure: it returns a new state, shares every part that did not change, and
 * never mutates `state` or `message`.
 *
 * `mono` is the monotonic time, in ms, at which the message arrived (`performance.now()` in the
 * shell). It anchors the server clock, since this module may not read one.
 */
export function applyMessage(
  state: TelemetryState,
  message: TelemetryMessage,
  mono: number,
): TelemetryState {
  switch (message.type) {
    case 'overview': {
      const at = Date.parse(message.payload.at);
      return {
        ...state,
        serverClock: Number.isFinite(at) ? { at, mono } : state.serverClock,
        assets: withAssets(state.assets, Object.entries(message.payload.assets), fromOverview),
      };
    }
    case 'snapshot': {
      // Stamped by the API like the overview, and it arrives up to a second before the first one.
      const at = Date.parse(message.payload.at);
      return {
        ...state,
        serverClock: Number.isFinite(at) ? { at, mono } : state.serverClock,
        assets: withAssets(state.assets, Object.entries(message.payload.assets), fromSnapshot),
      };
    }
    case 'frames':
      return {
        ...state,
        assets: withAssets(
          state.assets,
          message.payload.frames.map((frame): [string, TelemetryFrame] => [frame.assetCode, frame]),
          fromFrame,
        ),
      };
    case 'status':
      if (
        state.upstream === message.payload.upstream &&
        state.upstreamSince === message.payload.since
      ) {
        return state;
      }
      return {
        ...state,
        upstream: message.payload.upstream,
        upstreamSince: message.payload.since,
      };
    case 'socket':
      return {
        ...state,
        socket: message.state,
        // Kept across reconnect attempts: the label says since when it has been down.
        socketSince: message.state === 'live' ? null : (state.socketSince ?? message.at),
      };
  }
}
