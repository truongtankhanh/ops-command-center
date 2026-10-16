import { lazy, Suspense, useState } from 'react';
import { useConsole } from '../store';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { CampusMap } from './CampusMap';
import { LayersControl } from './LayersControl';
import { RegionFallback } from './LoadStates';
import styles from './StageView.module.css';
import { ViewSwitch } from './ViewSwitch';

/**
 * The 3D twin's chunk (ADR-0020): the only crossing from the console into `src/twin/` (lint allows
 * it as a dynamic `import()` only), so the 2D view, the fallback and the sign-in screens never
 * download three.js.
 */
const loadTwinStage = () => import('../twin/TwinStage');

/**
 * What the map stage draws, with the controls that sit over it (frames 07 and 14).
 *
 * The 2D map, or the lazy 3D stage when the store's `view` is `3d`. `view` is `2d` until the twin can
 * be drawn (`twinCapability`, V2-12.4), so today the 3D branch is only reached by a test. The map is
 * not mounted while 3D shows: two WebGL contexts at once would be wasted, and switching back remounts it.
 *
 * The tools are siblings of the map, not children: the map's own box clips and stacks what is
 * inside it, and the stage grid places the map and the strip, so the tools are out of the flow
 * (`StageView.module.css`), as the banners are. The layers control sits beside the switch. They are
 * always drawn, so the operator can go back to 2D when the 3D stage fails to load.
 */
export function StageView() {
  const view = useConsole((s) => s.view);
  return (
    <>
      {view === '3d' ? <LazyTwinStage /> : <CampusMap />}
      <div className={styles.tools} data-view={view}>
        <ViewSwitch />
        <LayersControl />
      </div>
    </>
  );
}

/**
 * The 3D stage while its chunk loads or if it cannot: a hidden status while loading (the loading
 * card is V2-12.11's) and, if the chunk fails (network, or a console release that replaced it), a
 * fallback in the stage's place with a Retry. `React.lazy` keeps a rejected promise, so Retry makes a
 * new lazy component to try the import again; a boundary retry alone would show the same failure.
 */
function LazyTwinStage() {
  const [Stage, setStage] = useState(() => lazy(loadTwinStage));
  return (
    <ErrorBoundary
      region="3D view"
      fallback={(retry) => (
        <RegionFallback
          label="Campus 3D view"
          message="The 3D view stopped working."
          className={styles.twin}
          retry={() => {
            setStage(() => lazy(loadTwinStage));
            retry();
          }}
        />
      )}
    >
      <section className={styles.twin} aria-label="Campus 3D view">
        <Suspense
          fallback={
            <p role="status" className={styles.hidden}>
              Loading the 3D view…
            </p>
          }
        >
          <Stage />
        </Suspense>
      </section>
    </ErrorBoundary>
  );
}
