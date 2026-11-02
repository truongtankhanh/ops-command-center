import { useFrame, useThree } from '@react-three/fiber';
import { type RefObject, useEffect } from 'react';
import { type PerspectiveCamera, Vector3 } from 'three';
import { scaleReading } from '../lib/map/scaleBar';
import { metresPerPixelAt } from '../lib/twin-core/twinCamera';
import { writeScale } from '../ui/writeScale';

/** One vector for every frame: nothing is allocated while the camera moves. */
const target = new Vector3();

/** The one thing of the camera controls this needs; R3F types `controls` as a bare `EventDispatcher`. */
interface HasTarget {
  getTarget(out: Vector3, receiveEndValue?: boolean): Vector3;
}

const hasTarget = (controls: unknown): controls is HasTarget =>
  typeof (controls as Partial<HasTarget> | null)?.getTarget === 'function';

const isPerspective = (camera: unknown): camera is PerspectiveCamera =>
  (camera as Partial<PerspectiveCamera>).isPerspectiveCamera === true;

interface ScaleSyncProps {
  /** The scale bar `TwinScale` renders, whose width and label this writes. */
  scaleRef: RefObject<HTMLDivElement | null>;
}

/**
 * Keeps the 3D scale bar true to the camera (V3-10.3). Rendered inside the canvas, it renders nothing: on every frame that is
 * drawn it takes the distance from the camera to the controls' target and the lens (`fov`, `zoom`) and the canvas' height,
 * turns them into metres per pixel across the screen **at the target's depth** (`metresPerPixelAt`), and writes the round
 * length it fits to the bar (`writeScale`, with "≈": a perspective picture has no one scale). Through a ref, so the stage
 * re-renders for none of it, and a camera that has settled writes nothing: `writeScale` touches the DOM only when the pixel
 * width or the label differ.
 *
 * It reads the live camera, as `CompassSync` does, not `twinCommands.current()`: that answers where the camera is going,
 * so a bar read from it would show the destination's scale for the 600 ms of a fly-to, and it has no viewport height.
 * The open sheet shifts the picture (`viewOffset`) but keeps the full stage size, so it does not change the scale.
 *
 * Frame demand: one-shot. An effect asks for one frame on mount, and again when the controls arrive (the rig registers them
 * after the first render), so the bar has a first value; after that the camera moving is what asks, and this writes in the
 * frames it asked for.
 */
export function ScaleSync({ scaleRef }: ScaleSyncProps) {
  const invalidate = useThree((state) => state.invalidate);
  const controls = useThree((state) => state.controls);

  useEffect(() => {
    invalidate();
  }, [invalidate, controls]);

  useFrame(({ camera, controls: live, size }) => {
    const root = scaleRef.current;
    if (!root || !isPerspective(camera) || !hasTarget(live)) return;
    live.getTarget(target, false);
    const metresPerPixel = metresPerPixelAt(
      camera.position.distanceTo(target),
      camera.fov,
      size.height,
      camera.zoom,
    );
    writeScale(root, scaleReading(metresPerPixel, { approximate: true }));
  });

  return null;
}
