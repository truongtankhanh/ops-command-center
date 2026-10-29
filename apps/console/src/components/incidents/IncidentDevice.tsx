import type { AssetDetail, Incident, IncidentDetail as Detail } from '@occ/contracts';
import { useMemo } from 'react';
import { useAsset, useAssets, useIncidents, useZones } from '../../api/queries';
import { inspectorRows, readingIsStale } from '../../lib/assets/assetInspector';
import { assetStates, openIncidentOf } from '../../lib/assets/assets';
import { deviceInfoRows } from '../../lib/assets/deviceInfo';
import { isActive } from '../../lib/incidents/incidents';
import { staleAfterMs } from '../../lib/telemetry/telemetryFreshness';
import { useAssetState, useServerNow } from '../../realtime/telemetryStore';
import { Skeleton } from '../../ui/Skeleton';
import { DeviceCard } from '../assets/DeviceCard';
import { LiveTiles } from '../assets/LiveTiles';
import styles from './IncidentDevice.module.css';

/**
 * The device behind a telemetry incident, in the sheet's Details tab (V3-09.4; frames 02 and 04):
 * its information card and, while the incident is open, its live data tiles. Mounted by the sheet
 * only for an incident a telemetry rule raised on an asset (`source === 'telemetry'` and
 * `assetId`), so an operator's incident asks for no asset and draws nothing for one.
 *
 * It follows the evidence block's rules. The catalogue turns the asset id into a code and the
 * asset's detail comes from the same queries `IncidentEvidence` and the camera section make, so it
 * adds no request. While either is on its way the place is a skeleton; if the catalogue lacks the
 * asset or its detail cannot be read, **nothing is drawn**: the evidence already says "Rule details
 * could not be loaded", and an empty placeholder here would be a second way to say it.
 *
 * **Tiles are drawn only while the incident is active.** The console watches the asset's readings
 * only then (`incidentWatchCode`); after that there is no series and "Live data" over whatever the
 * overview left in the store would read as live. A resolved incident ends at the card and the
 * evidence's "Raised at …".
 */
export function IncidentDevice({ incident }: { incident: Detail }) {
  const { data: assets, isPending: cataloguePending } = useAssets();
  const asset = assets?.find((candidate) => candidate.id === incident.assetId);
  // Disabled without a code, so a missing asset never asks for one (a disabled query is `pending`).
  const { data: detail, isPending: detailPending } = useAsset(asset?.code ?? null);

  if (cataloguePending || (asset !== undefined && detailPending)) return <DeviceSkeleton />;
  if (detail === undefined) return null;
  return <DeviceBody incident={incident} detail={detail} />;
}

/**
 * The live half: it alone reads the telemetry store and the server clock, so the per-second render
 * stays in this block and does not reach the facts, the timeline or the cameras around it (the
 * reason `LiveEvidence` is a block of its own). It computes what the asset inspector computes for
 * the same asset, so the pill and the inspector never disagree, and passes plain data down.
 */
function DeviceBody({ incident, detail }: { incident: Detail; detail: AssetDetail }) {
  const { data: zones } = useZones();
  const { data: incidents } = useIncidents();
  const entry = useAssetState(detail.code);
  const serverNow = useServerNow();
  const zone = zones?.find((candidate) => candidate.id === detail.zoneId);

  // The sheet's incident is the reason for the fault, and the list may not hold it yet (it loads on
  // its own): count it, so the card never says "Running" for a device whose incident is on screen.
  const known = useMemo(() => withIncident(incidents, incident), [incidents, incident]);
  const state = useMemo(
    () =>
      assetStates(
        [detail],
        known,
        entry === undefined ? {} : { [detail.code]: entry },
        serverNow,
      ).get(detail.code) ?? 'unknown',
    [detail, known, entry, serverNow],
  );
  // A fault keeps its incident's severity glyph (the card cannot work it out).
  const severity = state === 'fault' ? openIncidentOf(detail, known)?.severity : undefined;
  const stale =
    entry !== undefined && readingIsStale(entry, staleAfterMs(detail.headline), serverNow);
  // Stable `row` objects: a tile is `memo` and compares them.
  const rows = useMemo(() => inspectorRows(detail.points, detail.rules).main, [detail]);
  const info = useMemo(
    () => deviceInfoRows(detail, zone, state, entry),
    [detail, zone, state, entry],
  );

  return (
    <>
      <DeviceCard rows={info} severity={severity} />
      {isActive(incident) && (
        <LiveTiles
          assetCode={detail.code}
          rows={rows}
          entry={entry}
          serverNow={serverNow}
          stale={stale}
        />
      )}
    </>
  );
}

/** The incident list with the sheet's incident in it, as the list will have it once it loads. */
function withIncident(
  list: readonly Incident[] | undefined,
  incident: Incident,
): readonly Incident[] {
  const known = list ?? [];
  return known.some((candidate) => candidate.id === incident.id) ? known : [...known, incident];
}

/** Laid out like the loaded card, so nothing jumps when the asset arrives. */
function DeviceSkeleton() {
  return (
    <div className={styles.skeleton} aria-busy="true">
      <p role="status" className={styles.hidden}>
        Loading device…
      </p>
      <Skeleton className={styles.skeletonCard} />
    </div>
  );
}
