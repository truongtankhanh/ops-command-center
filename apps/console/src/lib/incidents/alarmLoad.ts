import type { Asset, Incident } from '@occ/contracts';
import { INCIDENT_LIST_LIMIT, isPastAttention } from './incidents';

/*
 * Alarm load (V3-21.1, frame 16, brief § Operations aids): how much the console is asking of the operator, derived from the
 * incident list and the asset catalogue the console already holds. A view of existing incidents, identical on every console, that
 * raises nothing and stores nothing: every function takes `now` and is a function of its arguments alone, so a reload or a second
 * console agrees and a test needs no clock.
 *
 * The cached list is the API's first `INCIDENT_LIST_LIMIT` incidents, in the order it sorts them (unresolved first, then by
 * severity, then newest): see `isPartial`.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/*
 * The figures below are ISA-18.2 / EEMUA 191's for process plants and `unverified` for a campus (Open question 18): read them on a
 * week of real incidents before anyone relies on them. They are constants so that is one edit.
 */

/** The window a rate is counted over: "alarms 3 / 10 min". */
export const ALARM_RATE_WINDOW_MS = 10 * MINUTE_MS;
/** A flood starts when the rate is above this (so exactly this many is not one). */
export const FLOOD_START_ABOVE = 10;
/** A flood ends when the rate is below this (so exactly this many still holds it). Between the two, the state holds. */
export const FLOOD_END_BELOW = 5;
/** How far back the flood is replayed and the chart reaches. */
export const ALARM_HISTORY_MS = 3 * HOUR_MS;
/** How far back the noisy devices are counted. */
export const NOISY_WINDOW_MS = 24 * HOUR_MS;
/** How many noisy devices are listed. */
export const NOISY_TOP = 5;
/** The chart's bars: one per rate window across the history. */
export const RAISED_BUCKETS = ALARM_HISTORY_MS / ALARM_RATE_WINDOW_MS;

/**
 * When an incident was reported, in epoch ms, or `null` when the date does not parse. A date after `now` (a server clock ahead of
 * this browser's) is counted as `now`, not dropped: the incident is real and the operator must see it in the rate at once.
 */
function reportedAt(incident: Incident, now: number): number | null {
  const at = Date.parse(incident.reportedAt);
  return Number.isFinite(at) ? Math.min(at, now) : null;
}

/** Every valid reported time, oldest first. The rate, the flood and the chart all read this, so those rules live in one place. */
function reportedTimes(incidents: readonly Incident[], now: number): number[] {
  const times: number[] = [];
  for (const incident of incidents) {
    const at = reportedAt(incident, now);
    if (at !== null) times.push(at);
  }
  return times.sort((a, b) => a - b);
}

/** Incidents of any source and status reported in the last `ALARM_RATE_WINDOW_MS`: the window is `(now - window, now]`. */
export function alarmRate(incidents: readonly Incident[], now: number): number {
  const from = now - ALARM_RATE_WINDOW_MS;
  return reportedTimes(incidents, now).filter((at) => at > from).length;
}

export type FloodState =
  { flooding: false; since: null; rate: number } | { flooding: true; since: number; rate: number };

/**
 * Whether the console is in an alarm flood, and since when. The state is **replayed**, not remembered: it starts calm
 * `ALARM_HISTORY_MS` ago, steps through every minute, and a flood starts at the first step whose rate is above
 * `FLOOD_START_ABOVE` and ends at the first step whose rate is below `FLOOD_END_BELOW`; in between (hysteresis) it holds. So
 * the answer depends on the list and the clock alone.
 *
 * The steps sit on the **wall clock's** minute boundaries, then one more at `now`: on `now`'s own minutes the boundaries (and so
 * `since`) would move on every tick and differ between two consoles; and without the step at `now` the eleventh incident would
 * not make a flood until the next minute. `since` is the epoch ms of the step that began the current flood. A flood already on
 * at the first step reports that step: the model cannot see further back than its history.
 *
 * `rate` is the rate at `now`.
 */
export function floodState(incidents: readonly Incident[], now: number): FloodState {
  const times = reportedTimes(incidents, now);
  const steps: number[] = [];
  const lastBoundary = Math.floor(now / MINUTE_MS) * MINUTE_MS;
  for (
    let step = Math.ceil((now - ALARM_HISTORY_MS) / MINUTE_MS) * MINUTE_MS;
    step <= lastBoundary;
    step += MINUTE_MS
  ) {
    steps.push(step);
  }
  if (lastBoundary < now) steps.push(now);

  // Two pointers over the sorted times, `(lo, hi]` being the window at the current step: linear in incidents plus steps.
  let flooding = false;
  let since: number | null = null;
  let rate = 0;
  let lo = 0;
  let hi = 0;
  for (const step of steps) {
    while (hi < times.length && (times[hi] ?? Infinity) <= step) hi++;
    while (lo < hi && (times[lo] ?? Infinity) <= step - ALARM_RATE_WINDOW_MS) lo++;
    rate = hi - lo;
    if (!flooding && rate > FLOOD_START_ABOVE) {
      flooding = true;
      since = step;
    } else if (flooding && rate < FLOOD_END_BELOW) {
      flooding = false;
      since = null;
    }
  }
  return flooding && since !== null
    ? { flooding: true, since, rate }
    : { flooding: false, since: null, rate };
}

/** Open incidents past their attention threshold (`isPastAttention`: the thresholds are not restated here). */
export function standingCount(incidents: readonly Incident[], now: number): number {
  return incidents.filter((incident) => isPastAttention(incident, now)).length;
}

export interface NoisyDevice {
  assetCode: string;
  name: string;
  count: number;
}

/** Plain code-unit order, not `localeCompare`: the order of ties must be the same on every console. */
const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The assets that raised the most incidents in the last `NOISY_WINDOW_MS`, at most `NOISY_TOP`, so a flapping sensor is seen
 * rather than endured. Only incidents with an `assetId` count (an operator's has none). The asset is found by `id`; one the
 * catalogue lacks is skipped, never shown as a raw id. Ties go to the asset reported most recently, then to the lower code.
 */
export function noisyDevices(
  incidents: readonly Incident[],
  assets: readonly Asset[],
  now: number,
): NoisyDevice[] {
  const from = now - NOISY_WINDOW_MS;
  const groups = new Map<string, { count: number; latest: number }>();
  for (const incident of incidents) {
    if (!incident.assetId) continue;
    const at = reportedAt(incident, now);
    if (at === null || at <= from) continue;
    const group = groups.get(incident.assetId);
    if (group) {
      group.count++;
      group.latest = Math.max(group.latest, at);
    } else {
      groups.set(incident.assetId, { count: 1, latest: at });
    }
  }

  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const ranked: { asset: Asset; count: number; latest: number }[] = [];
  for (const [assetId, group] of groups) {
    const asset = byId.get(assetId);
    if (asset) ranked.push({ asset, ...group });
  }
  ranked.sort(
    (a, b) => b.count - a.count || b.latest - a.latest || byCode(a.asset.code, b.asset.code),
  );
  return ranked
    .slice(0, NOISY_TOP)
    .map(({ asset, count }) => ({ assetCode: asset.code, name: asset.name, count }));
}

/**
 * The chart's data: `RAISED_BUCKETS` counts of `ALARM_RATE_WINDOW_MS`, oldest first, the last ending now. Anchored at `now` (not
 * the wall clock, unlike the flood's steps) so that the sum is exactly the incidents in the last `ALARM_HISTORY_MS` and the last
 * bar is exactly `alarmRate`; wall-clock bars would leave the newest one partial.
 */
export function raisedPerBucket(incidents: readonly Incident[], now: number): number[] {
  const counts: number[] = new Array<number>(RAISED_BUCKETS).fill(0);
  for (const at of reportedTimes(incidents, now)) {
    const age = now - at;
    if (age >= ALARM_HISTORY_MS) continue;
    const index = RAISED_BUCKETS - 1 - Math.floor(age / ALARM_RATE_WINDOW_MS);
    counts[index] = (counts[index] ?? 0) + 1;
  }
  return counts;
}

/**
 * Whether the cached list is as long as the request asks for, so older incidents may be missing. The API sorts unresolved first,
 * then by severity, then newest, so a full page drops the **oldest resolved Low** incidents first, not simply the oldest: when
 * this is true, **every** measure here (the rate, the flood, the chart as well as the noisy devices) is a lower bound. Live events
 * add to the cache beyond the request, hence `>=`.
 */
export function isPartial(incidents: readonly Incident[]): boolean {
  return incidents.length >= INCIDENT_LIST_LIMIT;
}
