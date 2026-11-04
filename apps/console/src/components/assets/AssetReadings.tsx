import type { TelemetryValue } from '@occ/contracts';
import { useMemo } from 'react';
import { ApiRequestError } from '../../api/client';
import {
  drawnSeries,
  encodedLatest,
  freshnessText,
  type InspectorRow,
  type InspectorRows,
  overSeverity,
  SPARKLINE_WINDOW_MS,
} from '../../lib/assets/assetInspector';
import { formatReading, limitLine } from '../../lib/assets/readings';
import type { ReadingRange } from '../../lib/telemetry/readingRange';
import { ageMs as readingAgeMs } from '../../lib/telemetry/telemetryFreshness';
import type { AssetTelemetryState } from '../../lib/telemetry/telemetryState';
import type { ReadingSeries } from '../../lib/telemetry/useReadingSeries';
import { useAssetSeries } from '../../realtime/telemetryStore';
import { EmptyState } from '../../ui/EmptyState';
import { Hint } from '../../ui/Hint';
import { Clock } from '../../ui/icons';
import { Skeleton } from '../../ui/Skeleton';
import { Sparkline } from '../../ui/Sparkline';
import { LoadFailed, RateLimited } from '../shell/LoadStates';
import styles from './AssetReadings.module.css';

const BOOLEAN_RANGE = { min: 0, max: 1 } as const;

/** The eyebrow of live (or past) readings, by range; stale and ended read "Last readings" whatever the range. */
const RANGE_HEADING: Readonly<Record<ReadingRange, string>> = {
  '15m': 'Live readings',
  '1h': 'Readings, last hour',
  alarm: 'Readings around the alarm',
};

/**
 * Where a past range's request stands, as the section says it (V3-23.4, frame 18): `null` when the buckets are drawn
 * (or on `15m`, which fetches nothing). At most one of these is on screen, so there is one status line at a time.
 */
type RangeState = 'loading' | 'rateLimited' | 'failed' | 'noHistory' | 'empty';

function rangeState(history: ReadingSeries | undefined): RangeState | null {
  if (history === undefined) return null;
  switch (history.status) {
    case 'loading':
      return history.rateLimited ? 'rateLimited' : 'loading';
    case 'error':
      // An older replica without the route answers 404 (V3-23.2's risk): no retry would change it.
      return history.error instanceof ApiRequestError && history.error.status === 404
        ? 'noHistory'
        : 'failed';
    case 'ready':
      return history.empty ? 'empty' : null;
    default:
      return null;
  }
}

/**
 * The readings of the inspected asset (frames 03, 05, 08): one row per point with its rule line, a
 * sparkline of the last 15 minutes and the value, headline and ruled points first and the rest
 * behind "All points (n)" (V2-09.1).
 *
 * Whether the asset is live is the caller's single fact (`stale`): when it is not, the eyebrow
 * reads "Last readings", every value is dimmed, the sparklines stop at the last reading and say
 * why. No per-point age is drawn: the API sends changed keys only, so a steady key's age would
 * read "old" on a healthy device (V2-08.3).
 *
 * `ended` is the other way for readings not to be live: not an outage but a watch that stopped on
 * purpose (a resolved incident's Telemetry tab, V3-09.6). The console watches an asset only while
 * something needs it, and when the watch stops the series are dropped and the headline is all the
 * store keeps, so a "live" look would be false. With `ended` the eyebrow reads "Last readings", the
 * rows are dimmed as a stale row is, no sparkline is drawn (a dropped series would otherwise be
 * redrawn as a single live point) and there is no freshness line (the age of an unfed reading says
 * nothing to rely on) and no outage hint (no chart is drawn for it to explain). It wins over
 * `stale`; absent or `false` it changes nothing.
 *
 * `serverNow` is read once by the caller and passed down. The freshness text sits outside any live
 * region, so it does not announce every second.
 *
 * `range` other than `15m` (V3-23.2, frame 18) draws each row's sparkline from `history`, the
 * fetched buckets the caller got from `useReadingSeries`: one request for the asset, however many
 * rows. The buckets are drawn as they are over the window they were read for, never extended to
 * now (V2-09.7) and with no live point, and Around the alarm marks the raised time. The value, the
 * rule line, the over-limit tint and the stale dimming stay the live ones. History comes from the
 * database, not from the watch, so `ended` does not hide a past range's chart. With `15m` (the
 * default) `history` is ignored and the rows draw the live ring as before.
 *
 * On a past range the eyebrow names it ("Readings, last hour", "Readings around the alarm", V3-23.3)
 * and the freshness line is hidden: a past window has no freshness. A stale asset and an ended watch
 * still read "Last readings". The eyebrow is a heading, not a live region: a range switch is said by
 * the switch itself.
 *
 * A past range says where its request stands (V3-23.4, frame 18), one line at a time under the rows: while it loads
 * each chart is a skeleton and a hidden status says "Loading readings…" (a 429 being retried says so instead,
 * `RateLimited`); a failure is `LoadFailed` with Retry, which reads that range again and no other; a 404 is "No history
 * for this asset." with no Retry; a range with no sample is "No readings in this range." with no chart. A range with
 * readings, only none for one point, says "No readings" in that row. In every state the rows keep their label, rule
 * line and live value, and the switch above stays usable: nothing is said by colour alone. The error keeps no 15 min
 * chart (frame 18c draws one): the eyebrow names the range asked for, so a live chart under it would misread.
 */
export function AssetReadings({
  assetCode,
  rows,
  entry,
  serverNow,
  stale,
  ended = false,
  range = '15m',
  history,
}: {
  assetCode: string;
  rows: InspectorRows;
  /** `undefined` while nothing was received for the asset. */
  entry: AssetTelemetryState | undefined;
  /** The API's time now; `null` until the first overview. */
  serverNow: number | null;
  stale: boolean;
  /** The readings are no longer being fed because the thing that watched them is over. */
  ended?: boolean;
  /** Which window the sparklines show; `15m` is the live ring. */
  range?: ReadingRange;
  /** The fetched series of a past range; read only when `range` is not `15m`. */
  history?: ReadingSeries;
}) {
  const past = range !== '15m';
  const age =
    entry !== undefined && serverNow !== null ? readingAgeMs(entry.receivedAt, serverNow) : null;
  const freshness = ended || past ? null : freshnessText(age, stale);
  const state = past ? rangeState(history) : null;
  // While the range loads (or a 429 is retried) each row keeps its place with a skeleton chart.
  const loading = state === 'loading' || state === 'rateLimited';
  const row = (item: InspectorRow) => (
    <ReadingRow
      key={item.point.key}
      assetCode={assetCode}
      row={item}
      entry={entry}
      serverNow={serverNow}
      stale={stale}
      ended={ended}
      history={past ? history : undefined}
      past={past}
      loading={loading}
    />
  );
  const busy = loading ? 'true' : undefined;

  return (
    <section className={styles.section} aria-labelledby="asset-readings-title">
      <div className={styles.head}>
        <h3 id="asset-readings-title">{stale || ended ? 'Last readings' : RANGE_HEADING[range]}</h3>
        {freshness !== null && (
          <span className={styles.freshness} data-stale={stale ? 'true' : undefined}>
            <span className={styles.dot} aria-hidden="true" />
            {freshness}
          </span>
        )}
      </div>
      {rows.main.length > 0 && (
        <ul className={styles.list} aria-busy={busy}>
          {rows.main.map(row)}
        </ul>
      )}
      {rows.more.length > 0 && (
        <details className={styles.more}>
          <summary>All points ({rows.more.length})</summary>
          <ul className={styles.list} aria-busy={busy}>
            {rows.more.map(row)}
          </ul>
        </details>
      )}
      {state === 'loading' && (
        // Outside the busy lists, so it is announced; the skeletons are what is seen.
        <p role="status" className={styles.hidden}>
          Loading readings…
        </p>
      )}
      {state === 'rateLimited' && <RateLimited className={styles.rateLimited} />}
      {state === 'failed' && history !== undefined && (
        <LoadFailed
          error={history.error}
          fallback="Readings could not be loaded."
          isFetching={history.fetching}
          onRetry={history.refetch}
          className={styles.state}
        />
      )}
      {state === 'noHistory' && (
        <EmptyState className={styles.state}>No history for this asset.</EmptyState>
      )}
      {state === 'empty' && (
        <EmptyState className={styles.state}>No readings in this range.</EmptyState>
      )}
      {stale && !ended && (
        <Hint icon={Clock}>Charts stop at the last reading; the gap is the outage.</Hint>
      )}
    </section>
  );
}

function ReadingRow({
  assetCode,
  row,
  entry,
  serverNow,
  stale,
  ended,
  history,
  past,
  loading,
}: {
  assetCode: string;
  row: InspectorRow;
  entry: AssetTelemetryState | undefined;
  serverNow: number | null;
  stale: boolean;
  ended: boolean;
  history: ReadingSeries | undefined;
  past: boolean;
  /** The past range is still being read: a skeleton holds the chart's place. */
  loading: boolean;
}) {
  const { point, rule } = row;
  // Reads only its own key's series: a stored reference that changes when this key is re-posted.
  // Still subscribed in a past range (a hook is not called conditionally), and not drawn there.
  const series = useAssetSeries(assetCode, point.key);
  // The freshest copy wins, as the list's row value: frames are laid over the overview's headline.
  const value: TelemetryValue | undefined = entry?.values[point.key] ?? entry?.headline[point.key];
  const latest = encodedLatest(point, value);
  // A number and a boolean have a series; an enum has none (the engine has no `enumValues`), and
  // a kind from a newer API is shown as its value only.
  // An ended watch has no live series to draw, and `drawnSeries` would add a live-looking point to
  // none; a past range is read from the database, so it is drawn whatever the watch.
  const drawable = (past || !ended) && (point.kind === 'number' || point.kind === 'boolean');
  const live = !stale && serverNow !== null;
  // A key with no number in the range has no column and draws nothing: no gap is invented.
  const column = history?.byKey.get(point.key);
  const drawn = useMemo(() => {
    if (!drawable) return null;
    if (past) return column === undefined ? null : { times: column.t, values: column.v };
    return value !== undefined && serverNow !== null
      ? drawnSeries(series, latest, serverNow, live)
      : null;
  }, [drawable, past, column, value, serverNow, series, latest, live]);
  // The window drawn: the buckets' own for a past range, the last 15 minutes up to now otherwise.
  const shown = past
    ? (history?.window ?? null)
    : serverNow === null
      ? null
      : { from: serverNow - SPARKLINE_WINDOW_MS, to: serverNow };
  // The range has readings, only none for this point: the row says so in words, not with a blank cell. A range with
  // none at all says it once for the section instead.
  const missing =
    drawable && past && column === undefined && history?.status === 'ready' && !history.empty;
  const over = overSeverity(rule, latest);
  const ruleLine = rule === null ? null : limitLine(rule, point);

  return (
    <li
      className={styles.row}
      data-stale={stale || ended ? 'true' : undefined}
      data-severity={over}
    >
      <span className={styles.label}>
        <span className={styles.name}>{point.label}</span>
        {ruleLine !== null && <span className={styles.rule}>{ruleLine}</span>}
      </span>
      <span className={styles.chart}>
        {loading && drawable && <Skeleton className={styles.chartSkeleton} />}
        {missing && <span className={styles.noReadings}>No readings</span>}
        {drawn !== null && shown !== null && (
          <Sparkline
            times={drawn.times}
            values={drawn.values}
            from={shown.from}
            to={shown.to}
            marker={past ? (history?.markerAt ?? null) : undefined}
            // A boolean rule's 0.5 is an encoding, not a limit an operator reads (V2-09.1).
            limit={point.kind === 'number' && rule !== null ? rule.limit : null}
            range={point.kind === 'boolean' ? BOOLEAN_RANGE : { min: point.min, max: point.max }}
            step={point.kind === 'boolean'}
            stale={stale}
            over={over}
          />
        )}
      </span>
      <span className={styles.value}>
        {value === undefined ? '—' : formatReading(point, value)}
        {over !== undefined && <span className={styles.hidden}>, over its limit</span>}
      </span>
    </li>
  );
}
