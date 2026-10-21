import { Icon } from '../../ui/Icon';
import { cameraIcon } from '../../ui/icons';
import styles from './WallLegend.module.css';

/**
 * The strip at the stage's bottom left (V2-21.8, frame 18 `.wall-legend`): what the beacons and markers mean. Status is
 * shape (a filled disc is open, a ring is being handled) and the colour of a beacon is its severity, said in words as
 * the frame does. A wall has no pointer, so there is no toggle: the console's `TwinLegend` (which has one, the asset and
 * stale-data entries and the isolation lines) is not mounted on a wall (V2-21.6).
 */
export function WallLegend() {
  return (
    <ul className={styles.legend} aria-label="Legend">
      <li>
        <span className={`${styles.swatch} ${styles.open}`} aria-hidden />
        Open
      </li>
      <li>
        <span className={`${styles.swatch} ${styles.handled}`} aria-hidden />
        Being handled
      </li>
      <li>
        <Icon glyph={cameraIcon(true)} size={20} />
        Camera
      </li>
      <li>Colour = severity</li>
    </ul>
  );
}
