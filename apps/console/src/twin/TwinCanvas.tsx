import { Canvas, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo } from 'react';
import { PerspectiveCamera } from 'three';
import { useSitePlan, useZones } from '../api/queries';
import {
  type Frame,
  type InterimView,
  interimView,
  sceneBounds,
  sceneFrame,
} from '../lib/twinScene';
import { mapColors } from '../styles/tokens';
import { Ground } from './Ground';
import { Lights } from './Lights';

/**
 * A fixed overview, so the ground can be seen before the camera rig exists (V2-12.9 replaces this
 * component with `Rig` and the view with `homeView`). Placed once per view; `frameloop="demand"`
 * draws nothing unless asked, hence `invalidate`.
 */
function InterimCamera({ view }: { view: InterimView }) {
  // `get` reads the store at the time of the effect: R3F hands the camera out to be mutated, which the
  // hooks lint (`react-hooks/immutability`) rejects for a value returned from a hook.
  const get = useThree((state) => state.get);
  useLayoutEffect(() => {
    const { camera, invalidate } = get();
    if (!(camera instanceof PerspectiveCamera)) return;
    camera.fov = view.fov;
    camera.near = view.near;
    camera.far = view.far;
    camera.position.set(...view.position);
    camera.lookAt(...view.target);
    camera.updateProjectionMatrix();
    invalidate();
  }, [get, view]);
  return null;
}

const NO_ZONES: never[] = [];

/**
 * The WebGL canvas of the 3D twin (ADR-0020): the lit campus ground. Buildings arrive with V2-12.7,
 * cameras with V2-12.8, the camera rig with V2-12.9, the loading card and context loss with V2-12.11.
 *
 * - The zones and the site plan come from the queries the 2D map uses, read here and passed down:
 *   `<Canvas>` renders in its own reconciler, so its children are not a safe place for a query hook.
 *   Reference data, no new request. With no zones the canvas stays empty; with a plan that is not
 *   served (404) the zones draw alone, as on the 2D map.
 * - `frameloop="demand"`: a frame is drawn only when something asks for one (a moving part, an
 *   easing value, the camera), so an idle scene costs nothing.
 * - `dpr={[1, 1.5]}`: the pixel ratio never exceeds 1.5 (brief § Performance); V2-19.3 steps it down.
 * - `flat`: no tone mapping, so the colours on screen are the token colours.
 *
 * R3F sizes the canvas to its parent, so the parent must have a size (`TwinStage`).
 */
export function TwinCanvas() {
  const { data: zones } = useZones();
  const { data: plan } = useSitePlan();

  const scene = useMemo(() => {
    const list = zones ?? NO_ZONES;
    const frame: Frame | null = sceneFrame(plan, list);
    const bounds = frame && sceneBounds(plan, list, frame);
    return frame && bounds ? { frame, zones: list, view: interimView(bounds) } : null;
  }, [plan, zones]);

  return (
    <Canvas frameloop="demand" dpr={[1, 1.5]} flat>
      {/* `--surface-0`, a copy kept in step by `scripts/contrast.ts --check` (WebGL cannot read CSS). */}
      <color attach="background" args={[mapColors.ground]} />
      {scene && (
        <>
          <InterimCamera view={scene.view} />
          <Lights />
          <Ground plan={plan} zones={scene.zones} frame={scene.frame} />
        </>
      )}
    </Canvas>
  );
}
