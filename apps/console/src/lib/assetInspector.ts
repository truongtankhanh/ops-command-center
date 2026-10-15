import type {
  Asset,
  AssetFootprint,
  Incident,
  IncidentSeverity,
  TelemetryPoint,
  TelemetryRule,
  TelemetryValue,
} from '@occ/contracts';
import type { AssetState } from './assets';
import { compareIncidents, isActive } from './incidents';
import { encodeReading } from './ringBuffer';
import { formatReadingAge, formatSince } from './telemetryAge';
import { isStale } from './telemetryFreshness';

/*
 * What the asset inspector says and draws (V2-09.8; wording settled in V2-09.1, frames 03, 05, 08):
 * which points get a row and in what order, the series a sparkline is given, when a reading is over
 * its rule, and the pill and freshness words. Pure: no store, no clock, no React.
 */

/** The window a sparkline shows: 15 minutes, the length of a ring buffer at one point a second. */
export const SPARKLINE_WINDOW_MS = 15 * 60_000;

/** A point and the rule that watches it, if one does. */
export interface InspectorRow {
  point: TelemetryPoint;
  rule: TelemetryRule | null;
}

export interface InspectorRows {
  /** Headline points, then the points a rule watches: always shown. */
  main: InspectorRow[];
  /** The rest, behind "All points (n)". */
  more: InspectorRow[];
}

/**
 * The inspector's rows (V2-09.1): headline points by rank, then the points a rule watches in
 * catalogue order, then the rest. Nothing is dropped, and a point of a kind this console does not
 * know keeps its row. A point's rule is the first one in `rules` for its key.
 */
export function inspectorRows(
  points: readonly TelemetryPoint[],
  rules: readonly TelemetryRule[],
): InspectorRows {
  const ruleOf = new Map<string, TelemetryRule>();
  for (const rule of rules) {
    if (!ruleOf.has(rule.key)) ruleOf.set(rule.key, rule);
  }
  const row = (point: TelemetryPoint): InspectorRow => ({
    point,
    rule: ruleOf.get(point.key) ?? null,
  });

  const headline = points
    .filter((point) => point.headline !== null)
    .sort((a, b) => (a.headline ?? 0) - (b.headline ?? 0));
  const ruled = points.filter((point) => point.headline === null && ruleOf.has(point.key));
  const rest = points.filter((point) => point.headline === null && !ruleOf.has(point.key));
  return { main: [...headline, ...ruled].map(row), more: rest.map(row) };
}

/**
 * The latest value as the number a ring stores (a boolean as 0 / 1, an enum as its index), which is
 * what a rule's limit and a sparkline are in. `null` for no value or one that has no number.
 */
export function encodedLatest(
  point: Pick<TelemetryPoint, 'enumValues'>,
  value: TelemetryValue | undefined,
): number | null {
  return value === undefined ? null : encodeReading(value, point.enumValues);
}

/** What a sparkline is given: the ring's points, with the latest value appended while live. */
export interface DrawnSeries {
  times: Float64Array;
  values: Float32Array;
}

const NO_TIMES = new Float64Array(0);
const NO_VALUES = new Float32Array(0);

/**
 * The series to draw. The API sends a key only when its value changes, so a healthy steady key's
 * last point can be minutes old; the sparkline never extends a series (V2-09.7), so while the asset
 * is `live` one point `(to, latest)` is added after the ring's. It is not added when stale (the
 * chart must stop at the last reading), with no latest value, or when the ring already reaches
 * `to`. The ring's arrays are never mutated; when nothing is added they are returned as they are.
 */
export function drawnSeries(
  series: { t: Float64Array; v: Float32Array } | undefined,
  latest: number | null,
  to: number,
  live: boolean,
): DrawnSeries {
  const times = series?.t ?? NO_TIMES;
  const values = series?.v ?? NO_VALUES;
  const last = times.length > 0 ? (times[times.length - 1] ?? Number.NEGATIVE_INFINITY) : -Infinity;
  if (!live || latest === null || !Number.isFinite(to) || last >= to) return { times, values };

  const appendedTimes = new Float64Array(times.length + 1);
  appendedTimes.set(times);
  appendedTimes[times.length] = to;
  const appendedValues = new Float32Array(values.length + 1);
  appendedValues.set(values);
  appendedValues[values.length] = latest;
  return { times: appendedTimes, values: appendedValues };
}

/**
 * The rule's severity when `latest` is past its limit: `above` is greater than, `below` is less
 * than. A boolean point's limit is the encoding 0.5, so a true value is above it. `undefined` for no
 * rule, no value, or a comparator this console does not know.
 */
export function overSeverity(
  rule: Pick<TelemetryRule, 'comparator' | 'limit' | 'severity'> | null,
  latest: number | null,
): IncidentSeverity | undefined {
  if (rule === null || latest === null) return undefined;
  switch (rule.comparator) {
    case 'above':
      return latest > rule.limit ? rule.severity : undefined;
    case 'below':
      return latest < rule.limit ? rule.severity : undefined;
    default:
      return undefined;
  }
}

/**
 * Whether the asset's reading is not live: its device's last will fired, or its latest reading is
 * at or past the asset's threshold on the server's clock (`telemetryFreshness`). With no clock yet
 * an online asset is not judged stale, as everywhere else.
 */
export function readingIsStale(
  entry: { online: boolean; receivedAt: string },
  staleAfter: number | null,
  serverNow: number | null,
): boolean {
  if (!entry.online) return true;
  return serverNow !== null && isStale(entry.receivedAt, staleAfter, serverNow);
}

/**
 * The pill's word (frames 03, 05): the state, with "since HH:MM" for no data and offline, the time
 * of the last reading (`formatSince`; frame 05 draws seconds, the settled helper writes minutes).
 * `null` for `unknown`: the inspector draws no word it cannot stand behind.
 */
export function inspectorStateText(
  state: AssetState,
  receivedAt: string | null,
  serverNow: number | null,
): string | null {
  const since = (word: string): string =>
    receivedAt !== null && serverNow !== null && Number.isFinite(Date.parse(receivedAt))
      ? `${word} since ${formatSince(receivedAt, serverNow)}`
      : word;
  switch (state) {
    case 'fault':
      return 'Fault';
    case 'running':
      return 'Running';
    case 'standby':
      return 'Standby';
    case 'nodata':
      return since('No data');
    case 'offline':
      return since('Offline');
    case 'unknown':
      return null;
  }
}

/** "Updated 0.4 s ago" while live, "1 min 12 s old" when not; `null` with no reading to date. */
export function freshnessText(ageMs: number | null, stale: boolean): string | null {
  if (ageMs === null) return null;
  const age = formatReadingAge(ageMs);
  return stale ? `${age} old` : `Updated ${age} ago`;
}

/**
 * The unresolved incidents of `asset`, in the feed's order (most severe, then newest), so the
 * first is the one `openIncidentOf` names and the head's "Fault · INC-…" says. Nothing resolved is
 * listed: with none open the inspector draws no incident section at all (V2-09.9).
 */
export function incidentsOf(asset: Pick<Asset, 'id'>, incidents: readonly Incident[]): Incident[] {
  return incidents
    .filter((incident) => incident.assetId === asset.id && isActive(incident))
    .sort(compareIncidents);
}

// `en-GB` like `readings.ts`: "1.4", "6", "2.3".
const METRES = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });

/**
 * The box a neutral placeholder is drawn from, as "1.4 × 1.4 × 1.4 m" (width × depth × height,
 * frame 15's note). A width alone would read as a cube for a 6 × 1 × 2.3 m switchgear.
 */
export function footprintText(footprint: AssetFootprint): string {
  const { width, depth, height } = footprint;
  return `${METRES.format(width)} × ${METRES.format(depth)} × ${METRES.format(height)} m`;
}
