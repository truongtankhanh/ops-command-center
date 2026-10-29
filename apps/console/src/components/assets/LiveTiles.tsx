import type { TelemetryPoint, TelemetryValue } from '@occ/contracts';
import { memo, useMemo } from 'react';
import {
  drawnSeries,
  encodedLatest,
  freshnessText,
  type InspectorRow,
  overSeverity,
  SPARKLINE_WINDOW_MS,
} from '../../lib/assets/assetInspector';
import { type ReadingDelta, readingDelta } from '../../lib/assets/readingDelta';
import { formatDelta, formatReading, readingParts } from '../../lib/assets/readings';
import { ageMs as readingAgeMs } from '../../lib/telemetry/telemetryFreshness';
import type { AssetTelemetryState } from '../../lib/telemetry/telemetryState';
import { useAssetSeries } from '../../realtime/telemetryStore';
import { Hint } from '../../ui/Hint';
import { Icon } from '../../ui/Icon';
import { ArrowDown, ArrowUp, Clock, Minus } from '../../ui/icons';
import { SheetSection } from '../../ui/SheetSection';
import { Sparkline } from '../../ui/Sparkline';
import styles from './LiveTiles.module.css';

const BOOLEAN_RANGE = { min: 0, max: 1 } as const;

/** The span a delta is read over, from the window the chart draws: "15 min" and "15 minutes". */
const WINDOW_MINUTES = Math.round(SPARKLINE_WINDOW_MS / 60_000);

/**
 * The live data tiles of an inspector's Details tab (V3-09.3; frames 02 and 04): one tile per point
 * it is given (the headline points and the points a rule watches, `inspectorRows(...).main`), each
 * with its value, how far it moved over the last 15 minutes and a sparkline of them.
 *
 * It takes what `AssetReadings` takes, so a content passes what it already holds. Whether the asset
 * is live is the caller's single fact (`stale`): when it is not, the eyebrow reads "Last readings",
 * every tile is dimmed with no delta, the charts stop at the last reading and say why. No per-tile
 * age is drawn: the API sends changed keys only, so a steady key's age would read "old" on a
 * healthy device (V2-08.3); one freshness line says it for all of them.
 *
 * `serverNow` is read once by the caller and passed down. The freshness text sits outside any live
 * region, so it does not announce every second. Read-only and identical for every role. The full
 * list of points ("All points") stays with `AssetReadings` (V3-09.8).
 */
export function LiveTiles({
  assetCode,
  rows,
  entry,
  serverNow,
  stale,
}: {
  assetCode: string;
  rows: readonly InspectorRow[];
  /** `undefined` while nothing was received for the asset. */
  entry: AssetTelemetryState | undefined;
  /** The API's time now; `null` until the first overview. */
  serverNow: number | null;
  stale: boolean;
}) {
  if (rows.length === 0) return null;

  const age =
    entry !== undefined && serverNow !== null ? readingAgeMs(entry.receivedAt, serverNow) : null;
  const freshness = freshnessText(age, stale);

  return (
    <SheetSection
      title={stale ? 'Last readings' : 'Live data'}
      aside={
        freshness !== null && (
          <span className={styles.freshness} data-stale={stale ? 'true' : undefined}>
            <span className={styles.dot} aria-hidden="true" />
            {freshness}
          </span>
        )
      }
    >
      <ul className={styles.list}>
        {rows.map((row) => (
          <li key={row.point.key}>
            <LiveTile
              assetCode={assetCode}
              row={row}
              // The freshest copy wins, as the list's row value: frames are laid over the overview's headline.
              value={entry?.values[row.point.key] ?? entry?.headline[row.point.key]}
              serverNow={serverNow}
              stale={stale}
            />
          </li>
        ))}
      </ul>
      {stale && <Hint icon={Clock}>Charts stop at the last reading; the gap is the outage.</Hint>}
    </SheetSection>
  );
}

/**
 * One tile.
 *
 * `memo` is what makes a tile re-render for its own key and the clock only: the parent re-renders
 * for any key of the asset (it reads the whole entry), but every prop here is a primitive or a
 * reference the caller keeps (`row` from `inspectorRows`, memoised there), and the series is read
 * from the store by this key alone. A tile whose value did not change does not commit when another
 * key's reading arrives (the clock, which moves the chart's window, is the one thing every tile
 * follows). Same reason as `AssetRow`, and the same exception to "memoise where measured": the
 * acceptance criterion asks for it.
 */
const LiveTile = memo(function LiveTile({
  assetCode,
  row,
  value,
  serverNow,
  stale,
}: {
  assetCode: string;
  row: InspectorRow;
  /** `undefined` when the asset has no reading for this point yet. */
  value: TelemetryValue | undefined;
  serverNow: number | null;
  stale: boolean;
}) {
  const { point, rule } = row;
  // Reads only its own key's series: a stored reference that changes when this key is re-posted.
  const series = useAssetSeries(assetCode, point.key);
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
  // A stale asset has no change to report: its last reading is not "now" (V2 frame 05).
  const delta = useMemo(
    () => (stale ? null : readingDelta(point, series, latest, serverNow)),
    [stale, point, series, latest, serverNow],
  );
  const over = overSeverity(rule, latest);
  const parts = value === undefined ? null : readingParts(point, value);

  return (
    <div className={styles.tile} data-stale={stale ? 'true' : undefined} data-severity={over}>
      <span className={styles.label}>{point.label}</span>
      <span className={styles.value}>
        {parts === null ? (
          '—'
        ) : (
          <>
            {parts.text}
            {parts.unit !== null && (
              <>
                {' '}
                <small className={styles.unit}>{parts.unit}</small>
              </>
            )}
          </>
        )}
        {over !== undefined && <span className={styles.hidden}>, over its limit</span>}
      </span>
      <Delta point={point} delta={delta} />
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
    </div>
  );
});

/**
 * The change over the window, as a glyph and words. What is drawn is `aria-hidden` and the same
 * fact is written out in full for assistive technology ("Up 3.2 ppm over the last 15 minutes"), so
 * the glyph and the colour are never the only carrier. The tone is neutral on purpose: a rise is
 * not a severity, and the only severity hue on a tile is the over-limit one (brief Principle 3).
 */
function Delta({
  point,
  delta,
}: {
  point: Pick<TelemetryPoint, 'key' | 'kind' | 'unit'>;
  delta: ReadingDelta | null;
}) {
  if (delta === null) {
    return (
      <span className={styles.delta} data-direction="none">
        <span aria-hidden="true">—</span>
        <span className={styles.hidden}>No change shown</span>
      </span>
    );
  }
  if (delta.direction === 'flat') {
    return (
      <span className={styles.delta} data-direction="flat">
        <Icon glyph={Minus} size={14} />
        <span aria-hidden="true">Steady</span>
        <span className={styles.hidden}>{`Steady over the last ${WINDOW_MINUTES} minutes`}</span>
      </span>
    );
  }
  const up = delta.direction === 'up';
  return (
    <span className={styles.delta} data-direction={delta.direction}>
      <Icon glyph={up ? ArrowUp : ArrowDown} size={14} />
      <span aria-hidden="true">{`${formatDelta(delta.amount)} / ${WINDOW_MINUTES} min`}</span>
      <span className={styles.hidden}>
        {`${up ? 'Up' : 'Down'} ${formatReading(point, Math.abs(delta.amount))} over the last ${WINDOW_MINUTES} minutes`}
      </span>
    </span>
  );
}
