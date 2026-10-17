import { Canvas } from '@react-three/fiber';
import type { RefObject } from 'react';
import { HOME_FOV_DEG } from '../lib/twinCamera';
import { mapColors } from '../styles/tokens';
import { Buildings } from './Buildings';
import { CameraMarkers } from './CameraMarkers';
import { CompassSync } from './CompassSync';
import { Ground } from './Ground';
import { LabelProjector } from './LabelProjector';
import { Lights } from './Lights';
import { Rig } from './Rig';
import type { TwinScene } from './useTwinScene';

/**
 * The lens (V2-12.9): the home view is fitted for this field of view. `far` reaches past the longest distance
 * (900 m) plus the campus's radius with room to spare; `near` is fine from 60 m and for the models at 4 m.
 * Position and target are the rig's.
 */
const LENS = { fov: HOME_FOV_DEG, near: 1, far: 2500 };

interface TwinCanvasProps {
  /** What to draw, from `useTwinScene`; `null` while there is nothing (the canvas stays empty). */
  scene: TwinScene | null;
  /** The DOM label layer `ZoneLabels` renders, whose labels `LabelProjector` places. */
  labelLayer: RefObject<HTMLDivElement | null>;
  /** The compass button `TwinControls` renders, which `CompassSync` turns and renames from the camera. */
  compassRef: RefObject<HTMLButtonElement | null>;
}

/**
 * The WebGL canvas of the 3D twin (ADR-0020): the lit campus, its ground, its buildings and its cameras
 * (screen-sized markers), seen through the camera rig (`Rig`). The loading card and context loss arrive
 * with V2-12.11.
 *
 * - The scene is a prop. `TwinStage` reads the queries and derives it once (`useTwinScene`): `<Canvas>`
 *   renders in its own reconciler, so its children are not a safe place for a query hook, and the DOM
 *   labels beside the canvas need the same frame.
 * - The camera is the rig's: it sets the first view, moves only on a user action or a command, and a
 *   resting stage draws nothing.
 * - The compass is a DOM button beside the canvas; `CompassSync` turns and renames it from the camera on each
 *   drawn frame, through a ref.
 * - The zone labels are DOM elements outside the canvas; `LabelProjector` is the one thing inside it
 *   that touches them, placing them from the camera on each drawn frame.
 * - `frameloop="demand"`: a frame is drawn only when something asks for one (a moving part, an
 *   easing value, the camera), so an idle scene costs nothing.
 * - `dpr={[1, 1.5]}`: the pixel ratio never exceeds 1.5 (brief § Performance); V2-19.3 steps it down.
 * - `flat`: no tone mapping, so the colours on screen are the token colours.
 *
 * R3F sizes the canvas to its parent, so the parent must have a size (`TwinStage`).
 */
export function TwinCanvas({ scene, labelLayer, compassRef }: TwinCanvasProps) {
  return (
    <Canvas camera={LENS} frameloop="demand" dpr={[1, 1.5]} flat>
      {/* `--surface-0`, a copy kept in step by `scripts/contrast.ts --check` (WebGL cannot read CSS). */}
      <color attach="background" args={[mapColors.ground]} />
      {scene && (
        <>
          <Rig bounds={scene.bounds} />
          <Lights />
          <Ground plan={scene.plan} zones={scene.zones} frame={scene.frame} />
          <Buildings zones={scene.zones} frame={scene.frame} />
          <CameraMarkers cameras={scene.cameras} frame={scene.frame} />
          <LabelProjector anchors={scene.anchors} layerRef={labelLayer} />
          <CompassSync compassRef={compassRef} />
        </>
      )}
    </Canvas>
  );
}
