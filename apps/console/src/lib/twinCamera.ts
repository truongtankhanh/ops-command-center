import type { SceneLevel } from './twinLevel';
import type { Bounds } from './twinScene';

/*
 * The 3D stage's camera as plain arithmetic (V2-12.9): its limits, the pose it is described by, the home view
 * that fits the campus, the fly-to path and the sheet's view offset. No `three` and no WebGL, so the numbers
 * the rig depends on are tested without them (ADR-0020). `twin/Rig.tsx` is the one thing that talks to the
 * camera controls; everything it needs to decide is decided here.
 *
 * A pose is where the camera looks and from where: `target`, `distance`, `yaw` and `tilt`, in **degrees**
 * (the brief and the prototype speak degrees; radians appear only where `camera-controls` is called). The
 * camera stands at `target + distance · (sin(tilt)·sin(yaw), cos(tilt), sin(tilt)·cos(yaw))` in scene axes
 * (x east, y up, z south): `yaw` is the controls' azimuth and `tilt` their polar angle, measured from the
 * vertical. Yaw 0 puts the camera south of the target looking north, so north is up on the screen; yaw 45° is
 * south-east, the home view (TwinScene `initialCam()`, frame 01).
 */

export type Vec3 = [x: number, y: number, z: number];

export interface Pose {
  target: Vec3;
  /** Metres from the target to the camera. */
  distance: number;
  /** Degrees; 0 is south of the target, 90 is east of it. */
  yaw: number;
  /** Degrees from the vertical: 0 looks straight down, 90 looks along the ground. */
  tilt: number;
}

/** The lens, shared by the canvas and the home fit so they cannot disagree. */
export const HOME_FOV_DEG = 50;
export const HOME_YAW_DEG = 45;
export const HOME_TILT_DEG = 55;
/** How much of the view's half-size is left empty around the campus at home. */
export const HOME_MARGIN = 0.08;

/** A fly-to lasts this long (brief § Camera limits); under reduced motion it lasts no time. */
export const FLY_MS = 600;

/**
 * One zoom step's share of the distance (frame 01): coming closer is 0.8 of it, going away 1.25 of it. Shared by the
 * on-screen buttons and the `+` / `-` keys (V2-18.3), which would otherwise drift. They multiply the **distance**, as
 * `twinCommands.zoomBy` takes them: the prototype's key table writes the same steps as a scale, the other way round.
 */
export const ZOOM_IN_FACTOR = 0.8;
export const ZOOM_OUT_FACTOR = 1.25;

/** Brief § Camera limits. */
export const CAMERA_LIMITS = {
  campus: { minDistance: 60, maxDistance: 900 },
  /** An isolated asset and its parts (V2-15.7): the fit is recomputed from the asset's bounds inside these. */
  asset: { minDistance: 4, maxDistance: 40 },
  /** Never under the ground, never flat (V2-12.1: 78° from vertical is 12° above the ground). */
  minTiltDeg: 20,
  maxTiltDeg: 78,
  /**
   * How high the camera's target may be. The pan box (`panBounds`) is a rectangle on the ground; a roof
   * (24 m for the tallest demo building, equipment a few metres more) must be reachable. `unverified`.
   */
  targetMaxHeightM: 60,
} as const;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A model switches to its LOD1 once its bounding sphere is below this share of the screen's height (brief § Model contract). */
export const LOD_SCREEN_FRACTION = 0.05;

/**
 * How far back the switch has to be undone, as a share of the switch distance (three's `hysteresis`): LOD1 is shown from
 * the distance `d` and LOD0 comes back only below `0.9 d`, so a camera resting near the line does not toggle the level
 * at every small move. `unverified` until looked at in a browser; one line to change.
 */
export const LOD_HYSTERESIS = 0.1;

/**
 * The camera distance at which a sphere of `radius` metres spans `fraction` of the screen's height (V2-19.5): the
 * distance a model switches to its LOD1. A sphere's projected height is `radius / (d · tan(fov / 2))` of the view's
 * (its diameter over the view's height at `d`), so `d = radius / (fraction · tan(fov / 2))`. The viewport's size in pixels
 * does not enter: "screen height" is a share of it. three measures the distance to the LOD's origin (the base's centre
 * of the model), not to the sphere's centre; at these ranges the difference is 1 – 2 % and is not corrected.
 *
 * `Infinity` ("never LOD1") for a radius, a field of view (degrees) or a fraction that is not a positive finite number,
 * as `fitDistance` answers a bad aspect.
 */
export function lodDistance(
  radius: number,
  fovDeg: number,
  fraction: number = LOD_SCREEN_FRACTION,
): number {
  const valid = [radius, fovDeg, fraction].every((value) => Number.isFinite(value) && value > 0);
  if (!valid || fovDeg >= 180) return Infinity;
  return radius / (fraction * Math.tan(toRadians(fovDeg) / 2));
}

/** `degrees` as an angle in (−180, 180]: 190 is −170, −180 is 180. */
export function normalizeYaw(degrees: number): number {
  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/**
 * The yaw of a camera that looks along the ground direction `(x, z)` (the horizontal part of its forward
 * vector): north (−z) is 0, west is 90, south is 180. A camera looking straight down has no direction on
 * the ground and reads as 0. This is what the compass shows, and it needs no target.
 */
export function yawOfDirection(x: number, z: number): number {
  if (x === 0 && z === 0) return 0;
  return normalizeYaw(toDegrees(Math.atan2(-x, -z)));
}

/**
 * The compass's accessible name for a view rotated `yaw` degrees: "Face north" when it already faces north
 * (to the whole degree), else it says by how much it is turned (frame 00: "Face north — the view is rotated
 * 60°"). Without a direction word, as the frame has it.
 */
export function compassLabel(yaw: number): string {
  const whole = Math.round(normalizeYaw(yaw));
  return whole === 0 ? 'Face north' : `Face north — the view is rotated ${Math.abs(whole)}°`;
}

/** Where the camera stands for `pose`. */
export function poseToPosition({ target, distance, yaw, tilt }: Pose): Vec3 {
  const horizontal = distance * Math.sin(toRadians(tilt));
  return [
    target[0] + horizontal * Math.sin(toRadians(yaw)),
    target[1] + distance * Math.cos(toRadians(tilt)),
    target[2] + horizontal * Math.cos(toRadians(yaw)),
  ];
}

/** The pose of a camera standing at `position` and looking at `target`; `yaw` in (−180, 180]. */
export function positionToPose(position: Vec3, target: Vec3): Pose {
  const [dx, dy, dz] = [position[0] - target[0], position[1] - target[1], position[2] - target[2]];
  const distance = Math.hypot(dx, dy, dz);
  return {
    target: [...target],
    distance,
    yaw: toDegrees(Math.atan2(dx, dz)),
    tilt: distance === 0 ? 0 : toDegrees(Math.acos(clamp(dy / distance, -1, 1))),
  };
}

/**
 * The smallest distance at which the four ground corners of `bounds` all sit inside the view with `margin`
 * of its half-size to spare, for a camera looking at the middle of the box from `angles`. This is the
 * prototype's `fitScale` (it fits the projected corners, not a circle around them): at a 55° tilt the ground
 * is foreshortened, so a corner fit is closer than a bounding circle and fills the stage. `aspect` is the
 * width over the height of the part of the stage that shows the campus (the sheet leaves less of it).
 * Found by bisection on a pinhole projection; `Infinity` for an aspect that is not positive.
 *
 * With a `heightM` above zero the box is a building: its four top corners must fit too and the camera looks
 * at the middle of its height (V2-15.6), or a roof seen from above would lose its edge. With `0`, the
 * default, it is the ground rectangle above and nothing about the answer changes. `baseM` lifts the whole box
 * off the ground (an asset on a roof, V2-15.7); the answer depends on the box's size, not on how high it
 * stands, so it matters only to where the camera looks.
 */
export function fitDistance(
  bounds: Bounds,
  fov: number,
  aspect: number,
  angles: { yaw: number; tilt: number } = { yaw: HOME_YAW_DEG, tilt: HOME_TILT_DEG },
  margin: number = HOME_MARGIN,
  heightM = 0,
  baseM = 0,
): number {
  if (!(aspect > 0) || !(fov > 0)) return Infinity;
  const top = heightM > 0 ? heightM : 0;
  const centre: Vec3 = [
    (bounds.minX + bounds.maxX) / 2,
    baseM + top / 2,
    (bounds.minZ + bounds.maxZ) / 2,
  ];
  const ground: Vec3[] = [
    [bounds.minX, baseM, bounds.minZ],
    [bounds.maxX, baseM, bounds.minZ],
    [bounds.maxX, baseM, bounds.maxZ],
    [bounds.minX, baseM, bounds.maxZ],
  ];
  const corners: Vec3[] =
    top > 0 ? [...ground, ...ground.map(([x, , z]): Vec3 => [x, baseM + top, z])] : ground;
  const tanV = Math.tan(toRadians(fov) / 2);
  const tanH = tanV * aspect;
  const yaw = toRadians(angles.yaw);
  // Screen-right on the ground for this yaw (x east at yaw 0), and the camera's own axes.
  const right: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)];

  const fits = (distance: number): boolean => {
    const position = poseToPosition({
      target: centre,
      distance,
      yaw: angles.yaw,
      tilt: angles.tilt,
    });
    const length = Math.hypot(...centre.map((c, i) => c - position[i]!));
    const forward = centre.map((c, i) => (c - position[i]!) / length) as Vec3;
    // up = right × forward
    const up: Vec3 = [
      right[1] * forward[2] - right[2] * forward[1],
      right[2] * forward[0] - right[0] * forward[2],
      right[0] * forward[1] - right[1] * forward[0],
    ];
    return corners.every((corner) => {
      const v = corner.map((c, i) => c - position[i]!) as Vec3;
      const depth = v[0] * forward[0] + v[1] * forward[1] + v[2] * forward[2];
      if (depth <= 0) return false;
      const x = v[0] * right[0] + v[1] * right[1] + v[2] * right[2];
      const y = v[0] * up[0] + v[1] * up[1] + v[2] * up[2];
      return (
        Math.abs(x) / (depth * tanH) <= 1 - margin && Math.abs(y) / (depth * tanV) <= 1 - margin
      );
    });
  };

  let near = 0;
  let far = 1;
  while (!fits(far)) {
    near = far;
    far *= 2;
    if (far > 1e7) return Infinity;
  }
  for (let step = 0; step < 60; step += 1) {
    const middle = (near + far) / 2;
    if (fits(middle)) far = middle;
    else near = middle;
  }
  return far;
}

/**
 * The first view, and Home: the middle of the campus on the ground, seen from the south-east at 55°, from
 * as close as shows all of it, held within the campus limits. A stage too narrow for the campus is clamped
 * at 900 m and cuts it, as the brief's ceiling says.
 */
export function homeView(bounds: Bounds, aspect: number): Pose {
  const { minDistance, maxDistance } = CAMERA_LIMITS.campus;
  return {
    target: [(bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2],
    distance: clamp(fitDistance(bounds, HOME_FOV_DEG, aspect), minDistance, maxDistance),
    yaw: HOME_YAW_DEG,
    tilt: HOME_TILT_DEG,
  };
}

/** A box to look at: a footprint and how tall it stands. A building or an asset, as the camera fits it. */
export interface FitBox {
  bounds: Bounds;
  /** Metres from the base to the top; `0` is a flat rectangle, as the campus is. */
  heightM: number;
  /** Metres from the ground to the base (V2-15.7: an asset on a roof); `0` or absent is on the ground, as a building. */
  baseM?: number;
}

/**
 * The view that fits `bounds` standing `heightM` tall (V2-15.6): the camera looks at the middle of the box, from
 * the home angles, from as close as shows all eight corners, held within the campus limits (a building small
 * enough to be fitted nearer than 60 m is shown from 60). With a height of `0` it is `homeView`, which is what
 * makes Home "the fit of the campus level". `aspect` is the visible part of the stage's, as for `homeView`.
 */
export function fitBounds(
  bounds: Bounds,
  aspect: number,
  heightM = 0,
  margin: number = HOME_MARGIN,
): Pose {
  const { minDistance, maxDistance } = CAMERA_LIMITS.campus;
  const top = heightM > 0 ? heightM : 0;
  return {
    target: [(bounds.minX + bounds.maxX) / 2, top / 2, (bounds.minZ + bounds.maxZ) / 2],
    distance: clamp(
      fitDistance(
        bounds,
        HOME_FOV_DEG,
        aspect,
        { yaw: HOME_YAW_DEG, tilt: HOME_TILT_DEG },
        margin,
        top,
      ),
      minDistance,
      maxDistance,
    ),
    yaw: HOME_YAW_DEG,
    tilt: HOME_TILT_DEG,
  };
}

/** How close and how far the camera may be from its target. */
export interface DistanceLimits {
  minDistance: number;
  maxDistance: number;
}

/**
 * The distance limits of a level (brief § Camera limits): an isolated asset and its parts are looked at from 4 to
 * 40 m, everything else from 60 to 900 m. The rig applies them to the controls and to `limitPose`.
 */
export function distanceLimitsOf(level: SceneLevel): DistanceLimits {
  return level === 'asset' || level === 'part' ? CAMERA_LIMITS.asset : CAMERA_LIMITS.campus;
}

/**
 * The widest range both `a` and `b` allow. The rig uses it while it flies between two levels, so the controls never
 * clamp a camera that is still on its way into the new range (a jump), and then narrows to the new level's own.
 */
export function unionLimits(a: DistanceLimits, b: DistanceLimits): DistanceLimits {
  return {
    minDistance: Math.min(a.minDistance, b.minDistance),
    maxDistance: Math.max(a.maxDistance, b.maxDistance),
  };
}

/**
 * The view that fits an isolated asset (V2-15.7): the camera looks at the middle of its box, which stands on
 * its base elevation, from the operator's own yaw and tilt (a fit is not a reset of the view; the tilt is held
 * within the camera's range), from as close as shows all eight corners, within the asset limits. A box so small
 * that it would fit nearer than 4 m is shown from 4 (the near plane and the model's detail say so), and a huge
 * one is held at 40. `aspect` is the visible part of the stage's, as for `homeView`.
 */
export function fitAssetView(
  box: FitBox,
  aspect: number,
  angles: { yaw: number; tilt: number },
  margin: number = HOME_MARGIN,
): Pose {
  const { minDistance, maxDistance } = CAMERA_LIMITS.asset;
  const height = box.heightM > 0 ? box.heightM : 0;
  const baseM = box.baseM ?? 0;
  const tilt = clamp(angles.tilt, CAMERA_LIMITS.minTiltDeg, CAMERA_LIMITS.maxTiltDeg);
  return {
    target: [
      (box.bounds.minX + box.bounds.maxX) / 2,
      baseM + height / 2,
      (box.bounds.minZ + box.bounds.maxZ) / 2,
    ],
    distance: clamp(
      fitDistance(
        box.bounds,
        HOME_FOV_DEG,
        aspect,
        { yaw: angles.yaw, tilt },
        margin,
        height,
        baseM,
      ),
      minDistance,
      maxDistance,
    ),
    yaw: angles.yaw,
    tilt,
  };
}

/** `target` held inside `pan` (x and z) and between the ground and `targetMaxHeightM` (y). */
export function clampTarget(target: Vec3, pan: Bounds): Vec3 {
  return [
    clamp(target[0], pan.minX, pan.maxX),
    clamp(target[1], 0, CAMERA_LIMITS.targetMaxHeightM),
    clamp(target[2], pan.minZ, pan.maxZ),
  ];
}

/**
 * `pose` brought inside what the camera can do: the target inside the pan box, the distance within `limits`
 * (the campus's 60 – 900 m unless the level says otherwise, `distanceLimitsOf`), the tilt between 20° and 78°. A
 * command aims where it likes; this is what keeps the fly-to from heading for a place a drag could never reach,
 * so the tween ends exactly where the controls will leave it (they clamp the same way).
 */
export function limitPose(
  pose: Pose,
  pan: Bounds,
  limits: DistanceLimits = CAMERA_LIMITS.campus,
): Pose {
  const { minDistance, maxDistance } = limits;
  return {
    target: clampTarget(pose.target, pan),
    distance: clamp(pose.distance, minDistance, maxDistance),
    yaw: pose.yaw,
    tilt: clamp(pose.tilt, CAMERA_LIMITS.minTiltDeg, CAMERA_LIMITS.maxTiltDeg),
  };
}

/**
 * How far the camera stands from an incident's beacon after "Fly to" at the most (V2-16.1, V2-16.5): the current
 * distance is kept when it is nearer, so the beacon is seen in its surroundings and not from the campus view.
 * `unverified`: judged by eye in the browser, then fixed here.
 */
export const INCIDENT_FLY_DISTANCE_M = 120;

/**
 * Where the camera goes for an incident's beacon (V2-16.5): looking at the beacon's ground point (the foot of its
 * stem), from the camera's own yaw and tilt, from where it is now but no farther than `INCIDENT_FLY_DISTANCE_M`.
 * Not limited here: the rig flies it through `limitPose`, which raises a distance under the level's floor (60 m at
 * campus and building level) and keeps the target inside the pan box.
 */
export function incidentView(position: Vec3, now: Pose): Pose {
  return {
    target: [...position],
    distance: Math.min(now.distance, INCIDENT_FLY_DISTANCE_M),
    yaw: now.yaw,
    tilt: now.tilt,
  };
}

/** Cubic ease-out: quick at first, settling at the end. */
export const ease = (t: number): number => 1 - (1 - clamp(t, 0, 1)) ** 3;

/** The signed shortest turn from `from` to `to`, in degrees, in (−180, 180]. */
const shortestTurn = (from: number, to: number): number => {
  const turn = ((((to - from) % 360) + 540) % 360) - 180;
  return turn === -180 ? 180 : turn;
};

/**
 * Where the camera is `t` (0 … 1) of the way from `from` to `to`: the target and the distance move in a
 * straight line, the yaw takes the shortest way round, all with the ease-out. At `t = 1` it is exactly `to`.
 */
export function flyPath(from: Pose, to: Pose, t: number): Pose {
  if (t >= 1) return { ...to, target: [...to.target] };
  const e = ease(t);
  return {
    target: [
      from.target[0] + (to.target[0] - from.target[0]) * e,
      from.target[1] + (to.target[1] - from.target[1]) * e,
      from.target[2] + (to.target[2] - from.target[2]) * e,
    ],
    distance: from.distance + (to.distance - from.distance) * e,
    yaw: from.yaw + shortestTurn(from.yaw, to.yaw) * e,
    tilt: from.tilt + (to.tilt - from.tilt) * e,
  };
}

/** How far a fly-to of `durationMs` has got after `elapsedMs`, 0 … 1; a fly-to of no time is done. */
export const flyProgress = (elapsedMs: number, durationMs: number): number =>
  durationMs <= 0 ? 1 : clamp(elapsedMs / durationMs, 0, 1);

/** The arguments of `PerspectiveCamera.setViewOffset`. */
export interface ViewOffset {
  fullWidth: number;
  fullHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Shifts the picture left by half of `sheetInset` px, so the point the camera looks at sits in the middle of
 * the part of the stage the open sheet leaves visible, `(width − inset) / 2` from the left. `null` for no
 * offset: no sheet, or one that covers the whole stage (the phone layout).
 */
export function viewOffset(
  stageWidth: number,
  stageHeight: number,
  sheetInset: number,
): ViewOffset | null {
  if (!(stageWidth > 0) || !(stageHeight > 0) || !(sheetInset > 0) || sheetInset >= stageWidth) {
    return null;
  }
  return {
    fullWidth: stageWidth,
    fullHeight: stageHeight,
    x: sheetInset / 2,
    y: 0,
    width: stageWidth,
    height: stageHeight,
  };
}
