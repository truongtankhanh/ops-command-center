import type { AssetDetail, Incident } from '@occ/contracts';
import { useMemo, useState } from 'react';
import { inspectorRows, readingIsStale } from '../../lib/assets/assetInspector';
import { isActive } from '../../lib/incidents/incidents';
import type { TelemetryTabState } from '../../lib/incidents/useIncidentTelemetry';
import {
  rangeCaption,
  rangeOffered,
  READING_RANGES,
  type ReadingRange,
} from '../../lib/telemetry/readingRange';
import { staleAfterMs } from '../../lib/telemetry/telemetryFreshness';
import { useReadingSeries } from '../../lib/telemetry/useReadingSeries';
import { useAssetState, useServerNow } from '../../realtime/telemetryStore';
import { Skeleton } from '../../ui/Skeleton';
import { AssetReadings } from '../assets/AssetReadings';
import { RangeSwitch } from '../telemetry/RangeSwitch';
import styles from './IncidentTelemetry.module.css';

/**
 * The Telemetry tab of a telemetry incident (V3-09.6; frame 03b): its asset's headline points and
 * the points a rule watches, each with its rule line and a 15-minute sparkline, drawn by the asset
 * inspector's own `AssetReadings`, so the stale gap, the rule line and the over-limit severity are
 * the ones the operator already knows. The full list ("All points") is the asset inspector's.
 *
 * The sheet offers the tab only when `useIncidentTelemetry` has an asset to show, so `none` here is
 * a guard and draws nothing. An asset the catalogue lacks or the API cannot read has no tab and no
 * error: Details' evidence already says it, and "Raised at …" lives there too.
 *
 * Reading only, identical for every role. The watch is not set here: `TelemetryWatchSet` follows
 * the open incident whatever tab is open, so the rings are already filling and seeded on opening.
 * It stops when the incident is resolved, which drops the series: such an incident reads "Last
 * readings" with the values the store still holds and no chart (`AssetReadings` `ended`), and does
 * not start the clock.
 *
 * Not built here, on purpose: a second hue for a series (`Sparkline` `tone="secondary"`) and the
 * severity-coloured end marker on the part of a line that broke a rule (it needs the per-point rule
 * result and a change to `Sparkline`'s geometry). Today the whole line takes the rule's severity
 * while the reading is over its limit, and the value says so in words.
 *
 * The range switch (V3-23.3, frame 18) offers 15 min, 1 h and Around the alarm: ten minutes before
 * the incident was raised to five after, with the raise marked, so an operator can read the alarm
 * back. The choice is the tab's own state, starts on 15 min and is not remembered (a new incident
 * keys a new sheet; a return to the tab starts again). A past range reads the history route once
 * for the asset, and it is read from the database, not from the watch, so a resolved incident draws
 * it too and follows the clock while it does.
 */
export function IncidentTelemetry({
  incident,
  state,
}: {
  incident: Incident;
  state: TelemetryTabState;
}) {
  if (state.status === 'none') return null;
  if (state.status === 'loading') return <TelemetrySkeleton />;
  return <ReadingsBlock detail={state.detail} incident={incident} ended={!isActive(incident)} />;
}

/**
 * The live half: it alone reads the telemetry store and the server clock, so the per-second render
 * stays in this panel and does not reach the header, the tab list or the other tabs (the reason
 * `DeviceBody` and `LiveEvidence` are blocks of their own). It computes what the asset inspector
 * computes for the same asset, so the two never disagree.
 */
function ReadingsBlock({
  detail,
  incident,
  ended,
}: {
  detail: AssetDetail;
  incident: Incident;
  ended: boolean;
}) {
  const entry = useAssetState(detail.code);
  const [range, setRange] = useState<ReadingRange>('15m');
  // An ended watch has nothing to age, so the clock is not followed (no render a second), unless a
  // past range is asked for: its window is cut at the server's now.
  const serverNow = useServerNow(!ended || range !== '15m');
  const history = useReadingSeries(detail.code, range, serverNow, incident.reportedAt);
  const { assetId, reportedAt } = incident;
  // The tab re-renders every second; the options change only with the incident's own fields.
  const options = useMemo(
    () =>
      READING_RANGES.filter((option) =>
        rangeOffered(option.id, { kind: 'incident', assetId, reportedAt }),
      ),
    [assetId, reportedAt],
  );
  const stale =
    entry !== undefined && readingIsStale(entry, staleAfterMs(detail.headline), serverNow);
  // Stable `rows`, and no "All points" disclosure: `more` is left empty.
  const rows = useMemo(
    () => ({ main: inspectorRows(detail.points, detail.rules).main, more: [] }),
    [detail],
  );

  const caption = rangeCaption(range, history.window, history.markerAt);

  return (
    <>
      <div className={styles.range}>
        <RangeSwitch options={options} value={range} onChange={setRange} />
        {caption !== null && <p className={styles.window}>{caption}</p>}
      </div>
      <AssetReadings
        assetCode={detail.code}
        rows={rows}
        entry={entry}
        serverNow={serverNow}
        stale={stale}
        ended={ended}
        range={range}
        history={history}
      />
    </>
  );
}

/** Laid out like the loaded section, so nothing jumps when the asset arrives. */
function TelemetrySkeleton() {
  return (
    <div className={styles.skeleton} aria-busy="true">
      <p role="status" className={styles.hidden}>
        Loading readings…
      </p>
      <Skeleton className={styles.skeletonRow} />
      <Skeleton className={styles.skeletonRow} />
      <Skeleton className={styles.skeletonRow} />
    </div>
  );
}
