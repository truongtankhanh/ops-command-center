import type { TelemetryValue } from '@occ/contracts';

/**
 * 15 minutes of a point that reports once a second, which is the fastest the buffer keeps (one
 * point per second). A slower point holds longer in the same 900 points; a consumer that wants a
 * time window clips by `t` (brief § Worker, V2-08.1).
 */
export const RING_CAPACITY = 900;

/** One reading of one key: `t` is epoch ms on the API's clock, `v` the encoded value. */
export interface RingSample {
  t: number;
  v: number;
}

/**
 * A fixed-capacity time series for one watched key, newest points kept. Time is the API's receive
 * time (`TelemetryFrame.receivedAt`, the history route's bucket), never the device's `at`: the
 * history route buckets by receive time, so live and seeded points only share an axis that way.
 */
export interface RingBuffer {
  /** How many points it holds, at most its capacity. */
  readonly size: number;
  /**
   * Adds a point. One point per second: in the same second as the newest it replaces it (latest
   * wins), in a later one it is appended and the oldest goes when full. A point in an earlier
   * second, or a non-finite one, is ignored and the result is `false`: the series never reorders.
   */
  push(t: number, v: number): boolean;
  /**
   * Merges older history (the 5 s buckets of `GET /assets/:code/telemetry`, already encoded). A
   * second the buffer already holds keeps its live point, so a reload racing the first frames
   * cannot roll a value back. The newest `capacity` points of the merge are kept.
   */
  seed(samples: readonly RingSample[]): void;
  /**
   * The series in time order as fresh copies. They are copies on purpose: the worker transfers
   * them to the main thread, which detaches the buffer, and that must not touch the ring.
   */
  toArrays(): { t: Float64Array; v: Float32Array };
  clear(): void;
}

const slotOf = (t: number): number => Math.floor(t / 1000);

/** Typed arrays are only read inside their bounds here; `noUncheckedIndexedAccess` cannot know. */
const read = (array: Float64Array | Float32Array, index: number): number => array[index] ?? 0;

/**
 * Times are `Float64Array`: epoch ms is about 1.7e12, beyond what `Float32Array` keeps to the
 * millisecond. Values are `Float32Array`, ample for a reading and half the size to transfer.
 */
export function createRingBuffer(capacity: number = RING_CAPACITY): RingBuffer {
  const times = new Float64Array(capacity);
  const values = new Float32Array(capacity);
  /** Index of the oldest point. */
  let head = 0;
  let length = 0;

  const indexAt = (offset: number): number => (head + offset) % capacity;

  return {
    get size() {
      return length;
    },

    push(t, v) {
      if (!Number.isFinite(t) || !Number.isFinite(v)) return false;
      if (length > 0) {
        const newest = indexAt(length - 1);
        const newestSlot = slotOf(read(times, newest));
        if (slotOf(t) < newestSlot) return false;
        if (slotOf(t) === newestSlot) {
          times[newest] = t;
          values[newest] = v;
          return true;
        }
      }
      let target: number;
      if (length < capacity) {
        target = indexAt(length);
        length += 1;
      } else {
        // Full: the new point takes the oldest one's place and the oldest becomes the next one.
        target = head;
        head = (head + 1) % capacity;
      }
      times[target] = t;
      values[target] = v;
      return true;
    },

    seed(samples) {
      const bySlot = new Map<number, RingSample>();
      for (const sample of samples) {
        if (Number.isFinite(sample.t) && Number.isFinite(sample.v)) {
          bySlot.set(slotOf(sample.t), sample);
        }
      }
      // Live points go in last, so they win a slot the seed also has.
      for (let offset = 0; offset < length; offset++) {
        const index = indexAt(offset);
        const t = read(times, index);
        bySlot.set(slotOf(t), { t, v: read(values, index) });
      }
      const merged = [...bySlot.values()].sort((a, b) => a.t - b.t).slice(-capacity);
      head = 0;
      length = merged.length;
      merged.forEach((sample, index) => {
        times[index] = sample.t;
        values[index] = sample.v;
      });
    },

    toArrays() {
      const t = new Float64Array(length);
      const v = new Float32Array(length);
      for (let offset = 0; offset < length; offset++) {
        const index = indexAt(offset);
        t[offset] = read(times, index);
        v[offset] = read(values, index);
      }
      return { t, v };
    },

    clear() {
      head = 0;
      length = 0;
    },
  };
}

/**
 * A reading as the number a ring stores: a number as is, a boolean as 0 / 1, an `enum` value as its
 * index in `enumValues`. `null` for what has no number (a non-finite value, a string that is not
 * one of `enumValues`, or no `enumValues`), which the caller does not push.
 *
 * `enumValues` is catalogue data (`TelemetryPoint.enumValues`) that the ring and the telemetry
 * state never read: the caller supplies it. Turning the index back into a word is the formatter's.
 */
export function encodeReading(
  value: TelemetryValue,
  enumValues: readonly string[] | null,
): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const index = enumValues?.indexOf(value) ?? -1;
  return index >= 0 ? index : null;
}
