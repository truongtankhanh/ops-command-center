/**
 * When an asset's readings are no longer current: the decision half of freshness (ADR-0019
 * § Freshness, settled in V2-08.1). Pure and free of display code, so the telemetry worker can
 * import it without pulling the console's formatters; the wording lives in `telemetryAge.ts`.
 *
 * Nothing here reads a clock. Age is judged on the server's clock, which the caller rebuilds with
 * `serverNow`: the browser's clock may be minutes off and would grey every asset.
 */

/** A reading is stale once it is this many of the point's expected intervals old (ADR-0019). */
export const STALE_AFTER_INTERVALS = 3;

/**
 * The lowest threshold. The overview is 1 Hz and `volatile`, so a 1 s point would otherwise flash
 * "No data" after two skipped overviews (V2-08.1).
 */
export const STALE_FLOOR_MS = 5_000;

/**
 * How old an asset's latest reading may get before the asset is stale: three times the shortest
 * expected interval among its headline points, never below `STALE_FLOOR_MS`. The headline points
 * are the only ones an unwatched asset has, and the shortest is used because the slowest would let
 * a dead leak sensor stay "live" for three hours (asset-classes.md, question 6).
 *
 * `null` when no usable interval is known (the catalogue is not loaded, or the class has no
 * headline point): the asset cannot be judged, and `isStale` reads that as not stale.
 */
export function staleAfterMs(headline: readonly { expectedIntervalS: number }[]): number | null {
  const intervals = headline
    .map((point) => point.expectedIntervalS)
    .filter((seconds) => Number.isFinite(seconds) && seconds > 0);
  if (intervals.length === 0) return null;
  const threshold = Math.round(STALE_AFTER_INTERVALS * Math.min(...intervals) * 1000);
  return Math.max(threshold, STALE_FLOOR_MS);
}

/**
 * Milliseconds since `receivedAt`, on the server's clock. Never negative: a reading stamped a
 * moment ahead of the clock anchor is 0 s old, not -2 s.
 */
export function ageMs(receivedAt: string, serverNow: number): number {
  return Math.max(0, serverNow - Date.parse(receivedAt));
}

/**
 * Whether the reading received at `receivedAt` is stale at `serverNow`, given the asset's
 * `staleAfterMs`. At the threshold it is already stale. `online: false` is a separate state (V2-08.1)
 * and is not decided here.
 */
export function isStale(receivedAt: string, staleAfter: number | null, serverNow: number): boolean {
  return staleAfter !== null && ageMs(receivedAt, serverNow) >= staleAfter;
}

/**
 * The server's clock as the console last saw it: `at` is an API timestamp (`overview.at` or
 * `snapshot.at`, epoch ms) and `mono` is the monotonic time, in ms, at which that message arrived.
 */
export interface ServerClock {
  at: number;
  mono: number;
}

/**
 * The server's time now: the anchor plus the monotonic time since it arrived, so a console whose
 * socket is down keeps ageing its readings (V2-08.1). `null` until a message has anchored the
 * clock; nothing can be judged before then. `mono` comes from the caller (`performance.now()` in
 * the shell), which keeps this module testable without timers.
 */
export function serverNow(clock: ServerClock | null, mono: number): number | null {
  return clock === null ? null : clock.at + (mono - clock.mono);
}
