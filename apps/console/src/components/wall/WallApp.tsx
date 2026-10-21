import { useId } from 'react';
import { useIncidents } from '../../api/queries';
import { isActive } from '../../lib/incidents';
import styles from './WallApp.module.css';
import { useWallScale } from './useWallScale';
import { WallCameras } from './WallCameras';
import { WallHeader } from './WallHeader';

/** The active list's rows that fit, drawn as placeholders until V2-21.5 fills them. */
const LIST_SLOTS = 6;

/**
 * The video wall screen (V2-21.3, frame 18): the header over a stage 1240 : 680 beside a side column, at the wall's own
 * `--ui-scale`. The camera grid is `WallCameras` (V2-21.4); the 3D stage (V2-21.6, V2-21.9) and the active list
 * (V2-21.5) come in later tasks, and until they land they are labelled, empty places on the same ground.
 *
 * One `main`, named for the screen; the stage is a labelled region and the two parts of the side column are regions
 * named by their headings. There is no control anywhere: a wall has no pointer and no keyboard.
 */
export function WallApp({ screen }: { screen: number }) {
  useWallScale();
  const { data: incidents = [] } = useIncidents();
  const active = incidents.filter(isActive).length;
  const camerasId = useId();
  const listId = useId();

  return (
    <div className={styles.wall}>
      <WallHeader screen={screen} />
      <main className={styles.main} aria-label={`Video wall ${screen}`}>
        <section className={styles.stage} aria-label="Campus 3D view" />
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
            <div className={styles.list} aria-hidden="true">
              {Array.from({ length: LIST_SLOTS }, (_, i) => (
                <div key={i} className={styles.row} />
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
