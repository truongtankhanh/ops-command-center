import { CameraControls, CameraControlsImpl } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Box3, MathUtils, Vector3 } from 'three';
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';
import {
  CAMERA_LIMITS,
  FLY_MS,
  flyPath,
  flyProgress,
  homeView,
  limitPose,
  type Pose,
  poseToPosition,
  positionToPose,
} from '../lib/twinCamera';
import { registerTwinCommands } from '../lib/twinCommands';
import { type Bounds, panBounds } from '../lib/twinScene';
import { sheetInset, useSheetOffset } from './useSheetOffset';

const { ACTION } = CameraControlsImpl;

/** Scratch vectors: the controls write into them, so nothing is allocated per call. */
const scratchPosition = new Vector3();
const scratchTarget = new Vector3();

/**
 * The camera controls' response time, in seconds. camera-controls 3.x has no "damping 0.12": `smoothTime` is the
 * approximate time to reach the target. The brief wants a move to settle in about 300 ms, and a critically
 * damped spring is within a couple of percent of its target after about three time constants, so 0.1 (`unverified`:
 * judged by feel in the browser, then fixed here).
 */
const SMOOTH_TIME_S = 0.1;

interface Flight {
  from: Pose;
  to: Pose;
  startedAt: number;
}

/** Where `controls` is going (its end values), as a pose. */
function currentPose(controls: CameraControls): Pose {
  controls.getPosition(scratchPosition, true);
  controls.getTarget(scratchTarget, true);
  return positionToPose(
    [scratchPosition.x, scratchPosition.y, scratchPosition.z],
    [scratchTarget.x, scratchTarget.y, scratchTarget.z],
  );
}

/** Puts the camera on `pose` at once; the controls' own smoothing is not involved. */
function placeCamera(controls: CameraControls, pose: Pose): void {
  const [x, y, z] = poseToPosition(pose);
  void controls.setLookAt(x, y, z, pose.target[0], pose.target[1], pose.target[2], false);
}

/** The width over the height of the part of the stage the campus has to fit in (the sheet takes some). */
function visibleAspect(width: number, height: number, inset: number): number {
  return height > 0 ? Math.max(1, width - inset) / height : 1;
}

interface RigProps {
  /** The campus, in scene metres; the pan box and the home view come from it. */
  bounds: Bounds;
}

/**
 * The 3D stage's camera (V2-12.9, ADR-0020 § Camera): drei's `CameraControls` with the brief's limits, the mouse
 * and touch mapping, our own fly-to, the sheet's view offset and the command API. It renders nothing itself.
 *
 * - **Limits** (brief § Camera limits): distance 60 – 900 m, tilt 20° – 78° from the vertical, the target held
 *   inside the site boundary + 40 m (`setBoundary`), wheel zoom toward the cursor, a response of about 300 ms.
 * - **Mouse:** drag orbits, right-drag or Shift-drag pans along the ground (`SCREEN_PAN`), wheel zooms.
 *   camera-controls has no modifier-key setting, so Shift switches the left button while it is held.
 *   **Touch:** one finger orbits, two fingers pan and pinch.
 * - **Fly-to** is a timed tween of ours (the library's transitions are smoothing, not a duration): per drawn
 *   frame, `flyPath` and `setLookAt`, 600 ms, ending exactly on the target; a drag or a touch cancels it; under
 *   reduced motion it is one frame. It runs before the controls update (priority −2 < −1) so each frame
 *   applies it at once.
 * - **Never moves by itself.** Nothing here starts a movement but a user action or a command (`twinCommands`),
 *   and the first view is set once, when the rig mounts, before the first paint.
 * - `frameloop="demand"`: the library asks for the next frame while it moves, the tween asks while it runs,
 *   and a resting stage draws nothing.
 */
export function Rig({ bounds }: RigProps) {
  const controls = useRef<CameraControls>(null);
  const flight = useRef<Flight | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const reduced = useRef(reducedMotion);
  const initialBounds = useRef(bounds);
  const get = useThree((state) => state.get);
  const pan = useMemo(() => panBounds(bounds), [bounds]);

  useSheetOffset();

  useEffect(() => {
    reduced.current = reducedMotion;
  }, [reducedMotion]);

  // The first view, before the first paint so the default camera is never drawn. Once: later changes of the
  // data or the stage's shape do not move a view the user may have set (acceptance criterion 5).
  useLayoutEffect(() => {
    const rig = controls.current;
    if (!rig) return;
    const { size, gl } = get();
    placeCamera(
      rig,
      homeView(
        initialBounds.current,
        visibleAspect(size.width, size.height, sheetInset(gl.domElement)),
      ),
    );
  }, [get]);

  // The target never leaves the site boundary + 40 m, and never goes under the ground or above the roofs.
  useEffect(() => {
    const rig = controls.current;
    if (!rig) return;
    rig.setBoundary(
      new Box3(
        new Vector3(pan.minX, 0, pan.minZ),
        new Vector3(pan.maxX, CAMERA_LIMITS.targetMaxHeightM, pan.maxZ),
      ),
    );
  }, [pan]);

  // Mouse and touch. The nested objects are set on the instance (the library reads them through its own setters).
  useEffect(() => {
    const rig = controls.current;
    if (!rig) return;
    rig.mouseButtons.left = ACTION.ROTATE;
    rig.mouseButtons.right = ACTION.SCREEN_PAN;
    rig.mouseButtons.wheel = ACTION.DOLLY;
    rig.mouseButtons.middle = ACTION.DOLLY;
    rig.touches.one = ACTION.TOUCH_ROTATE;
    // Pinch and pan along the ground. The library's readme lists `TOUCH_DOLLY_SCREEN_PAN` for two fingers but its
    // typings leave it out of the union, so the cast only satisfies the type checker (`unverified` on a device).
    rig.touches.two = ACTION.TOUCH_DOLLY_SCREEN_PAN as typeof ACTION.TOUCH_DOLLY_TRUCK;
    rig.touches.three = ACTION.TOUCH_SCREEN_PAN;

    const shiftPans = (held: boolean) => {
      rig.mouseButtons.left = held ? ACTION.SCREEN_PAN : ACTION.ROTATE;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Shift') shiftPans(event.type === 'keydown');
    };
    const onBlur = () => shiftPans(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // A drag or a touch takes the camera back from a fly-to. (The wheel does not emit this event; a wheel turn in
  // the 600 ms is overridden by the tween's next frame.)
  useEffect(() => {
    const rig = controls.current;
    if (!rig) return;
    const cancel = () => {
      flight.current = null;
    };
    rig.addEventListener('controlstart', cancel);
    return () => rig.removeEventListener('controlstart', cancel);
  }, []);

  // The command API, for everything outside the canvas.
  useEffect(() => {
    const rig = controls.current;
    if (!rig) return;

    const flyTo = (to: Pose) => {
      const goal = limitPose(to, pan);
      if (reduced.current) {
        flight.current = null;
        placeCamera(rig, goal);
        get().invalidate();
        return;
      }
      flight.current = { from: currentPose(rig), to: goal, startedAt: performance.now() };
      get().invalidate();
    };
    const home = (): Pose => {
      const { size, gl } = get();
      return homeView(bounds, visibleAspect(size.width, size.height, sheetInset(gl.domElement)));
    };

    return registerTwinCommands({
      flyTo: ({ target, distance, yaw, tilt }) => {
        const now = currentPose(rig);
        flyTo({
          target,
          distance: distance ?? now.distance,
          yaw: yaw ?? now.yaw,
          tilt: tilt ?? now.tilt,
        });
      },
      home: () => flyTo(home()),
      zoomBy: (factor) => {
        flight.current = null;
        void rig.dollyTo(currentPose(rig).distance * factor, true);
      },
      rotateBy: (degrees) => {
        flight.current = null;
        void rig.rotate(MathUtils.degToRad(degrees), 0, true);
      },
      faceNorth: () => flyTo({ ...currentPose(rig), yaw: 0 }),
      current: () => currentPose(rig),
    });
  }, [bounds, pan, get]);

  // The fly-to. Priority −2: before the controls' own update (−1), so the pose set here is applied in this frame.
  useFrame((state) => {
    const rig = controls.current;
    const current = flight.current;
    if (!rig || !current) return;
    const progress = flyProgress(performance.now() - current.startedAt, FLY_MS);
    placeCamera(rig, flyPath(current.from, current.to, progress));
    if (progress >= 1) flight.current = null;
    else state.invalidate();
  }, -2);

  return (
    <CameraControls
      ref={controls}
      makeDefault
      minDistance={CAMERA_LIMITS.campus.minDistance}
      maxDistance={CAMERA_LIMITS.campus.maxDistance}
      minPolarAngle={MathUtils.degToRad(CAMERA_LIMITS.minTiltDeg)}
      maxPolarAngle={MathUtils.degToRad(CAMERA_LIMITS.maxTiltDeg)}
      dollyToCursor
      smoothTime={SMOOTH_TIME_S}
    />
  );
}
