import { TWIN_UNAVAILABLE_COPY } from '../../lib/twin-core/twinCapability';
import { useTwinCapability } from '../../lib/twin-core/useTwinCapability';
import { Icon } from '../../ui/Icon';
import { Info } from '../../ui/icons';
import { CampusMap } from '../map/CampusMap';
import { LazyTwinStage } from '../stage/StageView';
import styles from './WallStage.module.css';

/**
 * What fills the wall's stage cell (V2-21.9): the 3D twin where it can be drawn (`LazyTwinStage` with `wall`, V2-21.6), and
 * otherwise the 2D map with a tag that says why. The same decision `StageView` makes from `useTwinCapability`, minus the
 * switch, the layers control and the stored choice of view: a wall has nothing to press, and the 2D/3D choice an operator
 * made in the same browser is not the wall's to follow, so only the capability decides.
 *
 * - **No WebGL 2** puts the map there from the start. **A lost context** or **frames that stay too slow** (`FrameGuard`)
 *   mark the twin lost, and the map replaces it; the focus banner is over the stage cell (`WallApp`), so it keeps showing
 *   for the incident held, and the map follows that incident (`CampusMap`'s `wall`).
 * - **The tag** is a `role="status"` with the reason's words and no button: nobody is there to dismiss it, and it stays as
 *   long as the wall is on the map. It does not come back to 3D by itself, and does not retry WebGL on a timer; a wall
 *   recovers with a reload (V2-21.10).
 */
export function WallStage() {
  const capability = useTwinCapability();
  if (capability.available) return <LazyTwinStage wall />;

  return (
    <>
      <CampusMap wall />
      <p role="status" className={styles.tag}>
        <Icon glyph={Info} size={20} />
        <span>2D map — {TWIN_UNAVAILABLE_COPY[capability.reason].title}</span>
      </p>
    </>
  );
}
