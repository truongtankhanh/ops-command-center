/*
 * The geometry of a sparkline (frames 03, 05, 10, 15; V2-09.7). Pure: it turns a series on the
 * API's clock into points in the 96 × 28 viewBox, and knows nothing about readings, rules or
 * severity, so `ui/Sparkline` can move to a shared package later (OCC-20).
 */

export const SPARK_WIDTH = 96;
export const SPARK_HEIGHT = 28;

// The plot sits inside the height with room for the "now" dot (r 2.5) and half of the 1.5 px stroke.
const PLOT_TOP = 3;
const PLOT_BOTTOM = 25;
/** Share of the domain's span added above and below, so the line never touches the edge. */
const DOMAIN_PADDING = 0.1;
/** The point's range joins the domain only when it is at most this many times the data's span. */
const RANGE_TIGHT_FACTOR = 2;
/** Half-span of a domain with nothing to spread: a flat series, or a limit and no readings. */
const FLAT_HALF_SPAN = 1;

export interface SparklineInput {
  /** Epoch ms on the API's clock, ascending (a ring buffer's `t`; it never reorders). */
  times: ArrayLike<number>;
  /** One number per time, already encoded: a boolean as 0 / 1, an enum as its index. */
  values: ArrayLike<number>;
  /** The window's start and end, epoch ms on the server clock; `to` is "now" (V2-08.1). */
  from: number;
  to: number;
  /** The rule's limit, drawn as a dashed line and part of the domain. */
  limit?: number | null;
  /** The point's valid range; both bounds are needed, a half-open range is ignored. */
  range?: { min: number | null; max: number | null } | null;
  /** Hold the value until the next reading, then a vertical edge: booleans and enums. */
  step?: boolean;
}

export interface SparklineGeometry {
  /** In viewBox units, step edges already expanded; `[]` when no reading falls in the window. */
  points: ReadonlyArray<readonly [number, number]>;
  /** The newest drawn reading, where the "now" dot sits. */
  dot: { x: number; y: number } | null;
  /** The limit's y; `null` when there is no finite limit. */
  limitY: number | null;
}

const NOTHING: SparklineGeometry = { points: [], dot: null, limitY: null };

/**
 * Scales a series into the viewBox.
 *
 * - **No gap is drawn through, and none is invented.** The line joins the readings inside the
 *   window and stops at the last one, so a series that ended 40 s before `to` ends before the
 *   right edge. Extending a live value to `to` is the caller's job: the API sends a key only when
 *   its value changes, so a steady key's last reading can be minutes old on a healthy device.
 * - **Domain** is the readings and the limit, padded. The point's range widens it only when it is
 *   close to the data (a 0–100 000 range must not flatten a 71 °C reading), or always for a `step`
 *   series, whose range is its codomain (0 / 1 for a boolean).
 * - Total: never throws, never returns `NaN`. Non-finite readings and readings outside the window
 *   are skipped.
 */
export function sparklineGeometry(input: SparklineInput): SparklineGeometry {
  const { times, values, from, to, step = false, range } = input;
  const limit =
    input.limit !== undefined && input.limit !== null && Number.isFinite(input.limit)
      ? input.limit
      : null;

  const windowMs = to - from;
  const kept: { t: number; v: number }[] = [];
  if (Number.isFinite(windowMs) && windowMs > 0) {
    const count = Math.min(times.length, values.length);
    for (let index = 0; index < count; index++) {
      const t = times[index] ?? Number.NaN;
      const v = values[index] ?? Number.NaN;
      if (Number.isFinite(t) && Number.isFinite(v) && t >= from && t <= to) kept.push({ t, v });
    }
  }

  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const { v } of kept) {
    low = Math.min(low, v);
    high = Math.max(high, v);
  }
  if (limit !== null) {
    low = Math.min(low, limit);
    high = Math.max(high, limit);
  }
  if (low > high) return NOTHING;

  if (range && range.min !== null && range.max !== null) {
    const rangeSpan = range.max - range.min;
    if (
      Number.isFinite(rangeSpan) &&
      rangeSpan > 0 &&
      (step || rangeSpan <= RANGE_TIGHT_FACTOR * (high - low))
    ) {
      low = Math.min(low, range.min);
      high = Math.max(high, range.max);
    }
  }

  if (high === low) {
    low -= FLAT_HALF_SPAN;
    high += FLAT_HALF_SPAN;
  } else {
    const pad = (high - low) * DOMAIN_PADDING;
    low -= pad;
    high += pad;
  }

  const yOf = (v: number): number =>
    PLOT_BOTTOM - ((v - low) / (high - low)) * (PLOT_BOTTOM - PLOT_TOP);
  const xOf = (t: number): number => ((t - from) / windowMs) * SPARK_WIDTH;

  const points: [number, number][] = [];
  let previousY: number | null = null;
  for (const { t, v } of kept) {
    const x = xOf(t);
    const y = yOf(v);
    // A step holds the old value up to the new reading's time, then jumps: never a slope.
    if (step && previousY !== null) points.push([x, previousY]);
    points.push([x, y]);
    previousY = y;
  }

  const last = kept[kept.length - 1];
  return {
    points,
    dot: last ? { x: xOf(last.t), y: yOf(last.v) } : null,
    limitY: limit === null ? null : yOf(limit),
  };
}
