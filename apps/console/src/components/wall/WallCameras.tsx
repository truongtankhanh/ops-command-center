import { useCameras, useIncidents } from '../../api/queries';
import { cameraLink, stripCameras, wallStripSize, wallSubject } from '../../lib/cameras/cameras';
import { useDisplayMode } from '../../lib/shell/useDisplayMode';
import { useConsole } from '../../store';
import text from '../../styles/text.module.css';
import { Skeleton } from '../../ui/Skeleton';
import { CameraTile } from '../cameras/CameraTile';
import styles from './WallCameras.module.css';

/**
 * The video wall's camera grid (V2-21.4, frame 18): two columns of tiles, the incident's cameras first. Six tiles at
 * 1920 and at 4K (`wallStripSize`, four on a smaller window: a 4K wall is the same picture twice as large). It follows the incident the wall holds in focus, or
 * else the one the feed puts first (`wallSubject`); that incident's zone's cameras come first and carry its code as
 * their tag, an offline camera after every online one (`stripCameras`, no pins). A tile is the console's `CameraTile`
 * with `readOnly`: the picture, the labels and the time, and nothing to press.
 *
 * A camera with no signal reads "No signal" and its code, as every offline tile does. The frame adds "since 14:38":
 * the console does not know when a camera went offline (`Camera` has `online` only), so that is not drawn.
 */
export function WallCameras() {
  const { data: cameras, isPending, isError } = useCameras();
  const { data: incidents = [] } = useIncidents();
  const focusedId = useConsole((s) => s.wallFocusId);
  const size = wallStripSize(useDisplayMode());
  const followed = wallSubject(incidents, focusedId);

  if (isPending) {
    return (
      <div className={styles.grid} aria-busy="true">
        <p role="status" className={styles.hidden}>
          Loading cameras…
        </p>
        {Array.from({ length: size }, (_, tile) => (
          <Skeleton key={tile} className={styles.skeleton} />
        ))}
      </div>
    );
  }
  // A line, not a button: nobody at a wall can retry, and the query retries by itself.
  if (isError || !cameras) {
    return <p className={`${text.muted} ${styles.message}`}>Cameras could not be loaded.</p>;
  }
  if (cameras.length === 0) {
    return <p className={`${text.muted} ${styles.message}`}>No cameras are set up on this site.</p>;
  }

  return (
    <ul className={styles.grid} role="list">
      {stripCameras(cameras, followed?.subject, [], size).map((camera) => {
        const link = cameraLink(camera, followed?.subject);
        return (
          <li key={camera.id} className={styles.item}>
            <CameraTile
              camera={camera}
              link={link ?? undefined}
              tag={link ? followed?.incident.code : undefined}
              readOnly
            />
          </li>
        );
      })}
    </ul>
  );
}
