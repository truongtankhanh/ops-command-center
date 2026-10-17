import {
  CAMERA_LIMITS,
  clampTarget,
  ease,
  fitDistance,
  FLY_MS,
  flyPath,
  flyProgress,
  HOME_FOV_DEG,
  HOME_MARGIN,
  HOME_TILT_DEG,
  HOME_YAW_DEG,
  homeView,
  limitPose,
  type Pose,
  poseToPosition,
  positionToPose,
  viewOffset,
} from './twinCamera';
import { type Bounds, panBounds } from './twinScene';

// TwinScene.dc.html's campus box (the demo site).
const CAMPUS: Bounds = { minX: -282, maxX: 228, minZ: -247, maxZ: 277 };

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
