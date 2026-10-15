import type { TelemetryStatus } from '@occ/contracts';
import type { AssetTelemetryState, SocketState } from '../lib/telemetryState';

/**
 * The messages between the main thread and the telemetry worker (ADR-0019, ADR-0020 § State).
 * Both ends ship in one build, so the version is a guard against a stale cached script, not a
 * negotiation: a message of another version is ignored rather than misread.
 *
 * Every message is plain data a structured clone carries, so the same messages also cross the
 * in-thread fallback unchanged.
 */
export const TELEMETRY_PROTOCOL_VERSION = 1;

type Versioned = { v: typeof TELEMETRY_PROTOCOL_VERSION };

/** One key's points as parallel typed arrays, time in epoch ms on the API's clock. */
export interface SeriesData {
  key: string;
  t: Float64Array;
  v: Float32Array;
}

/** Main thread → worker. */
export type ToWorker =
  | (Versioned & { type: 'connect' })
  /** The answer to a `tokenRequest`; `null` when there is no session or it could not be renewed. */
  | (Versioned & { type: 'token'; requestId: number; token: string | null })
  | (Versioned & {
      type: 'watch';
      assets: string[];
      /**
       * Reserved: `enumValues` by asset and point key, so the worker could buffer enum points.
       * Unused today (enum points have no ring, V2-08.4), and absent from every message sent.
       */
      enums?: Record<string, Record<string, string[]>>;
    })
  /** History for a watched asset, merged under the live points. Numeric and boolean keys only. */
  | (Versioned & { type: 'seed'; assetCode: string; series: SeriesData[] })
  | (Versioned & { type: 'retry' })
  | (Versioned & { type: 'dispose' });

/** Worker → main thread. */
export type FromWorker =
  /** The handshake (or, with `renew`, a refused one) needs a token from the main thread. */
  | (Versioned & { type: 'tokenRequest'; requestId: number; renew: boolean })
  | (Versioned & {
      type: 'state';
      upstream: TelemetryStatus['upstream'] | null;
      upstreamSince: string | null;
      socket: SocketState;
      socketSince: number | null;
      /**
       * The server's time when this was posted (`serverNow` of the worker's clock), or `null`
       * before the first overview. Not a `ServerClock`: the worker's monotonic clock has its own
       * origin, so the main thread re-anchors this with its own reading.
       */
      serverNowMs: number | null;
      /** Only the assets that changed since the last `state`; the rest are unchanged. */
      assets: Record<string, AssetTelemetryState>;
    })
  /** Full series of the keys that got a new point. The buffers are transferred, not copied. */
  | (Versioned & {
      type: 'series';
      entries: { assetCode: string; key: string; t: Float64Array; v: Float32Array }[];
    })
  /** Reserved for V2-14's per-frame target buffer. Nothing produces or reads it yet. */
  | (Versioned & { type: 'targets'; buffer: Float32Array });

const TO_WORKER_TYPES: readonly unknown[] = [
  'connect',
  'token',
  'watch',
  'seed',
  'retry',
  'dispose',
];
const FROM_WORKER_TYPES: readonly unknown[] = ['tokenRequest', 'state', 'series', 'targets'];

/** Envelope only: the right version and a known type. The shape behind it is the build's own. */
function hasEnvelope(data: unknown, types: readonly unknown[]): boolean {
  if (typeof data !== 'object' || data === null) return false;
  const { v, type } = data as { v?: unknown; type?: unknown };
  return v === TELEMETRY_PROTOCOL_VERSION && types.includes(type);
}

export const isToWorker = (data: unknown): data is ToWorker => hasEnvelope(data, TO_WORKER_TYPES);

export const isFromWorker = (data: unknown): data is FromWorker =>
  hasEnvelope(data, FROM_WORKER_TYPES);
