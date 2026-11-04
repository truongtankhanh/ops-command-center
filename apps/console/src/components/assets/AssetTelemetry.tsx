import type { AssetDetail } from '@occ/contracts';
import { useMemo, useState } from 'react';
import { inspectorRows, readingIsStale } from '../../lib/assets/assetInspector';
import {
  rangeCaption,
  rangeOffered,
  READING_RANGES,
  type ReadingRange,
} from '../../lib/telemetry/readingRange';
import { staleAfterMs } from '../../lib/telemetry/telemetryFreshness';
import { useReadingSeries } from '../../lib/telemetry/useReadingSeries';
import { useAssetState, useServerNow } from '../../realtime/telemetryStore';
import { RangeSwitch } from '../telemetry/RangeSwitch';
import { AssetReadings } from './AssetReadings';
import styles from './AssetTelemetry.module.css';

/** An asset offers 15 min and 1 h: Around the alarm needs an incident's raised time. */
const ASSET_RANGES = READING_RANGES.filter((option) => rangeOffered(option.id, { kind: 'asset' }));

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
 * readings are live or stale, never "over". Reading only, identical for every role.
 *
 * The range switch (V3-23.3, frame 18) offers 15 min and 1 h. The choice is this tab's own state: it
 * starts on 15 min and is not remembered, so a new asset (the sheet is keyed by its code) and a
 * return to the tab start there again. 1 h reads the history route once for the asset
 * (`useReadingSeries`, cached 30 s), however many rows draw; the line under the switch says which
 * window is drawn.
 */
export function AssetTelemetry({ detail }: { detail: AssetDetail }) {
  const entry = useAssetState(detail.code);
  const serverNow = useServerNow();
  const [range, setRange] = useState<ReadingRange>('15m');
  const history = useReadingSeries(detail.code, range, serverNow);
  const stale =
    entry !== undefined && readingIsStale(entry, staleAfterMs(detail.headline), serverNow);
  const rows = useMemo(() => inspectorRows(detail.points, detail.rules), [detail]);
  const caption = rangeCaption(range, history.window, history.markerAt);

  return (
    <>
      <div className={styles.range}>
        <RangeSwitch options={ASSET_RANGES} value={range} onChange={setRange} />
        {caption !== null && <p className={styles.window}>{caption}</p>}
      </div>
      <AssetReadings
        assetCode={detail.code}
        rows={rows}
        entry={entry}
        serverNow={serverNow}
        stale={stale}
        range={range}
        history={history}
      />
    </>
  );
}
