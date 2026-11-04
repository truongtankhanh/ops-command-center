import type { AssetHistoryRange } from '../../api/queries';
import { formatClockTime } from '../shared/time';

/*
 * Reading range (V3-23.1, frame 18, brief § Operations aids): the `[from, to)` the Telemetry tabs ask
 * `GET /assets/:code/telemetry` for when the operator picks 15 min, 1 h or Around the alarm. Pure: it reads no clock,
 * no store and no React, so a test needs no timers.
 *
 * The two strings are the query key (`useAssetHistory`), so they must not move on every render: `now` is rounded down
 * to `RANGE_ROUND_MS` first, and the same range asked twice within it is one cache entry and one request. That is the
 * brief's "cached 30 s", and it keeps the switch well under the route's rate limit.
 */

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * The API's sample bucket (`SAMPLE_BUCKET_MS`, `docs/api/assets.md`): every bucket starts at a multiple of 5 s since
 * the epoch. A copy, because apps never import each other (ADR-0001) and `@occ/contracts` does not carry it.
 */
const BUCKET_MS = 5 * SECOND_MS;

/** How long a window's strings stay the same. A multiple of `BUCKET_MS`, so a rounded end falls on a bucket start. */
export const RANGE_ROUND_MS = 30 * SECOND_MS;

/**
 * The widest range the route serves in one request: a span over an hour is `400`, exactly an hour is allowed
 * (`HISTORY_MAX_SPAN_MS`, `docs/api/assets.md`). Anything longer is V4's replay.
 */
export const READING_RANGE_MAX_MS = HOUR_MS;

/** Around the alarm reads from this long before the incident was raised (brief § Operations aids)… */
export const ALARM_BEFORE_MS = 10 * MINUTE_MS;

/** …to this long after it, or to now if that has not come yet. */
export const ALARM_AFTER_MS = 5 * MINUTE_MS;

export type ReadingRange = '15m' | '1h' | 'alarm';

export interface ReadingRangeOption {
  readonly id: ReadingRange;
  /** The switch's visible text, frame 18's wording. */
  readonly label: string;
}

/** Every range in the switch's order. Which of them a tab offers is `rangeOffered`'s call. */
export const READING_RANGES: readonly ReadingRangeOption[] = [
  { id: '15m', label: '15 min' },
  { id: '1h', label: '1 h' },
  { id: 'alarm', label: 'Around the alarm' },
];

/**
 * What the Telemetry tab is about. An incident's `assetId` mirrors `Incident.assetId` (a missing one reads as `null`),
 * so the caller can pass the incident's own fields.
 */
export type ReadingRangeContext =
  | { readonly kind: 'asset' }
  | { readonly kind: 'incident'; readonly assetId?: string | null; readonly reportedAt: string };

const SPAN_MS: Readonly<Record<Exclude<ReadingRange, 'alarm'>, number>> = {
  '15m': 15 * MINUTE_MS,
  '1h': READING_RANGE_MAX_MS,
};

const floorTo = (t: number, step: number): number => Math.floor(t / step) * step;

const isValidTime = (t: number): boolean => !Number.isNaN(new Date(t).getTime());

// `toISOString()` throws on an invalid date, including a finite epoch beyond `Date`'s range; a window that cannot be
// written is no window. `toISOString()` is UTC with its `Z`, so the route's "ISO 8601 with a zone" always holds.
function toWindow(from: number, to: number): AssetHistoryRange | null {
  if (!isValidTime(from) || !isValidTime(to)) return null;
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

/**
 * The window to read for `range` at `now` (epoch ms, the server's clock), or `null` when there is none to ask for.
 *
 * - `15m` and `1h` end at `now` rounded down to `RANGE_ROUND_MS`; `1h` is exactly `READING_RANGE_MAX_MS`.
 * - `alarm` is `[reportedAt − 10 min, reportedAt + 5 min)`, both ends floored to the 5 s bucket so a closed window is
 *   exactly 15 minutes, and cut at the rounded `now` while it is still open. A `reportedAt` ahead of the clock (skew)
 *   shortens it; it is `null` when nothing is left, or when `reportedAt` is missing or does not parse.
 */
export function rangeWindow(
  range: ReadingRange,
  now: number,
  reportedAt?: string,
): AssetHistoryRange | null {
  if (!Number.isFinite(now)) return null;
  const end = floorTo(now, RANGE_ROUND_MS);
  if (range !== 'alarm') return toWindow(end - SPAN_MS[range], end);

  const raised = reportedAt === undefined ? Number.NaN : Date.parse(reportedAt);
  if (!Number.isFinite(raised)) return null;
  const from = floorTo(raised - ALARM_BEFORE_MS, BUCKET_MS);
  const to = Math.min(floorTo(raised + ALARM_AFTER_MS, BUCKET_MS), end);
  return from < to ? toWindow(from, to) : null;
}

/**
 * Whether the switch offers `range`. 15 min and 1 h are always there; Around the alarm needs an incident with an asset
 * and a raised time that parses, the same inputs `rangeWindow` needs. The source is not checked: the incident's
 * Telemetry tab exists only for a telemetry incident already (V3-09.6).
 */
export function rangeOffered(range: ReadingRange, context: ReadingRangeContext): boolean {
  if (range !== 'alarm') return true;
  return (
    context.kind === 'incident' &&
    typeof context.assetId === 'string' &&
    context.assetId !== '' &&
    Number.isFinite(Date.parse(context.reportedAt))
  );
}

/**
 * The line under the switch that says which window a past range draws (frame 18): `14:42–15:42`, and for Around the
 * alarm `15:29–15:44 · raised 15:39`. Clock times as every other in the console (`formatClockTime`: HH:MM, the
 * browser's time zone). `null` for 15 min (the live ring has no fixed window) or while no window is known. Frame 18a's
 * sentence about the provisional last bucket and the per-chart time axis are not drawn.
 */
export function rangeCaption(
  range: ReadingRange,
  shown: { readonly from: number; readonly to: number } | null,
  markerAt: number | null,
): string | null {
  if (range === '15m' || shown === null) return null;
  const span = `${formatClockTime(shown.from)}–${formatClockTime(shown.to)}`;
  return range === 'alarm' && markerAt !== null && Number.isFinite(markerAt)
    ? `${span} · raised ${formatClockTime(markerAt)}`
    : span;
}
