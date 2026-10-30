import type { AssetDetail, Incident } from '@occ/contracts';
import { useMemo } from 'react';
import { inspectorRows, readingIsStale } from '../../lib/assets/assetInspector';
import { isActive } from '../../lib/incidents/incidents';
import type { TelemetryTabState } from '../../lib/incidents/useIncidentTelemetry';
import { staleAfterMs } from '../../lib/telemetry/telemetryFreshness';
import { useAssetState, useServerNow } from '../../realtime/telemetryStore';
import { Skeleton } from '../../ui/Skeleton';
import { AssetReadings } from '../assets/AssetReadings';
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
 * while the reading is over its limit, and the value says so in words. V3-23.3 adds the range
 * switch to this tab.
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
  return <ReadingsBlock detail={state.detail} ended={!isActive(incident)} />;
}

/**
 * The live half: it alone reads the telemetry store and the server clock, so the per-second render
 * stays in this panel and does not reach the header, the tab list or the other tabs (the reason
 * `DeviceBody` and `LiveEvidence` are blocks of their own). It computes what the asset inspector
 * computes for the same asset, so the two never disagree.
 */
function ReadingsBlock({ detail, ended }: { detail: AssetDetail; ended: boolean }) {
  const entry = useAssetState(detail.code);
  // An ended watch has nothing to age, so the clock is not followed (no render a second).
  const serverNow = useServerNow(!ended);
  const stale =
    entry !== undefined && readingIsStale(entry, staleAfterMs(detail.headline), serverNow);
  // Stable `rows`, and no "All points" disclosure: `more` is left empty.
  const rows = useMemo(
    () => ({ main: inspectorRows(detail.points, detail.rules).main, more: [] }),
    [detail],
  );

  return (
    <AssetReadings
      assetCode={detail.code}
      rows={rows}
      entry={entry}
      serverNow={serverNow}
      stale={stale}
      ended={ended}
    />
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
