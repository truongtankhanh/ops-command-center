import { Canvas, useThree } from '@react-three/fiber';
import { type RefObject, useLayoutEffect } from 'react';
import { PerspectiveCamera } from 'three';
import type { InterimView } from '../lib/twinScene';
import { mapColors } from '../styles/tokens';
import { Buildings } from './Buildings';
import { CameraMarkers } from './CameraMarkers';
import { Ground } from './Ground';
import { LabelProjector } from './LabelProjector';
import { Lights } from './Lights';
import type { TwinScene } from './useTwinScene';

/**
 * A fixed overview, so the scene can be seen before the camera rig exists (V2-12.9 replaces this
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

interface TwinCanvasProps {
  /** What to draw, from `useTwinScene`; `null` while there is nothing (the canvas stays empty). */
  scene: TwinScene | null;
  /** The DOM label layer `ZoneLabels` renders, whose labels `LabelProjector` places. */
  labelLayer: RefObject<HTMLDivElement | null>;
}

/**
 * The WebGL canvas of the 3D twin (ADR-0020): the lit campus, its ground, its buildings and its cameras
 * (screen-sized markers). The camera rig arrives with V2-12.9, the loading card and context loss with V2-12.11.
 *
 * - The scene is a prop. `TwinStage` reads the queries and derives it once (`useTwinScene`): `<Canvas>`
 *   renders in its own reconciler, so its children are not a safe place for a query hook, and the DOM
 *   labels beside the canvas need the same frame.
 * - The zone labels are DOM elements outside the canvas; `LabelProjector` is the one thing inside it
 *   that touches them, placing them from the camera on each drawn frame.
 * - `frameloop="demand"`: a frame is drawn only when something asks for one (a moving part, an
 *   easing value, the camera), so an idle scene costs nothing.
 * - `dpr={[1, 1.5]}`: the pixel ratio never exceeds 1.5 (brief § Performance); V2-19.3 steps it down.
 * - `flat`: no tone mapping, so the colours on screen are the token colours.
 *
 * R3F sizes the canvas to its parent, so the parent must have a size (`TwinStage`).
 */
export function TwinCanvas({ scene, labelLayer }: TwinCanvasProps) {
  return (
    <Canvas frameloop="demand" dpr={[1, 1.5]} flat>
      {/* `--surface-0`, a copy kept in step by `scripts/contrast.ts --check` (WebGL cannot read CSS). */}
      <color attach="background" args={[mapColors.ground]} />
      {scene && (
        <>
          <InterimCamera view={scene.view} />
          <Lights />
          <Ground plan={scene.plan} zones={scene.zones} frame={scene.frame} />
          <Buildings zones={scene.zones} frame={scene.frame} />
          <CameraMarkers cameras={scene.cameras} frame={scene.frame} />
          <LabelProjector anchors={scene.anchors} layerRef={labelLayer} />
        </>
      )}
    </Canvas>
  );
}
