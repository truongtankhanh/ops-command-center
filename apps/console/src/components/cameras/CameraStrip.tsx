import { type CSSProperties, useId, useState } from 'react';
import { isRateLimited } from '../../api/client';
import { useAssets, useCameras, useIncidents } from '../../api/queries';
import {
  CAMERA_FILTERS,
  type CameraFilter,
  countCameras,
  filterCameras,
} from '../../lib/cameras/cameraFilter';
import { cameraLink, stripCameras, stripSize, stripSubject } from '../../lib/cameras/cameras';
import { useDisplayMode } from '../../lib/shell/useDisplayMode';
import { useConsole } from '../../store';
import text from '../../styles/text.module.css';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { ChevronDown, LayoutGrid } from '../../ui/icons';
import { Skeleton } from '../../ui/Skeleton';
import { Tabs } from '../../ui/Tabs';
import { CameraGrid } from './CameraGrid';
import styles from './CameraStrip.module.css';
import { CameraTile } from './CameraTile';
import { LoadFailed, RateLimited } from '../shell/LoadStates';

/**
 * A header row over one row of tiles — four, six on a wall, eight on a 4K wall (`stripSize`): pinned
 * cameras first, then the selected incident's zone or the selected asset's cameras, then the rest
 * of the campus. For an asset the cameras that see it come before those in its zone, and each tile
 * says which it is ("On this asset", "In zone", frames 02 / 03); for an incident only its zone
 * counts. While the camera list loads, placeholder tiles hold the strip's height; if it cannot be
 * loaded, the strip says so with a Retry.
 *
 * The header (frame 13) has the title and the camera count, the All / Live / Offline filter with
 * counts, and the button that collapses the strip. The filter narrows the list before the strip
 * picks its tiles, so pins and the subject's cameras are ordered within what the filter lists; it
 * is this component's own state and is not remembered. Collapsing is the store's (`stripCollapsed`,
 * remembered per browser): the tiles are not rendered, so no stream runs behind a hidden strip, and
 * the header keeps "N offline" so a camera lost while collapsed is not hidden. Nothing in the
 * header is a count until the list is loaded: a 0 shown while loading would be a guess.
 *
 * "View all" (V3-08.4) opens `CameraGrid`, a dialog of every camera, so the strip stays a shortlist.
 * Like the counts it exists only for a loaded, non-empty list, and it stays while the strip is
 * collapsed, since it needs no tile. Whether the dialog is open is this component's state, not the
 * store's: nothing else reads it.
 */
export function CameraStrip() {
  const { data: cameras, error, failureReason, isPending, isFetching, refetch } = useCameras();
  const { data: incidents = [] } = useIncidents();
  // The catalogue is cached for the shift (the Assets tab holds it); until it is loaded there is no
  // asset subject and the strip orders as with nothing selected.
  const { data: assets } = useAssets();
  const selectedId = useConsole((s) => s.selectedIncidentId);
  const selectedAssetCode = useConsole((s) => s.selectedAssetCode);
  const pinnedIds = useConsole((s) => s.pinnedCameraIds);
  const collapsed = useConsole((s) => s.stripCollapsed);
  const setCollapsed = useConsole((s) => s.setStripCollapsed);
  // Held here, above the tiles, so collapsing and expanding keeps the choice.
  const [filter, setFilter] = useState<CameraFilter>('all');
  const [viewingAll, setViewingAll] = useState(false);
  const rowId = useId();
  const incidentZoneId = incidents.find((i) => i.id === selectedId)?.zoneId;
  const asset =
    selectedAssetCode === null ? undefined : assets?.find((a) => a.code === selectedAssetCode);
  const subject = stripSubject(incidentZoneId, asset);
  const loading = isPending && !isRateLimited(failureReason);
  const size = stripSize(useDisplayMode());
  // The column count follows the tile count; CSS still makes it two columns on a tablet.
  const columns = { '--strip-columns': size } as CSSProperties;
  const counts = cameras ? countCameras(cameras) : undefined;

  // Every state but a loaded, non-empty list: the row holds a placeholder or a message.
  const placeholder = loading ? (
    <>
      <p role="status" className={styles.hidden}>
        Loading cameras…
      </p>
      {Array.from({ length: size }, (_, tile) => (
        <Skeleton key={tile} className={styles.skeleton} />
      ))}
    </>
  ) : isPending ? (
    <RateLimited className={styles.message} />
  ) : !cameras ? (
    <LoadFailed
      error={error}
      fallback="Cameras could not be loaded."
      isFetching={isFetching}
      onRetry={() => void refetch()}
      className={styles.message}
    />
  ) : (
    <p className={`${text.muted} ${styles.message}`}>No cameras are set up on this site.</p>
  );

  const shown = cameras ? filterCameras(cameras, filter) : [];

  return (
    <section
      className={styles.strip}
      style={columns}
      aria-label="Cameras"
      aria-busy={loading || undefined}
      data-collapsed={collapsed || undefined}
    >
      <h2 className={styles.title}>Camera feeds</h2>
      {counts && <span className={styles.count}>{counts.all}</span>}
      {collapsed && counts && counts.offline > 0 && (
        <span className={styles.offline}>{counts.offline} offline</span>
      )}
      {/* Before the filter and the tiles in the DOM, so Tab reaches the control before what it controls. */}
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={!collapsed}
        aria-controls={rowId}
        aria-label={collapsed ? 'Show cameras' : 'Hide cameras'}
        onClick={() => setCollapsed(!collapsed)}
      >
        <Icon glyph={ChevronDown} size={16} className={styles.chevron} />
      </button>
      {counts && counts.all > 0 && (
        <Button
          variant="ghost"
          size="sm"
          icon={LayoutGrid}
          className={styles.viewAll}
          onClick={() => setViewingAll(true)}
        >
          View all
        </Button>
      )}
      {!collapsed && counts && counts.all > 0 ? (
        <Tabs
          label="Filter cameras"
          tabs={CAMERA_FILTERS.map(({ value, label }) => ({ value, label, count: counts[value] }))}
          value={filter}
          onChange={setFilter}
          appearance="chips"
          className={styles.tabs}
          panelClassName={styles.panel}
        >
          <div id={rowId} className={styles.tiles}>
            {shown.length === 0 ? (
              <p className={`${text.muted} ${styles.message}`}>No {filter} cameras.</p>
            ) : (
              stripCameras(shown, subject, pinnedIds, size).map((camera) => (
                <CameraTile
                  key={camera.id}
                  camera={camera}
                  link={cameraLink(camera, subject) ?? undefined}
                />
              ))
            )}
          </div>
        </Tabs>
      ) : (
        // Kept while collapsed, empty, so the button's `aria-controls` never names nothing.
        <div id={rowId} className={styles.tiles} hidden={collapsed}>
          {!collapsed && placeholder}
        </div>
      )}
      {viewingAll && cameras && (
        <CameraGrid cameras={cameras} subject={subject} onClose={() => setViewingAll(false)} />
      )}
    </section>
  );
}
