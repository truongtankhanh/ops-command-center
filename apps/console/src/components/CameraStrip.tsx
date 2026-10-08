import { useCameras, useIncidents } from '../api/queries';
import { stripCameras } from '../lib/cameras';
import { useConsole } from '../store';
import styles from './CameraStrip.module.css';
import { CameraTile } from './CameraTile';

/**
 * Four tiles: pinned cameras first, then the selected incident's zone, then the rest of the campus.
 * Tiles in that zone are marked as linked to the incident (frame 02).
 */
export function CameraStrip() {
  const { data: cameras = [] } = useCameras();
  const { data: incidents = [] } = useIncidents();
  const selectedId = useConsole((s) => s.selectedIncidentId);
  const pinnedIds = useConsole((s) => s.pinnedCameraIds);
  const zoneId = incidents.find((i) => i.id === selectedId)?.zoneId;

  const tiles = stripCameras(cameras, zoneId, pinnedIds);

  return (
    <section className={styles.strip} aria-label="Cameras">
      {tiles.map((camera) => (
        <CameraTile key={camera.id} camera={camera} linked={camera.zoneId === zoneId} />
      ))}
    </section>
  );
}
