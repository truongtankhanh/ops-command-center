import type { TelemetryPoint } from '@occ/contracts';
import { SPARKLINE_WINDOW_MS } from './assetInspector';

/*
 * How far a reading moved over the inspector's window (V3-09.2; frames 02 and 04's live tiles: an
 * arrow and a signed number, "—" when there is nothing to compare). Pure: it reads the ring
 * buffer's series it is given, no store and no clock.
 */

/**
 * The shortest span a change is read over: a reference closer to `now` than this is the reading
 * itself, not a history. The task's proposal, `unverified` until the tiles are seen on real data.
 */
export const MIN_DELTA_SPAN_MS = 60_000;

/**
 * Below this a change is `flat`. `formatReading` writes at most one fraction digit, so a change
 * under 0.05 would draw "+0.0" beside an arrow; it also absorbs the float32 of a ring value
 * against the float64 of the live reading, which rarely subtract to exactly 0. Follow `figure` in
 * `readings.ts` if a point is ever drawn with more precision.
 */
export const FLAT_BELOW = 0.05;

export interface ReadingDelta {
  direction: 'up' | 'down' | 'flat';
  /** Signed, in the point's unit: `latest` minus the reference. Exactly 0 for `flat`. */
  amount: number;
}

/**
 * The change of a reading over the last `windowMs`: `latest` against the **oldest** point of
 * `series` that is still inside the window, as the brief says ("change over the last 15 minutes").
 * `null` ("—") when there is nothing to compare, and it never invents a change:
 *
 * - the point is not a `number`: the ring stores a boolean as 0 / 1 and an enum as its index
 *   (`encodeReading`), so a switch that flipped would read as "up 1";
 * - there is no series, no `latest` or no clock yet (`now` is the server's, `null` until the first
 *   overview);
 * - fewer than two points fall inside the window (a slow point, such as an hourly battery, has
 *   almost never two in 15 minutes), or the reference is less than `MIN_DELTA_SPAN_MS` old.
 *
 * Whether the asset is stale is the caller's call: a stale tile passes no delta. The series is only
 * read, never changed.
 */
export function readingDelta(
  point: Pick<TelemetryPoint, 'kind'>,
  series: { t: Float64Array; v: Float32Array } | undefined,
  latest: number | null,
  now: number | null,
  windowMs: number = SPARKLINE_WINDOW_MS,
): ReadingDelta | null {
  if (point.kind !== 'number' || series === undefined) return null;
  if (latest === null || !Number.isFinite(latest) || now === null || !Number.isFinite(now)) {
    return null;
  }

  // The series is in time order and holds at most one ring (900 points), so a scan from the front
  // finds the oldest point inside the window.
  const from = now - windowMs;
  let first = 0;
  while (first < series.t.length && (series.t[first] ?? Number.NEGATIVE_INFINITY) < from) {
    first += 1;
  }
  if (series.t.length - first < 2) return null;

  const referenceTime = series.t[first];
  const referenceValue = series.v[first];
  if (referenceTime === undefined || referenceValue === undefined) return null;
  if (now - referenceTime < MIN_DELTA_SPAN_MS) return null;

  const amount = latest - referenceValue;
  if (Math.abs(amount) < FLAT_BELOW) return { direction: 'flat', amount: 0 };
  return { direction: amount > 0 ? 'up' : 'down', amount };
}
