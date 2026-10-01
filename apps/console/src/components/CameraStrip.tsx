import { useCameras, useIncidents } from '../api/queries';
import { prioritise } from '../lib/cameras';
import { useConsole } from '../store';
import { CameraTile } from './CameraTile';

const TILE_COUNT = 4;

/** Four tiles: cameras in the selected incident's zone first, then the rest of the campus. */
export function CameraStrip() {
  const { data: cameras = [] } = useCameras();
  const { data: incidents = [] } = useIncidents();
  const selectedId = useConsole((s) => s.selectedIncidentId);
  const zoneId = incidents.find((i) => i.id === selectedId)?.zoneId;

  const tiles = prioritise(cameras, zoneId).slice(0, TILE_COUNT);

  return (
    <section className="camera-strip" aria-label="Cameras">
      {tiles.map((camera) => (
        <CameraTile key={camera.id} camera={camera} />
      ))}
    </section>
  );
}
