import { useConsole } from '../store';
import { CampusMap } from './CampusMap';
import { LayersControl } from './LayersControl';
import styles from './StageView.module.css';
import { ViewSwitch } from './ViewSwitch';

/**
 * What the map stage draws, with the controls that sit over it (frames 07 and 14).
 *
 * Today that is always the 2D map: the store's `view` is `2d` until the twin exists (V2-12). The
 * seam is here so V2-12 adds one branch, a `React.lazy` 3D stage for `view === '3d'`, and nothing
 * else moves; the 2D console, the sign-in screens and the fallback never download it (ADR-0020).
 * Nothing 3D is imported here.
 *
 * The tools are siblings of the map, not children: the map's own box clips and stacks what is
 * inside it, and the stage grid places the map and the strip, so the tools are out of the flow
 * (`StageView.module.css`), as the banners are. The layers control sits beside the switch.
 */
export function StageView() {
  const view = useConsole((s) => s.view);
  return (
    <>
      <CampusMap />
      <div className={styles.tools} data-view={view}>
        <ViewSwitch />
        <LayersControl />
      </div>
    </>
  );
}
