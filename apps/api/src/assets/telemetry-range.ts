import { SAMPLE_BUCKET_MS } from '../telemetry/sample-partitions';

/**
 * The range rules of `GET /assets/:code/telemetry` (ADR-0018, "Read API"): pure and in one place,
 * so the handler, the DTO descriptions, the docs and their specs read the same numbers. Epoch
 * arithmetic only, as `sample-partitions.ts`: the server's time zone moves nothing.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** The window served when `from` is not given: what the inspector's sparkline shows. */
export const HISTORY_DEFAULT_WINDOW_MS = 15 * MINUTE_MS;

/** The widest range one call serves. With 5 s buckets this is also the most rows it can return. */
export const HISTORY_MAX_SPAN_MS = HOUR_MS;

/** `HISTORY_MAX_SPAN_MS` in buckets: 720. The range is half-open, so the span is the whole check. */
export const HISTORY_MAX_BUCKETS = HISTORY_MAX_SPAN_MS / SAMPLE_BUCKET_MS;

/** What the query string carries, both ISO 8601 with a zone (the DTO checks the format). */
export interface TelemetryRangeQuery {
  from?: string;
  to?: string;
}

/** The range to read, `[from, to)`, or everything wrong with the request. */
export type TelemetryRange = { ok: true; from: Date; to: Date } | { ok: false; problems: string[] };

/**
 * Applies the defaults (`to` is `now`, `from` is `to` minus 15 minutes) and the limits. Every
 * problem is returned, not the first, so the `400` lists them as the DTO's errors are listed.
 * `from == to` is valid: an empty range. A `to` in the future is valid: it returns what exists.
 */
export function resolveTelemetryRange(query: TelemetryRangeQuery, now: Date): TelemetryRange {
  const to = query.to === undefined ? now : new Date(query.to);
  const from =
    query.from === undefined
      ? new Date(to.getTime() - HISTORY_DEFAULT_WINDOW_MS)
      : new Date(query.from);

  // The DTO has already refused anything that is not a date; this keeps `NaN` from reaching SQL.
  const problems: string[] = [];
  if (Number.isNaN(to.getTime())) problems.push('to must be an ISO 8601 date and time');
  if (query.from !== undefined && Number.isNaN(from.getTime())) {
    problems.push('from must be an ISO 8601 date and time');
  }
  if (problems.length > 0) return { ok: false, problems };

  if (to.getTime() < from.getTime()) {
    problems.push('to must not be before from');
  } else if (to.getTime() - from.getTime() > HISTORY_MAX_SPAN_MS) {
    const hours = HISTORY_MAX_SPAN_MS / HOUR_MS;
    problems.push(
      `the range must be at most ${hours} hour${hours === 1 ? '' : 's'} ` +
        `(${HISTORY_MAX_BUCKETS} buckets of ${SAMPLE_BUCKET_MS / 1000} seconds)`,
    );
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, from, to };
}
