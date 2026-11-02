import type { AssetDetail } from '@occ/contracts';
import { useMemo } from 'react';
import { inspectorRows, readingIsStale } from '../../lib/assets/assetInspector';
import { staleAfterMs } from '../../lib/telemetry/telemetryFreshness';
import { useAssetState, useServerNow } from '../../realtime/telemetryStore';
import { AssetReadings } from './AssetReadings';

/**
 * The asset sheet's Telemetry tab (V3-09.8; frame 04): every point of the asset with its rule line
 * and a 15-minute sparkline, the headline and ruled points first and the rest behind "All points
 * (n)", drawn by the unchanged `AssetReadings`. The headline and ruled points are also the tiles on
 * Details; this tab is where the whole list lives, and since `Tabs` mounts one tab at a time the two
 * never put a "Live readings" region and a "Last readings" one on screen together.
 *
 * It is a component of its own so that it alone reads the telemetry store and the server clock: the
 * per-second render stays in this panel and does not reach the header, the tab list or the other
 * tabs (the reason `IncidentTelemetry` has its `ReadingsBlock`). It computes `stale` the way Details
 * does for the same asset, so the two never disagree.
 *
 * Nothing here sets the watch: `TelemetryWatchSet` follows the selected asset whatever tab is open,
 * so the rings are already filling and seeded on opening. `ended` is not passed: an asset's
 * readings are live or stale, never "over". Reading only, identical for every role. Not built here:
 * the range switch (V3-23.3).
 */
export function AssetTelemetry({ detail }: { detail: AssetDetail }) {
  const entry = useAssetState(detail.code);
  const serverNow = useServerNow();
  const stale =
    entry !== undefined && readingIsStale(entry, staleAfterMs(detail.headline), serverNow);
  const rows = useMemo(() => inspectorRows(detail.points, detail.rules), [detail]);

  return (
    <AssetReadings
      assetCode={detail.code}
      rows={rows}
      entry={entry}
      serverNow={serverNow}
      stale={stale}
    />
  );
}
