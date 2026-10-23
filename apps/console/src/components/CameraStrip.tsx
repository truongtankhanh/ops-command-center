import type { CSSProperties } from 'react';
import { isRateLimited } from '../api/client';
import { useAssets, useCameras, useIncidents } from '../api/queries';
import { cameraLink, stripCameras, stripSize, stripSubject } from '../lib/cameras/cameras';
import { useDisplayMode } from '../lib/useDisplayMode';
import { useConsole } from '../store';
import text from '../styles/text.module.css';
import { Skeleton } from '../ui/Skeleton';
import styles from './CameraStrip.module.css';
import { CameraTile } from './CameraTile';
import { LoadFailed, RateLimited } from './LoadStates';

/**
 * One row of tiles — four, six on a wall, eight on a 4K wall (`stripSize`): pinned cameras first,
 * then the selected incident's zone or the selected asset's cameras, then the rest of the campus.
 * For an asset the cameras that see it come before those in its zone, and each tile says which it is
 * ("On this asset", "In zone", frames 02 / 03); for an incident only its zone counts. While the
 * camera list loads, placeholder tiles hold the strip's height; if it cannot be loaded, the strip
 * says so with a Retry.
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
  const incidentZoneId = incidents.find((i) => i.id === selectedId)?.zoneId;
  const asset =
    selectedAssetCode === null ? undefined : assets?.find((a) => a.code === selectedAssetCode);
  const subject = stripSubject(incidentZoneId, asset);
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
        stripCameras(cameras, subject, pinnedIds, size).map((camera) => (
          <CameraTile
            key={camera.id}
            camera={camera}
            link={cameraLink(camera, subject) ?? undefined}
          />
        ))
      )}
    </section>
  );
}
