import type { AssetTelemetry } from '@occ/contracts';
import { type QueryKey, useQuery } from '@tanstack/react-query';
import { type AssetHistoryRange, assetHistoryQuery } from '../../api/queries';
import { seriesFromHistory } from '../../realtime/telemetryClient';
import {
  RANGE_ROUND_MS,
  READING_RANGE_MAX_MS,
  type ReadingRange,
  rangeWindow,
} from './readingRange';

/*
 * The series a Telemetry tab draws for a range (V3-23.2, frame 18). `15m` is the live ring and sends nothing: the rows
 * keep `useAssetSeries` and the live point, as before. `1h` and Around the alarm read `GET /assets/:code/telemetry`
 * once per asset, however many rows draw, so the caller (the tab) calls this once and hands the result to
 * `AssetReadings`.
 *
 * The window's strings are the query key and move every `RANGE_ROUND_MS` (V3-23.1), so the same range asked twice
 * within 30 s is one request, and `staleTime` is the same 30 s (the brief's "cached 30 s"; the route is rate-limited).
 * While the tab stays on 1 h the window slides every 30 s and is fetched again; the previous buckets stay on screen
 * until the new ones land, but only for that slide (`isSameSlide`), never another asset's or another range's.
 */

/** One point's history, as the ring holds it: epoch ms on the API's clock, and the value encoded as a number. */
export interface SeriesColumn {
  readonly t: Float64Array;
  readonly v: Float32Array;
}

/** A window in epoch ms, `[from, to)`. */
export interface ReadingWindow {
  readonly from: number;
  readonly to: number;
}

/**
 * - `live`: `15m`, nothing is fetched; the rows draw the live ring.
 * - `loading`: a range is asked for and nothing is there yet, or the server clock is not known yet.
 * - `error`: the request failed and nothing is there to show (V3-23.4 draws it, a 404 included).
 * - `ready`: buckets are there, including the previous slide's while the next loads, and a failed refetch that kept
 *   them (as `useIncidentTelemetry` keeps a tab on a blip).
 */
export type ReadingSeriesStatus = 'live' | 'loading' | 'error' | 'ready';

export interface ReadingSeries {
  /** The window of the buckets drawn, else the one asked for; `null` for `15m` or with no clock. */
  readonly window: ReadingWindow | null;
  /** One column per point key that has numbers in the window; an enum and a key never received have none. */
  readonly byKey: ReadonlyMap<string, SeriesColumn>;
  /** Around the alarm's raised time, for the dashed marker; `null` for the other ranges. */
  readonly markerAt: number | null;
  readonly status: ReadingSeriesStatus;
  /** The request's error, for V3-23.4 (404 "no history", 429, Retry). */
  readonly error: unknown;
  readonly refetch: () => void;
}

const EMPTY: ReadonlyMap<string, SeriesColumn> = new Map();

interface Selected {
  readonly window: ReadingWindow;
  readonly byKey: ReadonlyMap<string, SeriesColumn>;
}

// Module-level, so TanStack memoises the result per response and a rerender gets the same `Map` (the rows memoise on
// its columns). The window is the response's: the request with its defaults applied, never clamped
// (`docs/api/assets.md`), so the previous slide's buckets are drawn on their own window and never shifted.
function selectSeries(history: AssetTelemetry): Selected {
  return {
    window: { from: Date.parse(history.from), to: Date.parse(history.to) },
    byKey: new Map(seriesFromHistory(history).map(({ key, t, v }) => [key, { t, v }])),
  };
}

const spanMs = (from: string, to: string): number => Date.parse(to) - Date.parse(from);

/**
 * Whether the request that just went out continues the one before it on the same asset, so its buckets may stay on
 * screen while the new ones load: an open Around the alarm window that grew (same `from`), or the 1 h window that moved
 * (both exactly an hour). Anything else, another asset or a switch between ranges, starts from `loading`: showing the
 * previous buckets there would draw the wrong data.
 *
 * Reads the key layout of `assetHistoryQuery`: `['assets', code, 'history', from, to]`.
 */
export function isSameSlide(
  previousKey: QueryKey | undefined,
  assetCode: string,
  asked: AssetHistoryRange | null,
): boolean {
  if (previousKey === undefined || asked === null) return false;
  const [, code, , from, to] = previousKey;
  if (code !== assetCode || typeof from !== 'string' || typeof to !== 'string') return false;
  if (from === asked.from) return true;
  return (
    spanMs(from, to) === READING_RANGE_MAX_MS &&
    spanMs(asked.from, asked.to) === READING_RANGE_MAX_MS
  );
}

/**
 * The fetched series of `range` for one asset. `now` is the server clock (`useServerNow()`), read by the caller: no
 * request is sent while it is `null`, and a tab whose clock is off (a resolved incident) turns it on for a past range.
 * Leaving the tab unmounts the query and sends nothing more.
 */
export function useReadingSeries(
  assetCode: string,
  range: ReadingRange,
  now: number | null,
  reportedAt?: string,
): ReadingSeries {
  const asked = range === '15m' || now === null ? null : rangeWindow(range, now, reportedAt);
  const query = useQuery({
    ...assetHistoryQuery(assetCode, asked ?? undefined),
    enabled: asked !== null,
    staleTime: RANGE_ROUND_MS,
    placeholderData: (previous, previousQuery) =>
      isSameSlide(previousQuery?.queryKey, assetCode, asked) ? previous : undefined,
    select: selectSeries,
  });

  if (range === '15m') {
    return {
      window: null,
      byKey: EMPTY,
      markerAt: null,
      status: 'live',
      error: null,
      refetch: query.refetch,
    };
  }

  const raised =
    range === 'alarm' && reportedAt !== undefined ? Date.parse(reportedAt) : Number.NaN;
  const data = query.data;
  const askedWindow =
    asked === null ? null : { from: Date.parse(asked.from), to: Date.parse(asked.to) };
  return {
    window: data?.window ?? askedWindow,
    byKey: data?.byKey ?? EMPTY,
    markerAt: Number.isFinite(raised) ? raised : null,
    status: data !== undefined ? 'ready' : query.isError ? 'error' : 'loading',
    error: query.error,
    refetch: query.refetch,
  };
}
