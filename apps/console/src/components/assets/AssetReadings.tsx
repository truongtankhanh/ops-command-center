import type { TelemetryValue } from '@occ/contracts';
import { useMemo } from 'react';
import {
  drawnSeries,
  encodedLatest,
  freshnessText,
  type InspectorRow,
  type InspectorRows,
  overSeverity,
  SPARKLINE_WINDOW_MS,
} from '../lib/assets/assetInspector';
import { formatReading, limitLine } from '../lib/assets/readings';
import { ageMs as readingAgeMs } from '../lib/telemetry/telemetryFreshness';
import type { AssetTelemetryState } from '../lib/telemetry/telemetryState';
import { useAssetSeries } from '../realtime/telemetryStore';
import { Hint } from '../ui/Hint';
import { Clock } from '../ui/icons';
import { Sparkline } from '../ui/Sparkline';
import styles from './AssetReadings.module.css';

const BOOLEAN_RANGE = { min: 0, max: 1 } as const;

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
 * `serverNow` is read once by the caller and passed down. The freshness text sits outside any live
 * region, so it does not announce every second.
 */
export function AssetReadings({
  assetCode,
  rows,
  entry,
  serverNow,
  stale,
}: {
  assetCode: string;
  rows: InspectorRows;
  /** `undefined` while nothing was received for the asset. */
  entry: AssetTelemetryState | undefined;
  /** The API's time now; `null` until the first overview. */
  serverNow: number | null;
  stale: boolean;
}) {
  const age =
    entry !== undefined && serverNow !== null ? readingAgeMs(entry.receivedAt, serverNow) : null;
  const freshness = freshnessText(age, stale);
  const row = (item: InspectorRow) => (
    <ReadingRow
      key={item.point.key}
      assetCode={assetCode}
      row={item}
      entry={entry}
      serverNow={serverNow}
      stale={stale}
    />
  );

  return (
    <section className={styles.section} aria-labelledby="asset-readings-title">
      <div className={styles.head}>
        <h3 id="asset-readings-title">{stale ? 'Last readings' : 'Live readings'}</h3>
        {freshness !== null && (
          <span className={styles.freshness} data-stale={stale ? 'true' : undefined}>
            <span className={styles.dot} aria-hidden="true" />
            {freshness}
          </span>
        )}
      </div>
      {rows.main.length > 0 && <ul className={styles.list}>{rows.main.map(row)}</ul>}
      {rows.more.length > 0 && (
        <details className={styles.more}>
          <summary>All points ({rows.more.length})</summary>
          <ul className={styles.list}>{rows.more.map(row)}</ul>
        </details>
      )}
      {stale && <Hint icon={Clock}>Charts stop at the last reading; the gap is the outage.</Hint>}
    </section>
  );
}

function ReadingRow({
  assetCode,
  row,
  entry,
  serverNow,
  stale,
}: {
  assetCode: string;
  row: InspectorRow;
  entry: AssetTelemetryState | undefined;
  serverNow: number | null;
  stale: boolean;
}) {
  const { point, rule } = row;
  // Reads only its own key's series: a stored reference that changes when this key is re-posted.
  const series = useAssetSeries(assetCode, point.key);
  // The freshest copy wins, as the list's row value: frames are laid over the overview's headline.
  const value: TelemetryValue | undefined = entry?.values[point.key] ?? entry?.headline[point.key];
  const latest = encodedLatest(point, value);
  // A number and a boolean have a series; an enum has none (the engine has no `enumValues`), and
  // a kind from a newer API is shown as its value only.
  const drawable = point.kind === 'number' || point.kind === 'boolean';
  const live = !stale && serverNow !== null;
  const drawn = useMemo(
    () =>
      drawable && value !== undefined && serverNow !== null
        ? drawnSeries(series, latest, serverNow, live)
        : null,
    [drawable, value, serverNow, series, latest, live],
  );
  const over = overSeverity(rule, latest);
  const ruleLine = rule === null ? null : limitLine(rule, point);

  return (
    <li className={styles.row} data-stale={stale ? 'true' : undefined} data-severity={over}>
      <span className={styles.label}>
        <span className={styles.name}>{point.label}</span>
        {ruleLine !== null && <span className={styles.rule}>{ruleLine}</span>}
      </span>
      <span className={styles.chart}>
        {drawn !== null && serverNow !== null && (
          <Sparkline
            times={drawn.times}
            values={drawn.values}
            from={serverNow - SPARKLINE_WINDOW_MS}
            to={serverNow}
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
