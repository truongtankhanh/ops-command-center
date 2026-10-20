import type { Asset } from '@occ/contracts';
import { useId } from 'react';
import { useAssets, useZones } from '../api/queries';
import { hasDimmedAsset } from '../lib/assets';
import { buildingLine, isolationLine } from '../lib/twinLevel';
import { useLegendOpen } from '../lib/useLegendOpen';
import { useServerNow, useTelemetryStore } from '../realtime/telemetryStore';
import { useConsole } from '../store';
import { Icon } from '../ui/Icon';
import { Box, cameraIcon, ChevronDown } from '../ui/icons';
import { Kbd } from '../ui/Kbd';
import styles from './TwinLegend.module.css';
import { useIsolation } from './useIsolation';

const NO_ASSETS: Asset[] = [];

/**
 * The 3D stage's legend (V2-12.10, frame 01 `.tw-legend`), bottom-left, in the 2D legend's look and with its
 * toggle: the same open or closed preference (`useLegendOpen`), so a legend closed in one view is closed in
 * the other. Status is shape (a filled disc is open, a ring is being handled), not colour, so the swatches
 * are neutral; the camera entry is the camera glyph.
 *
 * It names what the stage will show: the incident markers arrive with V2-16 and the asset hover with V2-15.
 * The 3D view stays behind the preview gate until both are in (V2-19.8).
 *
 * "No data — last known state, not live" (frame 05 `.lg-stale`) is listed only while some asset is drawn that
 * way (V2-14.9): it has no data, its device is offline, or its latest reading is stale. That is the scene's
 * own rule (`hasDimmedAsset`), not the Assets list's state word, so a stale fault, which the list calls a
 * fault but the scene draws grey, counts. The swatch is a hatched diamond, a shape: the grey and the dash
 * are not the only cue.
 *
 * While an asset is isolated (V2-15.7) the legend is one line instead, as frames 03 and 17 draw it: the rest of
 * the campus is faded, and `Esc` returns to the building (or the campus, for an asset in none). The entries are
 * about a campus that is not on screen then, so they and their toggle go; the open or closed preference is kept.
 * The words are ADR-0020's ("Settled in V2-15.1"). `Esc` closes the inspector from the sheet, and in the scene
 * while the 3D view has focus (V2-18.3, `twin/TwinView.tsx`); the breadcrumb's back button does the same step.
 *
 * At building level, a building in focus and no asset isolated (V2-15.8), it is one line too, frame 12's: the walls
 * are see-through, the other buildings are faded, and `Esc` returns to the campus. At asset level inside a building
 * the isolation line above is the one shown, as frames 03 and 17 draw it; frame 15 draws the building line there, a
 * "Frames to revise" row of the brief.
 */
export function TwinLegend() {
  const entriesId = useId();
  const [open, toggle] = useLegendOpen();
  const assets = useAssets();
  const overview = useTelemetryStore((state) => state.view.state.assets);
  const serverNow = useServerNow();
  const dimmed = hasDimmedAsset(assets.data ?? NO_ASSETS, overview, serverNow);
  const isolation = useIsolation();
  const focusZoneId = useConsole((state) => state.focusZoneId);

  if (isolation !== null) return <IsolationLine zoneId={isolation.zoneId} />;
  if (focusZoneId !== null) return <BuildingLine />;

  return (
    <div className={styles.legend}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={entriesId}
        onClick={toggle}
      >
        Legend
        <Icon glyph={ChevronDown} size={16} className={styles.chevron} />
      </button>
      <ul id={entriesId} className={styles.entries} hidden={!open}>
        <li>
          <span className={`${styles.swatch} ${styles.open}`} aria-hidden />
          Open
        </li>
        <li>
          <span className={`${styles.swatch} ${styles.handled}`} aria-hidden />
          Being handled
        </li>
        <li>
          <Icon glyph={cameraIcon(true)} size={16} />
          Camera
        </li>
        <li>
          <span className={styles.asset} aria-hidden />
          Asset — hover for readings
        </li>
        {dimmed && (
          <li>
            <span className={styles.stale} aria-hidden />
            No data — last known state, not live
          </li>
        )}
      </ul>
    </div>
  );
}

/**
 * The legend while an asset is isolated: one line. A component of its own, so the zones are asked for only while
 * it shows. Where Escape goes back to is the building the asset is in, `Campus` when it is in none, and nothing
 * is said while that building is not known yet (reference data on its way) rather than a wrong name.
 */
function IsolationLine({ zoneId }: { zoneId: string | null }) {
  const zones = useZones();
  const parent =
    zoneId === null ? 'Campus' : (zones.data?.find((zone) => zone.id === zoneId)?.name ?? null);
  const { lead, back } = isolationLine(parent);
  return <LegendLine lead={lead} back={back} />;
}

/** The legend at building level (V2-15.8): the walls are see-through, and `Esc` returns to the campus. */
function BuildingLine() {
  const { lead, back } = buildingLine();
  return <LegendLine lead={lead} back={back} />;
}

/** One sentence, then `Esc` in a key and where it goes back to; `back` is `null` while that is not known. */
function LegendLine({ lead, back }: { lead: string; back: string | null }) {
  return (
    <div className={styles.legend}>
      <Icon glyph={Box} size={16} />
      <span className={styles.line}>
        {lead}
        {back !== null && (
          <>
            {' '}
            <Kbd decorative={false}>Esc</Kbd> {back}
          </>
        )}
      </span>
    </div>
  );
}
