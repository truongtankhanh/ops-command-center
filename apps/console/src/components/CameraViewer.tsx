import type { Camera } from '@occ/contracts';
import { useRef } from 'react';
import { useCameras, useStream, useZones } from '../api/queries';
import { feedState } from '../lib/cameras';
import { useConsole } from '../store';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { cameraIcon, Maximize } from '../ui/icons';
import { CameraFeed } from './CameraFeed';
import { CameraTime } from './CameraTime';
import { LivePill } from './CameraTile';
import styles from './CameraViewer.module.css';

/**
 * One camera, large, with the other cameras of its zone to switch to (no frame draws it; D1, D9).
 * Mounted once in `App`: the strip, the detail sheet's tiles and the map's camera markers all open
 * it through `useConsole.openViewer`. It leaves the sheet under it as it was.
 *
 * Switching cameras keeps the dialog mounted, so focus stays on the list and `Dialog` still returns
 * it to whatever opened the viewer.
 */
export function CameraViewer() {
  const cameraId = useConsole((s) => s.viewerCameraId);
  const { data: cameras = [] } = useCameras();
  const camera = cameras.find((c) => c.id === cameraId);
  // Unknown id (cameras not loaded yet, or removed): show nothing and keep the id, so the viewer
  // appears once the list arrives.
  return camera ? <Viewer camera={camera} cameras={cameras} /> : null;
}

function Viewer({ camera, cameras }: { camera: Camera; cameras: Camera[] }) {
  const { data: zones = [] } = useZones();
  const openViewer = useConsole((s) => s.openViewer);
  const closeViewer = useConsole((s) => s.closeViewer);
  const stream = useStream(camera);
  const video = useRef<HTMLDivElement>(null);

  const zone = zones.find((z) => z.id === camera.zoneId);
  const zoneCameras = cameras
    .filter((c) => c.zoneId === camera.zoneId)
    .sort((a, b) => a.code.localeCompare(b.code));
  const live = feedState(camera.online, stream) === 'stream';
  const listName = `Cameras in ${zone?.name ?? 'this zone'}`;

  const fullscreen = () => {
    // Refused when the page is not allowed to, or not in reply to a user gesture: the modal stays.
    video.current?.requestFullscreen().catch(() => undefined);
  };

  return (
    <Dialog
      size="wide"
      title={`${camera.name} · ${camera.code}`}
      onCancel={closeViewer}
      actions={
        <Button variant="ghost" onClick={closeViewer}>
          Close
        </Button>
      }
    >
      <div className={styles.layout}>
        <div className={styles.main}>
          <div ref={video} className={styles.video}>
            <CameraFeed camera={camera} resolution="viewer" />
            {live && (
              <div className={styles.overlay}>
                <LivePill />
                <CameraTime className={styles.time} />
              </div>
            )}
          </div>
          {document.fullscreenEnabled && (
            <Button size="sm" icon={Maximize} onClick={fullscreen}>
              Fullscreen
            </Button>
          )}
        </div>

        <nav aria-label={listName} className={styles.list}>
          <h3 className={styles.listTitle}>{listName}</h3>
          <ul>
            {zoneCameras.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={styles.item}
                  aria-current={c.id === camera.id ? 'true' : undefined}
                  onClick={() => openViewer(c.id)}
                >
                  <Icon glyph={cameraIcon(c.online)} size={16} />
                  <span className={styles.itemText}>
                    <span className={styles.itemName}>{c.name}</span>
                    <span className={styles.itemMeta}>
                      {c.online ? c.code : `${c.code} · Offline`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </Dialog>
  );
}
