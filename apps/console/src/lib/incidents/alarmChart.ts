import { formatClockTime } from '../shared/time';
import { ALARM_HISTORY_MS, ALARM_RATE_WINDOW_MS, RAISED_BUCKETS } from './alarmLoad';

/*
 * The Alarm load panel's chart (V3-21.3, frame 16): raised per 10 minutes over 3 hours, drawn from `raisedPerBucket`. Pure
 * like the model beside it: no React, no `Date.now()`, the clock is `now`. The same split as `lib/telemetry/sparkline.ts` and
 * `ui/Sparkline.tsx`: the maths here, the SVG in the component.
 */

/** The chart's own units: `viewBox` width and height. The component scales them with CSS. */
export const CHART_WIDTH = 288;
export const CHART_HEIGHT = 56;

const BAR_GAP = 2;
// A bucket with something in it is never drawn thinner than this, so one incident beside a peak of 14 is still seen.
const MIN_BAR_HEIGHT = 2;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** SVG attributes need no more than a hundredth of a unit. */
const round = (n: number): number => Math.round(n * 100) / 100;

export interface Bar {
  x: number;
  y: number;
  width: number;
  /** 0 for an empty bucket: nothing is drawn for it. */
  height: number;
}

/** The busiest bucket: its count, and the clock time its 10 minutes began. */
export interface Peak {
  count: number;
  startedAt: number;
}

/**
 * The busiest bucket, or `null` when every bucket is empty (there is no peak to say, and the panel draws its empty text). On a
 * tie the most recent bucket wins, since that is the one an operator is most likely still living with. A bucket's time is the
 * start of its 10 minutes: bucket `i` ends `(RAISED_BUCKETS − 1 − i)` windows before `now` (see `raisedPerBucket`).
 */
export function peakBucket(buckets: readonly number[], now: number): Peak | null {
  let best = -1;
  let count = 0;
  buckets.forEach((value, index) => {
    if (value > 0 && value >= count) {
      best = index;
      count = value;
    }
  });
  if (best === -1) return null;
  return { count, startedAt: now - (buckets.length - best) * ALARM_RATE_WINDOW_MS };
}

/**
 * One bar per bucket, oldest first, filling `CHART_WIDTH` × `CHART_HEIGHT` with `BAR_GAP` between them. The tallest bucket
 * uses the whole height; an empty one has height 0 and an occupied one at least `MIN_BAR_HEIGHT`.
 */
export function barGeometry(buckets: readonly number[]): Bar[] {
  const columns = buckets.length || RAISED_BUCKETS;
  const width = (CHART_WIDTH - BAR_GAP * (columns - 1)) / columns;
  const tallest = Math.max(1, ...buckets);
  return buckets.map((count, index) => {
    const height = count > 0 ? Math.max(MIN_BAR_HEIGHT, (count / tallest) * CHART_HEIGHT) : 0;
    return {
      x: round(index * (width + BAR_GAP)),
      y: round(CHART_HEIGHT - height),
      width: round(width),
      height: round(height),
    };
  });
}

/**
 * The chart's accessible name. The rows above it do not list the 18 buckets, so the name carries what the picture says that
 * nothing else does: the window and the peak. One string, so it is one text node.
 */
export function chartLabel(buckets: readonly number[], now: number): string {
  const base = `Raised per ${ALARM_RATE_WINDOW_MS / MINUTE_MS} minutes over the last ${ALARM_HISTORY_MS / HOUR_MS} hours`;
  const peak = peakBucket(buckets, now);
  return peak === null ? base : `${base}, peak ${peak.count} at ${formatClockTime(peak.startedAt)}`;
}
