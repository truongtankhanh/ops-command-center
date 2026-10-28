import { useId } from 'react';
import { useIncidents } from '../../api/queries';
import { isActive } from '../../lib/incidents/incidents';
import { StatusBar } from '../shell/StatusBar';
import styles from './WallApp.module.css';
import { useWallFocus } from './useWallFocus';
import { useWallScale } from './useWallScale';
import { WallCameras } from './WallCameras';
import { WallFocusBanner } from './WallFocusBanner';
import { WallHeader } from './WallHeader';
import { WallIncidents } from './WallIncidents';
import { WallLegend } from './WallLegend';
import { WallStage } from './WallStage';

/**
 * The video wall screen (V2-21.3, frame 18): the header over a stage 1240 : 680 beside a side column, at the wall's own
 * `--ui-scale`. The camera grid is `WallCameras` (V2-21.4) and the active list `WallIncidents` (V2-21.5); the stage is
 * `WallStage`: the twin, held still (V2-21.6: the same lazy stage as the console's, with `wall`), or the 2D map where 3D cannot
 * be drawn (V2-21.9). `useWallFocus` (V2-21.8) is what moves the camera, and it lives here so that only a wall mounts it; the
 * focus banner and the legend are drawn over the stage. At the foot is the console's status bar, read-only (V3-06.4): a wall
 * that lost a link or its 3D view says so in the console's words.
 *
 * One `main`, named for the screen; the stage is a labelled region and the two parts of the side column are regions
 * named by their headings. There is no control anywhere: a wall has no pointer and no keyboard.
 */
export function WallApp({ screen }: { screen: number }) {
  useWallScale();
  const focus = useWallFocus();
  const { data: incidents = [] } = useIncidents();
  const active = incidents.filter(isActive).length;
  const camerasId = useId();
  const listId = useId();

  return (
    <div className={styles.wall}>
      <WallHeader screen={screen} />
      <main className={styles.main} aria-label={`Video wall ${screen}`}>
        <div className={styles.stage}>
          <WallStage />
          <WallFocusBanner {...focus} />
          <WallLegend />
        </div>
        <div className={styles.side}>
          <section aria-labelledby={camerasId}>
            <h2 id={camerasId} className={styles.heading}>
              Cameras — incident first
            </h2>
            <WallCameras />
          </section>
          <section className={styles.listSection} aria-labelledby={listId}>
            <h2 id={listId} className={styles.heading}>
              Active incidents · {active}
            </h2>
            <WallIncidents />
          </section>
        </div>
      </main>
      <StatusBar readOnly />
    </div>
  );
}
