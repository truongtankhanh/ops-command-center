import { Fragment, type RefObject } from 'react';
import { HUD_LABEL, HUD_ROWS, NO_VALUE } from '../lib/twin-core/twinHud';
import styles from './Hud.module.css';

interface HudProps {
  /** The list the probe writes the figures into (`HudProbe`, inside the canvas), by each cell's `data-hud`. */
  listRef: RefObject<HTMLDListElement | null>;
}

/**
 * The developer HUD of the 3D view (V2-19.1, frame 00, ADR-0020 § Budgets): FPS, p95 frame time, draw calls,
 * triangles, telemetry messages per second and worker posts per frame. It draws labels and dashes and **nothing
 * else**: the figures come from `HudProbe`, which writes them into the cells by `textContent` twice a second, so no
 * React render follows a frame.
 *
 * Development builds only, and only with `?debug=twin`: `TwinStage` imports this module behind a literal
 * `import.meta.env.MODE` check, so a production build holds neither the module nor its words, and
 * `scripts/chunk-budget.ts` fails the build if either shows up in `dist`.
 *
 * Not a control and not a live region (it changes twice a second): a named group holding a description list, no
 * focus, no key, no pointer events. A default export, like `TwinStage`: `React.lazy` needs one.
 */
export default function Hud({ listRef }: HudProps) {
  return (
    <div role="group" aria-label={HUD_LABEL} className={styles.hud}>
      <dl ref={listRef} className={styles.list}>
        {HUD_ROWS.map(({ id, label }) => (
          <Fragment key={id}>
            <dt>{label}</dt>
            <dd data-hud={id}>{NO_VALUE}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}
