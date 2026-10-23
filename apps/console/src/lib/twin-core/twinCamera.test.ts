import {
  CAMERA_LIMITS,
  clampTarget,
  compassLabel,
  distanceLimitsOf,
  ease,
  fitAssetView,
  type FitBox,
  fitBounds,
  fitDistance,
  FLY_MS,
  flyPath,
  flyProgress,
  HOME_FOV_DEG,
  HOME_MARGIN,
  HOME_TILT_DEG,
  HOME_YAW_DEG,
  homeView,
  INCIDENT_FLY_DISTANCE_M,
  incidentView,
  limitPose,
  LOD_HYSTERESIS,
  LOD_SCREEN_FRACTION,
  lodDistance,
  normalizeYaw,
  type Pose,
  poseToPosition,
  positionToPose,
  unionLimits,
  viewOffset,
  yawOfDirection,
} from './twinCamera';
import { type Bounds, panBounds } from './twinScene';

// TwinScene.dc.html's campus box (the demo site).
const CAMPUS: Bounds = { minX: -282, maxX: 228, minZ: -247, maxZ: 277 };

// A 60 × 40 m footprint, the size of a demo building.
const BUILDING: Bounds = { minX: 100, maxX: 160, minZ: -60, maxZ: -20 };

const pose = (overrides: Partial<Pose> = {}): Pose => ({
  target: [0, 0, 0],
  distance: 100,
  yaw: 0,
  tilt: 55,
  ...overrides,
});

describe('the limits and the lens', () => {
  it('are the brief’s table', () => {
    expect(CAMERA_LIMITS.campus).toEqual({ minDistance: 60, maxDistance: 900 });
    expect(CAMERA_LIMITS.asset).toEqual({ minDistance: 4, maxDistance: 40 });
    expect(CAMERA_LIMITS.minTiltDeg).toBe(20);
    expect(CAMERA_LIMITS.maxTiltDeg).toBe(78);
    expect(FLY_MS).toBe(600);
  });

  it('start the home view south-east at 55° from vertical with a 50° lens', () => {
    expect([HOME_YAW_DEG, HOME_TILT_DEG, HOME_FOV_DEG, HOME_MARGIN]).toEqual([45, 55, 50, 0.08]);
  });
});

describe('poseToPosition and positionToPose', () => {
  it('stands the camera south-east and above the target at the home angles', () => {
    const [x, y, z] = poseToPosition(pose({ yaw: 45 }));

    expect(x).toBeCloseTo(100 * Math.sin((55 * Math.PI) / 180) * Math.SQRT1_2, 9);
    expect(z).toBeCloseTo(x, 9);
    expect(y).toBeCloseTo(100 * Math.cos((55 * Math.PI) / 180), 9);
  });

  it('puts yaw 0 south of the target, so north is up, and yaw 90 east of it', () => {
    const south = poseToPosition(pose({ yaw: 0, tilt: 90 }));
    const east = poseToPosition(pose({ yaw: 90, tilt: 90 }));

    expect(south[2]).toBeCloseTo(100, 9);
    expect(south[0]).toBeCloseTo(0, 9);
    expect(east[0]).toBeCloseTo(100, 9);
    expect(east[2]).toBeCloseTo(0, 9);
  });

  it('looks straight down at tilt 0, whatever the yaw', () => {
    const [x, y, z] = poseToPosition(pose({ tilt: 0, yaw: 130 }));

    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(100, 9);
    expect(z).toBeCloseTo(0, 9);
  });

  it('is the inverse of itself, about any target', () => {
    for (const yaw of [-170, -45, 0, 45, 170]) {
      for (const tilt of [20, 55, 78]) {
        const original = pose({ target: [10, 2, -30], distance: 321, yaw, tilt });

        const back = positionToPose(poseToPosition(original), original.target);

        expect(back.distance).toBeCloseTo(321, 9);
        expect(back.yaw).toBeCloseTo(yaw, 9);
        expect(back.tilt).toBeCloseTo(tilt, 9);
        expect(back.target).toEqual([10, 2, -30]);
      }
    }
  });

  it('survives a camera on top of its target', () => {
    expect(positionToPose([1, 2, 3], [1, 2, 3])).toMatchObject({ distance: 0, tilt: 0 });
  });
});

describe('fitDistance', () => {
  it('fits a square seen from straight above as the pinhole says: half the side over tan(fov/2), plus the margin', () => {
    const square: Bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
    const above = { yaw: 0, tilt: 0 };

    // A 90° lens at aspect 1: a corner 50 m off-axis is on the edge of the view at 50 m.
    expect(fitDistance(square, 90, 1, above, 0)).toBeCloseTo(50, 6);
    expect(fitDistance(square, 90, 1, above, 0.08)).toBeCloseTo(50 / 0.92, 6);
  });

  it('needs more distance for a narrower stage, a bigger box and a larger margin', () => {
    const wide = fitDistance(CAMPUS, HOME_FOV_DEG, 16 / 9);
    const square = fitDistance(CAMPUS, HOME_FOV_DEG, 1);
    const narrow = fitDistance(CAMPUS, HOME_FOV_DEG, 0.5);
    const small = fitDistance({ minX: -50, maxX: 50, minZ: -50, maxZ: 50 }, HOME_FOV_DEG, 16 / 9);
    const roomy = fitDistance(CAMPUS, HOME_FOV_DEG, 16 / 9, undefined, 0.2);

    expect(narrow).toBeGreaterThan(square);
    expect(square).toBeGreaterThan(wide);
    expect(small).toBeLessThan(wide);
    expect(roomy).toBeGreaterThan(wide);
  });

  it('is closer than a circle around the campus, because a 55° tilt foreshortens the ground', () => {
    const radius = Math.hypot(510, 524) / 2;
    const circle = radius / Math.sin((HOME_FOV_DEG * Math.PI) / 360);

    expect(fitDistance(CAMPUS, HOME_FOV_DEG, 16 / 9)).toBeLessThan(circle);
  });

  it('is nothing for a box with no size, and unbounded for a stage with no width', () => {
    expect(fitDistance({ minX: 5, maxX: 5, minZ: 5, maxZ: 5 }, 50, 1.5)).toBeLessThan(1e-6);
    expect(fitDistance(CAMPUS, 50, 0)).toBe(Infinity);
    expect(fitDistance(CAMPUS, 0, 1)).toBe(Infinity);
  });

  describe('with a height (V2-15.6)', () => {
    const angles = { yaw: HOME_YAW_DEG, tilt: HOME_TILT_DEG };

    it('is the ground rectangle when the height is nothing, whatever way nothing is said', () => {
      const flat = fitDistance(BUILDING, HOME_FOV_DEG, 16 / 9);

      expect(fitDistance(BUILDING, HOME_FOV_DEG, 16 / 9, angles, HOME_MARGIN, 0)).toBe(flat);
      expect(fitDistance(BUILDING, HOME_FOV_DEG, 16 / 9, angles, HOME_MARGIN, -5)).toBe(flat);
    });

    it('needs more distance for a taller box, because its roof has to fit too', () => {
      const flat = fitDistance(BUILDING, HOME_FOV_DEG, 16 / 9);
      const low = fitDistance(BUILDING, HOME_FOV_DEG, 16 / 9, angles, HOME_MARGIN, 10);
      const tall = fitDistance(BUILDING, HOME_FOV_DEG, 16 / 9, angles, HOME_MARGIN, 40);

      expect(low).toBeGreaterThan(flat);
      expect(tall).toBeGreaterThan(low);
    });

    it('still reports a stage with no width as unbounded', () => {
      expect(fitDistance(BUILDING, HOME_FOV_DEG, 0, angles, HOME_MARGIN, 24)).toBe(Infinity);
    });
  });

  describe('with a base (V2-15.7)', () => {
    const angles = { yaw: HOME_YAW_DEG, tilt: HOME_TILT_DEG };

    it('is the same distance for a box standing higher: only where it looks changes', () => {
      const grounded = fitDistance(BUILDING, HOME_FOV_DEG, 16 / 9, angles, HOME_MARGIN, 8, 0);

      expect(fitDistance(BUILDING, HOME_FOV_DEG, 16 / 9, angles, HOME_MARGIN, 8, 24)).toBeCloseTo(
        grounded,
        6,
      );
      expect(fitDistance(BUILDING, HOME_FOV_DEG, 16 / 9, angles, HOME_MARGIN, 0, 24)).toBeCloseTo(
        fitDistance(BUILDING, HOME_FOV_DEG, 16 / 9, angles, HOME_MARGIN, 0, 0),
        6,
      );
    });

    it('leaves the old answers alone when there is no base', () => {
      const flat = fitDistance(BUILDING, HOME_FOV_DEG, 16 / 9, angles, HOME_MARGIN, 12);

      expect(fitDistance(BUILDING, HOME_FOV_DEG, 16 / 9, angles, HOME_MARGIN, 12, 0)).toBe(flat);
    });
  });
});

describe('distanceLimitsOf (V2-15.7)', () => {
  it('is 4 – 40 m for an isolated asset and its parts, 60 – 900 m for every other level', () => {
    expect(distanceLimitsOf('asset')).toEqual({ minDistance: 4, maxDistance: 40 });
    expect(distanceLimitsOf('part')).toEqual({ minDistance: 4, maxDistance: 40 });
    expect(distanceLimitsOf('campus')).toEqual({ minDistance: 60, maxDistance: 900 });
    expect(distanceLimitsOf('building')).toEqual({ minDistance: 60, maxDistance: 900 });
  });
});

describe('homeView', () => {
  it('looks at the middle of the campus, on the ground, from the south-east at 55°', () => {
    const home = homeView(CAMPUS, 16 / 9);

    expect(home.target).toEqual([-27, 0, 15]);
    expect(home.yaw).toBe(45);
    expect(home.tilt).toBe(55);
  });

  it('shows the whole campus from within the campus limits on a wide stage', () => {
    const { distance } = homeView(CAMPUS, 16 / 9);

    expect(distance).toBeGreaterThan(CAMERA_LIMITS.campus.minDistance);
    expect(distance).toBeLessThan(CAMERA_LIMITS.campus.maxDistance);
    expect(distance).toBeCloseTo(fitDistance(CAMPUS, HOME_FOV_DEG, 16 / 9), 9);
  });

  it('holds a stage too narrow for the campus at the 900 m ceiling', () => {
    expect(homeView(CAMPUS, 0.3).distance).toBe(900);
  });

  it('holds a tiny campus at the 60 m floor', () => {
    expect(homeView({ minX: 0, maxX: 5, minZ: 0, maxZ: 5 }, 16 / 9).distance).toBe(60);
  });

  it('never fits closer for the part a sheet leaves visible, and further once that part is narrow', () => {
    const closed = homeView(CAMPUS, 1440 / 900).distance;
    const sheetOpen = homeView(CAMPUS, (1440 - 440) / 900).distance;
    const sheetWide = homeView(CAMPUS, (1440 - 900) / 900).distance;

    // At these shapes the stage's height is what binds, so a sheet that is not too wide costs nothing.
    expect(sheetOpen).toBeGreaterThanOrEqual(closed);
    expect(sheetWide).toBeGreaterThan(closed);
  });
});

describe('fitBounds', () => {
  it('is the home view of the campus when the box is flat', () => {
    expect(fitBounds(CAMPUS, 16 / 9)).toEqual(homeView(CAMPUS, 16 / 9));
    expect(fitBounds(CAMPUS, 16 / 9, 0)).toEqual(homeView(CAMPUS, 16 / 9));
  });

  it('looks at the middle of the box, half way up, from the home angles', () => {
    const view = fitBounds(BUILDING, 16 / 9, 24);

    expect(view.target).toEqual([130, 12, -40]);
    expect(view.yaw).toBe(HOME_YAW_DEG);
    expect(view.tilt).toBe(HOME_TILT_DEG);
  });

  it('is the distance that shows the whole box, inside the campus limits', () => {
    const { distance } = fitBounds(BUILDING, 16 / 9, 24);

    expect(distance).toBeGreaterThanOrEqual(CAMERA_LIMITS.campus.minDistance);
    expect(distance).toBeLessThanOrEqual(CAMERA_LIMITS.campus.maxDistance);
    expect(distance).toBeCloseTo(
      Math.max(
        CAMERA_LIMITS.campus.minDistance,
        fitDistance(
          BUILDING,
          HOME_FOV_DEG,
          16 / 9,
          { yaw: HOME_YAW_DEG, tilt: HOME_TILT_DEG },
          HOME_MARGIN,
          24,
        ),
      ),
      9,
    );
  });

  it('is farther for a taller building than for a flat one at the same footprint', () => {
    expect(fitBounds(BUILDING, 16 / 9, 24).distance).toBeGreaterThan(
      fitBounds(BUILDING, 16 / 9, 0).distance,
    );
  });

  it('holds a very small box at the 60 m floor, and a stage too narrow for it at the 900 m ceiling', () => {
    expect(fitBounds({ minX: 0, maxX: 5, minZ: 0, maxZ: 5 }, 16 / 9, 5).distance).toBe(60);
    expect(fitBounds(CAMPUS, 0.3, 24).distance).toBe(900);
    expect(fitBounds(BUILDING, 0, 24).distance).toBe(900);
  });

  it('is farther on a narrower stage, as when a sheet is open', () => {
    expect(fitBounds(BUILDING, 0.6, 24).distance).toBeGreaterThan(
      fitBounds(BUILDING, 16 / 9, 24).distance,
    );
  });

  it('treats a height that is not above the ground as none', () => {
    expect(fitBounds(BUILDING, 16 / 9, -3)).toEqual(fitBounds(BUILDING, 16 / 9, 0));
  });
});

describe('unionLimits (V2-15.7)', () => {
  it('is the widest range of the two, whichever way round', () => {
    const campus = distanceLimitsOf('campus');
    const asset = distanceLimitsOf('asset');

    expect(unionLimits(campus, asset)).toEqual({ minDistance: 4, maxDistance: 900 });
    expect(unionLimits(asset, campus)).toEqual({ minDistance: 4, maxDistance: 900 });
    expect(unionLimits(asset, asset)).toEqual(asset);
  });
});

describe('fitAssetView (V2-15.7)', () => {
  // A 6 × 6 m footprint, 8 m tall: a cooling tower's size.
  const TOWER: Bounds = { minX: 100, maxX: 106, minZ: -60, maxZ: -54 };
  const angles = { yaw: HOME_YAW_DEG, tilt: HOME_TILT_DEG };
  const fit = (box: FitBox = { bounds: TOWER, heightM: 8, baseM: 0 }, aspect = 16 / 9) =>
    fitAssetView(box, aspect, angles);

  it('looks at the middle of the box, on its base: a rooftop asset is looked at on the roof', () => {
    expect(fit().target).toEqual([103, 4, -57]);
    expect(fit({ bounds: TOWER, heightM: 8, baseM: 24 }).target).toEqual([103, 28, -57]);
    // No base is the ground, as a building's box has none.
    expect(fit({ bounds: TOWER, heightM: 8 }).target).toEqual([103, 4, -57]);
  });

  it('keeps the operator’s yaw and tilt', () => {
    const view = fitAssetView({ bounds: TOWER, heightM: 8 }, 16 / 9, { yaw: -120, tilt: 33 });

    expect(view.yaw).toBe(-120);
    expect(view.tilt).toBe(33);
  });

  it('holds the tilt within 20° – 78°', () => {
    expect(fitAssetView({ bounds: TOWER, heightM: 8 }, 16 / 9, { yaw: 0, tilt: 5 }).tilt).toBe(20);
    expect(fitAssetView({ bounds: TOWER, heightM: 8 }, 16 / 9, { yaw: 0, tilt: 89 }).tilt).toBe(78);
  });

  it('stands as close as shows the whole box, inside 4 – 40 m', () => {
    const view = fit();
    const needed = fitDistance(TOWER, HOME_FOV_DEG, 16 / 9, angles, HOME_MARGIN, 8, 0);

    expect(needed).toBeGreaterThan(4);
    expect(needed).toBeLessThan(40);
    expect(view.distance).toBeCloseTo(needed, 6);
  });

  it('is farther for a bigger box and for a narrower visible stage', () => {
    const small = fit().distance;
    const big = fit({ bounds: { ...TOWER, maxX: 118 }, heightM: 8, baseM: 0 }).distance;

    expect(big).toBeGreaterThan(small);
    expect(fit(undefined, 0.3).distance).toBeGreaterThan(small);
  });

  it('shows a small box from 4 m and a huge one from 40 m', () => {
    const sensor: Bounds = { minX: 0, maxX: 0.2, minZ: 0, maxZ: 0.2 };
    const hall: Bounds = { minX: 0, maxX: 400, minZ: 0, maxZ: 400 };

    expect(fit({ bounds: sensor, heightM: 0.2, baseM: 0 }).distance).toBe(4);
    expect(fit({ bounds: hall, heightM: 20, baseM: 0 }).distance).toBe(40);
  });

  it('is held at the far limit for a stage with no width', () => {
    expect(fit(undefined, 0).distance).toBe(40);
  });
});

describe('clampTarget', () => {
  const pan = panBounds(CAMPUS);

  it('leaves a target inside the pan box alone', () => {
    expect(clampTarget([10, 5, -20], pan)).toEqual([10, 5, -20]);
  });

  it('holds a target at the boundary plus 40 m on every side', () => {
    expect(clampTarget([-9999, 0, 9999], pan)).toEqual([-322, 0, 317]);
    expect(clampTarget([9999, 0, -9999], pan)).toEqual([268, 0, -287]);
  });

  it('keeps the target between the ground and the roofs', () => {
    expect(clampTarget([0, -10, 0], pan)[1]).toBe(0);
    expect(clampTarget([0, 500, 0], pan)[1]).toBe(CAMERA_LIMITS.targetMaxHeightM);
  });

  it('returns a new array and leaves its argument alone', () => {
    const target: [number, number, number] = [9999, 0, 0];

    clampTarget(target, pan);

    expect(target).toEqual([9999, 0, 0]);
  });
});

describe('limitPose', () => {
  const pan = panBounds(CAMPUS);

  it('leaves a pose the camera can have alone', () => {
    const reachable = pose({ target: [10, 0, 10], distance: 300, yaw: 200, tilt: 40 });

    expect(limitPose(reachable, pan)).toEqual(reachable);
  });

  it('brings the target, the distance and the tilt inside the limits and keeps the yaw', () => {
    const wild = pose({ target: [9999, 500, -9999], distance: 5000, yaw: 123, tilt: 5 });

    expect(limitPose(wild, pan)).toEqual({
      target: [268, 60, -287],
      distance: 900,
      yaw: 123,
      tilt: 20,
    });
    expect(limitPose(pose({ distance: 1, tilt: 89 }), pan)).toMatchObject({
      distance: 60,
      tilt: 78,
    });
  });

  it('takes the distance limits it is given, and the campus ones by default (V2-15.7)', () => {
    const asset = distanceLimitsOf('asset');

    expect(limitPose(pose({ distance: 1 }), pan, asset).distance).toBe(4);
    expect(limitPose(pose({ distance: 12 }), pan, asset).distance).toBe(12);
    expect(limitPose(pose({ distance: 300 }), pan, asset).distance).toBe(40);
    expect(limitPose(pose({ distance: 12 }), pan).distance).toBe(60);
    expect(limitPose(pose({ distance: 12 }), pan, asset).tilt).toBe(55);
  });
});

describe('incidentView (V2-16.5)', () => {
  const beacon: [number, number, number] = [40, 19, -25];

  it('looks at the beacon’s ground point', () => {
    const view = incidentView(beacon, pose({ distance: 300, yaw: 30, tilt: 50 }));

    expect(view.target).toEqual(beacon);
    // A copy: the beacon's own position is not shared with the pose that is flown.
    expect(view.target).not.toBe(beacon);
  });

  it('keeps the camera’s yaw and tilt', () => {
    const view = incidentView(beacon, pose({ distance: 300, yaw: -120, tilt: 33 }));

    expect(view).toMatchObject({ yaw: -120, tilt: 33 });
  });

  it('comes no farther than 120 m, from anywhere above that', () => {
    expect(INCIDENT_FLY_DISTANCE_M).toBe(120);
    expect(incidentView(beacon, pose({ distance: 900 })).distance).toBe(120);
    expect(incidentView(beacon, pose({ distance: 121 })).distance).toBe(120);
  });

  it('keeps the distance when the camera is already nearer', () => {
    expect(incidentView(beacon, pose({ distance: 120 })).distance).toBe(120);
    expect(incidentView(beacon, pose({ distance: 85 })).distance).toBe(85);
  });

  it('changes nothing in its arguments', () => {
    const now = pose({ target: [1, 2, 3], distance: 500, yaw: 10, tilt: 40 });
    const position: [number, number, number] = [7, 8, 9];
    const before = structuredClone({ now, position });

    incidentView(position, now);

    expect({ now, position }).toEqual(before);
  });

  it('is raised to the level’s floor by limitPose, and never beyond the pan box', () => {
    const pan = panBounds(CAMPUS);
    // Coming from an isolated asset (a 20 m view) the flight is asked for the 60 m floor of the campus level.
    expect(limitPose(incidentView(beacon, pose({ distance: 20 })), pan).distance).toBe(
      CAMERA_LIMITS.campus.minDistance,
    );
    expect(limitPose(incidentView([9999, 19, 0], pose({ distance: 300 })), pan).target[0]).toBe(
      pan.maxX,
    );
  });
});

describe('ease and flyPath', () => {
  const from = pose({ target: [0, 0, 0], distance: 800, yaw: 45, tilt: 55 });
  const to = pose({ target: [100, 10, -50], distance: 200, yaw: 45, tilt: 40 });

  it('eases out: quick at first, settling at the end', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBe(0.875);
    expect(ease(0.25)).toBeGreaterThan(0.25);
    for (let step = 0; step < 10; step += 1) {
      expect(ease((step + 1) / 10)).toBeGreaterThan(ease(step / 10));
    }
  });

  it('holds its argument to 0 … 1', () => {
    expect(ease(-3)).toBe(0);
    expect(ease(7)).toBe(1);
  });

  it('starts at the start and ends exactly on the target', () => {
    expect(flyPath(from, to, 0)).toEqual(from);
    expect(flyPath(from, to, 1)).toEqual(to);
    expect(flyPath(from, to, 5)).toEqual(to);
  });

  it('moves the target, the distance and the tilt by the eased fraction', () => {
    const middle = flyPath(from, to, 0.5);

    expect(middle.target).toEqual([87.5, 8.75, -43.75]);
    expect(middle.distance).toBe(800 + (200 - 800) * 0.875);
    expect(middle.tilt).toBeCloseTo(55 + (40 - 55) * 0.875, 9);
  });

  it('turns the short way round, across north', () => {
    const across = flyPath(pose({ yaw: 350 }), pose({ yaw: 10 }), 0.2);
    const back = flyPath(pose({ yaw: 10 }), pose({ yaw: 350 }), 0.2);

    // 20° the short way: from 350 up past 360, and from 10 down past 0.
    expect(across.yaw).toBeGreaterThan(350);
    expect(back.yaw).toBeLessThan(10);
    expect(flyPath(pose({ yaw: -170 }), pose({ yaw: 170 }), 0.2).yaw).toBeLessThan(-170);
  });

  it('stays where it is when there is nowhere to go', () => {
    expect(flyPath(from, from, 0.5)).toEqual(from);
  });

  it('does not hand back its argument', () => {
    expect(flyPath(from, to, 1).target).not.toBe(to.target);
  });
});

describe('flyProgress', () => {
  it('takes 600 ms from start to done', () => {
    expect(flyProgress(0, FLY_MS)).toBe(0);
    expect(flyProgress(300, FLY_MS)).toBe(0.5);
    expect(flyProgress(600, FLY_MS)).toBe(1);
    expect(flyProgress(700, FLY_MS)).toBe(1);
  });

  it('is done at once for a fly-to of no time, which is how reduced motion jumps', () => {
    expect(flyProgress(0, 0)).toBe(1);
  });

  it('does not run backwards', () => {
    expect(flyProgress(-50, FLY_MS)).toBe(0);
  });
});

describe('viewOffset', () => {
  it('shifts the picture left by half the sheet, so the focus is beside it', () => {
    expect(viewOffset(1440, 900, 440)).toEqual({
      fullWidth: 1440,
      fullHeight: 900,
      x: 220,
      y: 0,
      width: 1440,
      height: 900,
    });
  });

  it('is no offset without a sheet, or one that covers the stage', () => {
    expect(viewOffset(1440, 900, 0)).toBeNull();
    expect(viewOffset(1440, 900, -10)).toBeNull();
    expect(viewOffset(1440, 900, 1440)).toBeNull();
    expect(viewOffset(1440, 900, 2000)).toBeNull();
    expect(viewOffset(1440, 900, Number.NaN)).toBeNull();
  });

  it('is no offset for a stage with no size', () => {
    expect(viewOffset(0, 900, 100)).toBeNull();
    expect(viewOffset(1440, 0, 100)).toBeNull();
  });
});

describe('normalizeYaw', () => {
  it('wraps into −180 … 180 and keeps 180 as 180', () => {
    expect(normalizeYaw(190)).toBe(-170);
    expect(normalizeYaw(-190)).toBe(170);
    expect(normalizeYaw(360)).toBe(0);
    expect(normalizeYaw(725)).toBe(5);
    expect(normalizeYaw(180)).toBe(180);
    expect(normalizeYaw(-180)).toBe(180);
    expect(normalizeYaw(45)).toBe(45);
  });
});

describe('yawOfDirection', () => {
  const SQRT_HALF = Math.SQRT1_2;

  it('reads looking north as 0 and looking south as 180', () => {
    expect(yawOfDirection(0, -1)).toBeCloseTo(0, 9);
    expect(yawOfDirection(0, 1)).toBeCloseTo(180, 9);
  });

  it('reads a camera east of its target, looking west, as 90, and one west of it as −90', () => {
    expect(yawOfDirection(-1, 0)).toBeCloseTo(90, 9);
    expect(yawOfDirection(1, 0)).toBeCloseTo(-90, 9);
  });

  it('reads the home view, from the south-east looking north-west, as 45', () => {
    expect(yawOfDirection(-SQRT_HALF, -SQRT_HALF)).toBeCloseTo(45, 9);
  });

  it('agrees with the pose: the yaw the camera stands at is the yaw it reads', () => {
    for (const yaw of [-170, -60, 0, 45, 120, 180]) {
      const target = {
        target: [0, 0, 0] as [number, number, number],
        distance: 100,
        yaw,
        tilt: 55,
      };
      const [x, , z] = poseToPosition(target);

      // The forward vector points from the camera to the target.
      expect(normalizeYaw(yawOfDirection(-x, -z) - yaw)).toBeCloseTo(0, 6);
    }
  });

  it('is 0 for a camera that looks straight down, which has no direction on the ground', () => {
    expect(yawOfDirection(0, 0)).toBe(0);
  });
});

describe('compassLabel', () => {
  it('says "Face north" when the view faces north to the whole degree', () => {
    expect(compassLabel(0)).toBe('Face north');
    expect(compassLabel(0.4)).toBe('Face north');
    expect(compassLabel(359.6)).toBe('Face north');
    expect(compassLabel(-0.4)).toBe('Face north');
  });

  it('says how far the view is rotated, in whole degrees and without a sign', () => {
    expect(compassLabel(45)).toBe('Face north — the view is rotated 45°');
    expect(compassLabel(-60)).toBe('Face north — the view is rotated 60°');
    expect(compassLabel(60.4)).toBe('Face north — the view is rotated 60°');
    expect(compassLabel(180)).toBe('Face north — the view is rotated 180°');
  });
});

describe('lodDistance', () => {
  const tanHalf = (fovDeg: number) => Math.tan((fovDeg * Math.PI) / 360);

  it('holds the brief’s 5 % of the screen’s height and a hysteresis of a tenth', () => {
    expect(LOD_SCREEN_FRACTION).toBe(0.05);
    expect(LOD_HYSTERESIS).toBe(0.1);
  });

  it('is the distance at which a sphere of the radius spans the fraction of the view’s height', () => {
    expect(lodDistance(5, 50)).toBeCloseTo(5 / (0.05 * tanHalf(50)), 9);
    expect(lodDistance(3, 60, 0.1)).toBeCloseTo(3 / (0.1 * tanHalf(60)), 9);
  });

  it('is about 43 times the radius at the twin’s lens', () => {
    expect(lodDistance(1, HOME_FOV_DEG)).toBeCloseTo(42.89, 1);
  });

  it('puts a sphere at the fraction of the screen exactly there (the round trip)', () => {
    for (const [radius, fov] of [
      [1, 50],
      [3.8, 50],
      [12, 35],
    ] as const) {
      const distance = lodDistance(radius, fov);
      // A sphere's diameter over the view's height at that distance.
      expect((2 * radius) / (2 * distance * tanHalf(fov))).toBeCloseTo(LOD_SCREEN_FRACTION, 9);
    }
  });

  it('is further for a bigger sphere, nearer for a wider lens and nearer for a larger share', () => {
    expect(lodDistance(8, 50)).toBeGreaterThan(lodDistance(4, 50));
    expect(lodDistance(4, 70)).toBeLessThan(lodDistance(4, 50));
    expect(lodDistance(4, 50, 0.1)).toBeLessThan(lodDistance(4, 50, 0.05));
  });

  it('never switches (Infinity) for a radius, a lens or a fraction that cannot be used', () => {
    for (const radius of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(lodDistance(radius, 50)).toBe(Infinity);
    }
    for (const fov of [0, -50, Number.NaN, Number.POSITIVE_INFINITY, 180, 200]) {
      expect(lodDistance(4, fov)).toBe(Infinity);
    }
    for (const fraction of [0, -0.05, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(lodDistance(4, 50, fraction)).toBe(Infinity);
    }
  });

  it('puts the demo’s towers and generator at about 160 m, inside the campus range', () => {
    // Half the diagonal of the seed's footprints: 4 × 4 × 5 m and 6 × 2.5 × 3 m.
    const tower = lodDistance(Math.hypot(4, 4, 5) / 2, HOME_FOV_DEG);
    const generator = lodDistance(Math.hypot(6, 2.5, 3) / 2, HOME_FOV_DEG);

    expect(tower).toBeGreaterThan(160);
    expect(tower).toBeLessThan(165);
    expect(generator).toBeGreaterThan(150);
    expect(generator).toBeLessThan(156);
    expect(tower).toBeGreaterThan(CAMERA_LIMITS.campus.minDistance);
    expect(tower).toBeLessThan(CAMERA_LIMITS.campus.maxDistance);
  });
});
