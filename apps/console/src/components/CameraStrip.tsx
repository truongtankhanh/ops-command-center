import type { CSSProperties } from 'react';
import { isRateLimited } from '../api/client';
import { useCameras, useIncidents } from '../api/queries';
import { stripCameras, stripSize } from '../lib/cameras';
import { useDisplayMode } from '../lib/useDisplayMode';
import { useConsole } from '../store';
import text from '../styles/text.module.css';
import { Skeleton } from '../ui/Skeleton';
import styles from './CameraStrip.module.css';
import { CameraTile } from './CameraTile';
import { LoadFailed, RateLimited } from './LoadStates';

/**
 * One row of tiles — four, six on a wall, eight on a 4K wall (`stripSize`): pinned cameras first,
 * then the selected incident's zone, then the rest of the campus.
 * Tiles in that zone are marked as linked to the incident (frame 02). While the camera list loads,
 * placeholder tiles hold the strip's height; if it cannot be loaded, the strip says so with a Retry.
 */
export function CameraStrip() {
  const { data: cameras, error, failureReason, isPending, isFetching, refetch } = useCameras();
  const { data: incidents = [] } = useIncidents();
  const selectedId = useConsole((s) => s.selectedIncidentId);
  const pinnedIds = useConsole((s) => s.pinnedCameraIds);
  const zoneId = incidents.find((i) => i.id === selectedId)?.zoneId;
  const loading = isPending && !isRateLimited(failureReason);
  const size = stripSize(useDisplayMode());
  // The column count follows the tile count; CSS still makes it two columns on a tablet.
  const columns = { '--strip-columns': size } as CSSProperties;

  return (
    <section
      className={styles.strip}
      style={columns}
      aria-label="Cameras"
      aria-busy={loading || undefined}
    >
      {loading ? (
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
      ) : cameras.length === 0 ? (
        <p className={`${text.muted} ${styles.message}`}>No cameras are set up on this site.</p>
      ) : (
        stripCameras(cameras, zoneId, pinnedIds, size).map((camera) => (
          <CameraTile key={camera.id} camera={camera} linked={camera.zoneId === zoneId} />
        ))
      )}
    </section>
  );
}
