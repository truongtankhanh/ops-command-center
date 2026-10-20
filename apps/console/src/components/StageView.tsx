import { lazy, Suspense, useState } from 'react';
import { levelOf } from '../lib/twinLevel';
import { useTwinLoading } from '../lib/useTwinLoading';
import { useConsole } from '../store';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { CampusMap } from './CampusMap';
import { ColourBy } from './ColourBy';
import { LayersControl } from './LayersControl';
import { RegionFallback } from './LoadStates';
import styles from './StageView.module.css';
import { TwinBreadcrumb } from './TwinBreadcrumb';
import { TwinLoading } from './TwinLoading';
import { ViewSwitch } from './ViewSwitch';

/**
 * The 3D twin's chunk (ADR-0020): the only crossing from the console into `src/twin/` (lint allows
 * it as a dynamic `import()` only), so the 2D view, the fallback and the sign-in screens never
 * download three.js.
 */
const loadTwinStage = () => import('../twin/TwinStage');

/**
 * Whether the twin chunk has been fetched in this page's life. A later visit to 3D then starts with the code
 * step done, instead of showing the loading card for the tick an already loaded import takes to resolve.
 */
let twinChunkLoaded = false;

/** The lazy 3D stage; `onLoaded` runs when its chunk has arrived, so the card can tick the code step off. */
const lazyStage = (onLoaded: () => void) =>
  lazy(() =>
    loadTwinStage().then((module) => {
      twinChunkLoaded = true;
      onLoaded();
      return module;
    }),
  );

/**
 * What the map stage draws, with the controls that sit over it (frames 07 and 14).
 *
 * The 2D map, or the lazy 3D stage when the store's `view` is `3d`. `view` is `2d` until the twin can
 * be drawn (`useTwinCapability`): in `pnpm dev` and with `?twin=1` until the preview gate goes
 * (V2-19.8), and by tests; a lost WebGL context puts it back on `2d` (V2-12.4). The map is
 * not mounted while 3D shows: two WebGL contexts at once would be wasted, and switching back remounts it.
 *
 * The tools are siblings of the map, not children: the map's own box clips and stacks what is
 * inside it, and the stage grid places the map and the strip, so the tools are out of the flow
 * (`StageView.module.css`), as the banners are. The layers control sits beside the switch. They are
 * always drawn, so the operator can go back to 2D when the 3D stage fails to load.
 *
 * In the 3D view at building and asset level the scene's breadcrumb takes the switch's place (V2-15.6, frames 03,
 * 12 and 15), and the layers stay. The switch is back at campus level, which is one press of the breadcrumb's back
 * button away, and in the 2D view, where the levels do not exist.
 *
 * In the 3D view the "Colour by" picker (V2-17.4, frame 13) follows the layers in the same row, so it wraps with
 * them; it draws nothing unless the Heat layer is on and the level shows it.
 */
export function StageView() {
  const view = useConsole((s) => s.view);
  const level = useConsole((s) => levelOf(s));
  return (
    <>
      {view === '3d' ? <LazyTwinStage /> : <CampusMap />}
      <div className={styles.tools} data-view={view}>
        {view === '3d' && level !== 'campus' ? <TwinBreadcrumb /> : <ViewSwitch />}
        <LayersControl view={view} />
        {view === '3d' && <ColourBy />}
      </div>
    </>
  );
}

/**
 * The 3D stage and what it waits for (V2-12.11, frame 06). While the 3D code or the site plan is on its way, the
 * loading card (`TwinLoading`) is over the stage, on the dark ground (the 2D map is not mounted in 3D), with a
 * step for each; the section is named "Campus 3D view, loading" and `aria-busy` as long as anything is on its
 * way. The incidents, the cameras and the actions stay usable around it. A step that failed (the site plan) stays
 * on the card with a Retry and is no longer "busy".
 *
 * If the chunk itself cannot be fetched (network, or a console release that replaced it), a fallback in the
 * stage's place with a Retry. `React.lazy` keeps a rejected promise, so Retry makes a new lazy component to try
 * the import again; a boundary retry alone would show the same failure. The card is main-chunk code on purpose:
 * it has to show before the twin chunk and its CSS have arrived.
 */
function LazyTwinStage() {
  const [codeLoaded, setCodeLoaded] = useState(twinChunkLoaded);
  const [Stage, setStage] = useState(() => lazyStage(() => setCodeLoaded(true)));
  const load = useTwinLoading(codeLoaded);
  const waiting = load.steps.some((step) => step.state !== 'done');
  return (
    <ErrorBoundary
      region="3D view"
      fallback={(retry) => (
        <RegionFallback
          label="Campus 3D view"
          message="The 3D view stopped working."
          className={styles.twin}
          retry={() => {
            setCodeLoaded(false);
            setStage(() => lazyStage(() => setCodeLoaded(true)));
            retry();
          }}
        />
      )}
    >
      <section
        className={styles.twin}
        aria-label={load.loading ? 'Campus 3D view, loading' : 'Campus 3D view'}
        aria-busy={load.loading}
      >
        <Suspense fallback={null}>
          <Stage />
        </Suspense>
        {waiting && (
          <TwinLoading steps={load.steps} onRetry={load.retry} retrying={load.retrying} />
        )}
      </section>
    </ErrorBoundary>
  );
}
