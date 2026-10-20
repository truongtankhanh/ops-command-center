import { useConsole } from '../store';
import { Icon } from '../ui/Icon';
import { MapPin } from '../ui/icons';
import { Kbd } from '../ui/Kbd';
import styles from './PickHint.module.css';

/**
 * "Click the scene to place the incident · Esc stops picking" (V2-16.7, frame 09 `.map-hint`): a pill at the top of the
 * part of the 3D stage the sheet leaves visible, for as long as the report's location is being picked. The 2D map has
 * its own (`CampusMap`'s `pickHint`, which says to drag the pin: in 3D that is the next sentence once there is a pin).
 *
 * It is decoration, as `DragHint` and the map's: `aria-hidden` and no pointer events, because the canvas is pointer
 * only. The keyboard route to a location is the form's zone select and its `aria-pressed` toggle, and the form's own
 * hint line says where the pin is; Escape works wherever focus is (`useStopPickingOnEscape`).
 */
export function PickHint() {
  const picking = useConsole((state) => state.picking);
  if (!picking) return null;
  return (
    <p className={styles.hint} aria-hidden="true">
      <Icon glyph={MapPin} size={16} />
      <span>
        Click the scene to place the incident · <Kbd>Esc</Kbd> stops picking
      </span>
    </p>
  );
}
