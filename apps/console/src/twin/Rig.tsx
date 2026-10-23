import { CameraControls, CameraControlsImpl } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Box3, MathUtils, Vector3 } from 'three';
import type { Beacon } from '../lib/twinBeacons';
import { usePrefersReducedMotion } from '../lib/shared/usePrefersReducedMotion';
import {
  CAMERA_LIMITS,
  type DistanceLimits,
  distanceLimitsOf,
  FLY_MS,
  flyPath,
  fitAssetView,
  fitBounds,
  type FitBox,
  flyProgress,
  HOME_FOV_DEG,
  HOME_TILT_DEG,
  HOME_YAW_DEG,
  homeView,
  incidentView,
  limitPose,
  type Pose,
  poseToPosition,
  positionToPose,
  unionLimits,
  type Vec3,
} from '../lib/twinCamera';
import { PENDING_SHOW_MS, registerTwinCommands, twinCommands } from '../lib/twinCommands';
import { levelOf } from '../lib/twinLevel';
import { holdDelta, padStep } from '../lib/twinPan';
import { startAssetBoxOf, startBoxOf } from '../lib/twinLevelCamera';
import { type Bounds, panBounds } from '../lib/twinScene';
import { useConsole } from '../store';
import { useReportFrameDemand } from './FrameDemandContext';
import { sheetInset, sheetInsetOpen, useSheetOffset } from './useSheetOffset';

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
  /** The distance limits the controls take once it has landed (the level it flies to, V2-15.7). */
  limits: DistanceLimits;
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

/** Gives `controls` the distance limits `limits` (V2-15.7: they follow the level). */
function applyLimits(controls: CameraControls, limits: DistanceLimits): void {
  controls.minDistance = limits.minDistance;
  controls.maxDistance = limits.maxDistance;
}

/** The distance limits of the level the store is at: the one a command that just changed it is flying to. */
const limitsNow = (): DistanceLimits => distanceLimitsOf(levelOf(useConsole.getState()));

/** The width over the height of the part of the stage the campus has to fit in (the sheet takes some). */
function visibleAspect(width: number, height: number, inset: number): number {
  return height > 0 ? Math.max(1, width - inset) / height : 1;
}

interface RigProps {
  /** The campus, in scene metres; the pan box and the home view come from it. */
  bounds: Bounds;
  /**
   * The box of every building (`buildingBoxes`): read once, for the first view when the stage starts at building
   * level (V2-15.6). Later fits are asked for with `twinCommands.fit`, which carries its own box.
   */
  boxes: ReadonlyMap<string, FitBox>;
  /** The box of every asset (`assetBoxes`): read once, for the first view when the stage starts with an asset isolated (V2-15.7). */
  assetBoxes: ReadonlyMap<string, FitBox>;
  /**
   * The incident beacons the stage draws (`useTwinBeacons`), for "Fly to" (V2-16.5): `flyToIncident(id)` flies to the
   * ground point of the one with that id. They change as incidents come and go, so the rig reads the latest at the
   * moment of the command and does not register its commands again for each change.
   */
  beacons: readonly Pick<Beacon, 'id' | 'position'>[];
  /**
   * The video wall's rig (V2-21.6): the controls take no input at all (no wheel, drag, touch or Shift), and the view is
   * fitted again when the stage's shape changes, because nobody is there to set it. The commands still work.
   */
  locked?: boolean;
}

/**
 * The 3D stage's camera (V2-12.9, ADR-0020 § Camera): drei's `CameraControls` with the brief's limits, the mouse
 * and touch mapping, our own fly-to, the sheet's view offset and the command API. It renders nothing itself.
 *
 * - **Limits** (brief § Camera limits): distance 60 – 900 m (4 – 40 m while an asset is isolated: they follow the
 *   level, `distanceLimitsOf`), tilt 20° – 78° from the vertical, the target held inside the site boundary + 40 m
 *   (`setBoundary`), wheel zoom toward the cursor, a response of about 300 ms. The controls take a level's
 *   distance limits when a flight to it has landed (and at the first view); during the flight they allow both
 *   levels' range, or the library would clamp a camera still far from the new range in a jump.
 * - **Mouse:** with the Orbit tool (the default) a drag orbits and with the Pan tool (`panTool` in the store, V3-29) a drag
 *   pans along the ground (`SCREEN_PAN`); `Shift` held does the other one, so the modifier always means "the other tool".
 *   Right-drag pans and the wheel zooms in both. camera-controls has no modifier-key setting, so the rig switches the left
 *   button while `Shift` is held. **Touch:** one finger orbits (pans with the Pan tool), two fingers pan and pinch.
 * - **Fly-to** is a timed tween of ours (the library's transitions are smoothing, not a duration): per drawn
 *   frame, `flyPath` and `setLookAt`, 600 ms, ending exactly on the target; a drag or a touch cancels it; under
 *   reduced motion it is one frame. It runs before the controls update (priority −2 < −1) so each frame
 *   applies it at once.
 * - **Never moves by itself.** Nothing here starts a movement but a user action or a command (`twinCommands`),
 *   and the first view is set once, when the rig mounts, before the first paint: the home view, or the fit of the
 *   building in focus when the stage starts at building level, or the fit of the asset isolated when it starts
 *   at asset level (the store keeps the level while the operator is in 2D). `fit` flies to a building's box with
 *   the stage's aspect and the sheet's inset, as `home` does; `fitAsset` flies to an asset's box from the
 *   camera's own yaw and tilt, with the width the inspector will take (it opens in the same update).
 * - **Fly to an incident** (V2-16.5, `flyToIncident`) is a fly-to like the others: the beacon's ground point as the
 *   target, the camera's own yaw and tilt, no farther than 120 m (`incidentView`), through the same limits. On the console a
 *   flight is only ever asked for by a person (the toast's "Fly to"): an incident that arrives moves nothing. A locked rig
 *   (the wall, V2-21.8) is asked by `useWallFocus` the moment a critical incident arrives, which can be before the beacon has
 *   reached this canvas, so there the request waits up to `PENDING_SHOW_MS` for the beacon, and `home` cancels it.
 * - **Show asset** (V2-16.6, `showAsset`) frames an asset without isolating it: the asset fit's view (its box's middle, the
 *   camera's own yaw and tilt) flown through the level's limits, so from at least 60 m. A request made before this rig
 *   existed (the switch from 2D) runs when it registers (`lib/twinCommands.ts`). It selects nothing and moves nothing
 *   by itself.
 * - **The keys** (V2-18.3) reach the camera through `rotateBy`, `tiltBy`, `panBy` and `zoomBy`: relative, smoothed moves that
 *   take the camera back from a fly-to and inherit the limits above (`unverified`: the feel of the steps, by eye).
 * - **The pad** (V3-29) reaches it through `panStep` (one press: a share of the visible ground width, gliding), `panHold` (a
 *   held press: a continuous move each frame, with no easing tail, until it is let go) and `centreOn` (the target to an
 *   asset's box or an incident's beacon, the distance, yaw and tilt kept). All go through the pan box, so the view stops at
 *   the site's edge. Under reduced motion a step lands at once; a held move is the operator's own action and still moves.
 * - **Locked** (V2-21.6, the video wall): `CameraControls` is disabled, so a stray wheel, drag or touch does nothing, and no
 *   mouse mapping or Shift listener is set up. Nothing moves the camera but a command (`twinCommands`: V2-21.8's flight), and
 *   there is no idle rotation. The first view is the home view for the stage's own shape, and a change of that shape (the
 *   window moved to a bigger screen) fits it again, once per change, with one `invalidate()`.
 * - `frameloop="demand"`: the library asks for the next frame while it moves, the tween asks while it runs,
 *   and a resting stage draws nothing. Frame demand: the library invalidates on its own `update` event; the tween
 *   reports `demand.flying` while it runs (`FrameDriver` asks for the frames) and the command API calls `invalidate()`
 *   once when a flight begins or a reduced-motion jump lands.
 */
export function Rig({ bounds, boxes, assetBoxes, beacons, locked = false }: RigProps) {
  const controls = useRef<CameraControls>(null);
  const flight = useRef<Flight | null>(null);
  const reportDemand = useReportFrameDemand();
  // A loop that goes away must not leave its flag up: nothing would ever write it down, and the driver would draw forever.
  useEffect(
    () => () => {
      reportDemand('flying', false);
    },
    [reportDemand],
  );
  const reducedMotion = usePrefersReducedMotion();
  const reduced = useRef(reducedMotion);
  const panTool = useConsole((state) => state.panTool);
  // `Shift` held flips the tool for the left button; kept here so a change of tool keeps it right (V3-29).
  const shiftHeld = useRef(false);
  // The pad's held direction, a unit vector (`twinCommands.panHold`), or `null`.
  const hold = useRef<{ dx: number; dy: number } | null>(null);
  const initialBounds = useRef(bounds);
  const initialBoxes = useRef(boxes);
  const initialAssetBoxes = useRef(assetBoxes);
  const latestBeacons = useRef(beacons);
  const latestAssetBoxes = useRef(assetBoxes);
  const get = useThree((state) => state.get);
  const pan = useMemo(() => panBounds(bounds), [bounds]);
  const { width, height } = useThree((state) => state.size);
  // The shape the view was last fitted for; a locked rig fits again when it changes.
  const fittedFor = useRef({ width, height });

  useSheetOffset();

  useEffect(() => {
    reduced.current = reducedMotion;
  }, [reducedMotion]);

  // A locked rig (the wall) is asked to fly to an incident the moment it arrives, which can be before its beacon reaches
  // this canvas: the request waits here for the beacon instead of being lost (V2-21.8). Never set on the console.
  const wantedIncident = useRef<{ id: string; at: number } | null>(null);
  useEffect(() => {
    latestBeacons.current = beacons;
    const wanted = wantedIncident.current;
    if (wanted === null) return;
    if (Date.now() - wanted.at > PENDING_SHOW_MS) wantedIncident.current = null;
    else if (beacons.some((beacon) => beacon.id === wanted.id))
      twinCommands.flyToIncident(wanted.id);
  }, [beacons]);

  // The latest boxes, for "Show in 3D": a request that was waiting for this rig runs as its commands register, below.
  useEffect(() => {
    latestAssetBoxes.current = assetBoxes;
  }, [assetBoxes]);

  // The first view, before the first paint so the default camera is never drawn. Once: later changes of the
  // data or the stage's shape do not move a view the user may have set (acceptance criterion 5).
  useLayoutEffect(() => {
    const rig = controls.current;
    if (!rig) return;
    const { size, gl } = get();
    const aspect = visibleAspect(size.width, size.height, sheetInset(gl.domElement));
    const state = useConsole.getState();
    const asset = startAssetBoxOf(state, initialAssetBoxes.current);
    const building = startBoxOf(state, initialBoxes.current);
    if (asset !== null) {
      // The inspector is open for the selection that is kept, so the stage is already narrower.
      const beside = visibleAspect(
        size.width,
        size.height,
        Math.max(sheetInset(gl.domElement), sheetInsetOpen(gl.domElement)),
      );
      placeCamera(rig, fitAssetView(asset, beside, { yaw: HOME_YAW_DEG, tilt: HOME_TILT_DEG }));
    } else if (building !== null) {
      placeCamera(rig, fitBounds(building.bounds, aspect, building.heightM));
    } else {
      placeCamera(rig, homeView(initialBounds.current, aspect));
    }
    applyLimits(rig, limitsNow());
  }, [get]);

  // A wall's view is the home view, and nobody can set another: when the stage's shape changes, fit it again.
  useEffect(() => {
    const rig = controls.current;
    const last = fittedFor.current;
    if (!locked || !rig || (last.width === width && last.height === height)) return;
    fittedFor.current = { width, height };
    placeCamera(rig, homeView(initialBounds.current, visibleAspect(width, height, 0)));
    get().invalidate();
  }, [locked, width, height, get]);

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
  // The left button pans when exactly one of "the Pan tool is on" and "Shift is held" is true (V3-29): Shift always means
  // the other tool. A finger has no Shift, so one finger follows the tool alone.
  useEffect(() => {
    const rig = controls.current;
    if (!rig || locked) return;
    rig.mouseButtons.right = ACTION.SCREEN_PAN;
    rig.mouseButtons.wheel = ACTION.DOLLY;
    rig.mouseButtons.middle = ACTION.DOLLY;
    rig.touches.one = panTool ? ACTION.TOUCH_SCREEN_PAN : ACTION.TOUCH_ROTATE;
    // Pinch and pan along the ground. The library's readme lists `TOUCH_DOLLY_SCREEN_PAN` for two fingers but its
    // typings leave it out of the union, so the cast only satisfies the type checker (`unverified` on a device).
    rig.touches.two = ACTION.TOUCH_DOLLY_SCREEN_PAN as typeof ACTION.TOUCH_DOLLY_TRUCK;
    rig.touches.three = ACTION.TOUCH_SCREEN_PAN;

    const mapLeft = () => {
      rig.mouseButtons.left = panTool !== shiftHeld.current ? ACTION.SCREEN_PAN : ACTION.ROTATE;
    };
    mapLeft();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Shift') return;
      shiftHeld.current = event.type === 'keydown';
      mapLeft();
    };
    const onBlur = () => {
      shiftHeld.current = false;
      mapLeft();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [locked, panTool]);

  // A drag or a touch takes the camera back from a fly-to. (The wheel does not emit this event; a wheel turn in
  // the 600 ms is overridden by the tween's next frame.)
  useEffect(() => {
    const rig = controls.current;
    if (!rig) return;
    const cancel = () => {
      // The camera stays where the drag took it from; the controls take the range of the level it was flying to.
      if (flight.current !== null) applyLimits(rig, flight.current.limits);
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
      const limits = limitsNow();
      const goal = limitPose(to, pan, limits);
      if (reduced.current) {
        flight.current = null;
        applyLimits(rig, unionLimits(rig, limits));
        placeCamera(rig, goal);
        applyLimits(rig, limits);
        get().invalidate();
        return;
      }
      applyLimits(rig, unionLimits(rig, limits));
      flight.current = { from: currentPose(rig), to: goal, startedAt: performance.now(), limits };
      get().invalidate();
    };
    const aspect = (): number => {
      const { size, gl } = get();
      return visibleAspect(size.width, size.height, sheetInset(gl.domElement));
    };
    // An asset always opens its inspector, which is not on screen yet when this is asked for.
    const assetAspect = (): number => {
      const { size, gl } = get();
      const inset = Math.max(sheetInset(gl.domElement), sheetInsetOpen(gl.domElement));
      return visibleAspect(size.width, size.height, inset);
    };
    const home = (): Pose => homeView(bounds, aspect());

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
      home: () => {
        wantedIncident.current = null;
        flyTo(home());
      },
      fit: ({ bounds: box, heightM }) => flyTo(fitBounds(box, aspect(), heightM)),
      fitAsset: (box) => {
        const now = currentPose(rig);
        flyTo(fitAssetView(box, assetAspect(), { yaw: now.yaw, tilt: now.tilt }));
      },
      flyToIncident: (id) => {
        const beacon = latestBeacons.current.find((candidate) => candidate.id === id);
        if (beacon === undefined) {
          if (locked) wantedIncident.current = { id, at: Date.now() };
          return;
        }
        wantedIncident.current = null;
        flyTo(incidentView(beacon.position, currentPose(rig)));
      },
      showAsset: (code) => {
        const box = latestAssetBoxes.current.get(code);
        if (box === undefined) return;
        const now = currentPose(rig);
        // The isolated fit's view, flown at the level the store is at: no asset is isolated, so the campus limits raise it
        // to 60 m. The incident sheet is already open, so the stage's current inset is the right one (`aspect`).
        flyTo(fitAssetView(box, aspect(), { yaw: now.yaw, tilt: now.tilt }));
      },
      zoomBy: (factor) => {
        flight.current = null;
        void rig.dollyTo(currentPose(rig).distance * factor, true);
      },
      rotateBy: (degrees) => {
        flight.current = null;
        void rig.rotate(MathUtils.degToRad(degrees), 0, true);
      },
      // The keys' tilt and pan (V2-18.3). Like `rotateBy` they are relative to where the camera is going and smoothed, so a
      // held key is a run of small moves; the controls' polar limits and the pan box clamp them.
      tiltBy: (degrees) => {
        flight.current = null;
        void rig.rotate(0, MathUtils.degToRad(degrees), true);
      },
      panBy: (dx, dy) => {
        flight.current = null;
        // `truck` moves the target along the camera's right and `forward` along the ground, not along the view ray.
        // Under reduced motion it lands without the glide (V3-29 extends this to the keys too).
        const { distance } = currentPose(rig);
        const glide = !reduced.current;
        void rig.truck(dx * distance, 0, glide);
        void rig.forward(dy * distance, glide);
      },
      // The pad (V3-29). One press is a share of the visible ground width, the same on any stage and at any distance.
      panStep: (dx, dy) => {
        flight.current = null;
        const step = padStep(HOME_FOV_DEG, aspect());
        const { distance } = currentPose(rig);
        const glide = !reduced.current;
        void rig.truck(dx * step * distance, 0, glide);
        void rig.forward(dy * step * distance, glide);
      },
      // A held press: the direction is read by the frame loop below, which also asks the canvas for frames while it lasts.
      panHold: (direction) => {
        hold.current = direction;
        if (direction === null) {
          reportDemand('panning', false);
          return;
        }
        flight.current = null;
        reportDemand('panning', true);
        get().invalidate();
      },
      // The target goes to the middle of the asset's box or the incident's ground point; distance, yaw and tilt stay.
      centreOn: (target) => {
        let middle: Vec3 | null = null;
        if (target.kind === 'asset') {
          const box = latestAssetBoxes.current.get(target.code);
          if (box !== undefined) {
            middle = [
              (box.bounds.minX + box.bounds.maxX) / 2,
              (box.baseM ?? 0) + box.heightM / 2,
              (box.bounds.minZ + box.bounds.maxZ) / 2,
            ];
          }
        } else {
          const beacon = latestBeacons.current.find((candidate) => candidate.id === target.id);
          if (beacon !== undefined) {
            middle = [beacon.position[0], beacon.position[1], beacon.position[2]];
          }
        }
        if (middle !== null) flyTo({ ...currentPose(rig), target: middle });
      },
      faceNorth: () => flyTo({ ...currentPose(rig), yaw: 0 }),
      current: () => currentPose(rig),
    });
  }, [bounds, pan, get, locked, reportDemand]);

  // A hold never outlives the rig it was made on.
  useEffect(
    () => () => {
      hold.current = null;
      reportDemand('panning', false);
    },
    [reportDemand],
  );

  // The fly-to. Priority −2: before the controls' own update (−1), so the pose set here is applied in this frame.
  useFrame(() => {
    const rig = controls.current;
    const current = flight.current;
    if (!rig || !current) {
      reportDemand('flying', false);
      return;
    }
    const progress = flyProgress(performance.now() - current.startedAt, FLY_MS);
    placeCamera(rig, flyPath(current.from, current.to, progress));
    if (progress >= 1) {
      applyLimits(rig, current.limits);
      flight.current = null;
    }
    // `FrameDriver` asks for the next frame while the flight lasts; this runs below its priority (−2 < 0).
    reportDemand('flying', progress < 1);
  }, -2);

  // The pad's held move: each drawn frame moves the target by a share of the distance, without an easing tail. Priority -2
  // like the fly-to, so it lands in this frame; it asks for the next frame while a button is held (`FrameDriver`).
  useFrame((_, delta) => {
    const rig = controls.current;
    const held = hold.current;
    if (!rig || held === null) return;
    const move = holdDelta(held, delta);
    const { distance } = currentPose(rig);
    void rig.truck(move.dx * distance, 0, false);
    void rig.forward(move.dy * distance, false);
    reportDemand('panning', true);
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
      enabled={!locked}
    />
  );
}
