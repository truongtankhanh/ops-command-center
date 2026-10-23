// `?raw` (typed by `vite/client`): the doc's text, with no `node:fs`. The path is from `apps/console/src/lib/twin-core`
// to the repo root, as in `twinBindings.test.ts`.
import assetClassesText from '../../../../../docs/design/v2/asset-classes.md?raw';
import type { Axis, Binding, BindingPoint, Motion } from './twinBindings';
import {
  angleFor,
  type BoundState,
  createBoundState,
  domainOf,
  EASE_LAMBDA,
  easeToward,
  frameDt,
  hasSettled,
  integrateAngle,
  MAX_FRAME_DT_S,
  MAX_VISUAL_REV_PER_S,
  offsetFor,
  poseOfBound,
  resetBoundState,
  SETTLE_EPSILON,
  SNAP_FRACTION,
  shouldSnap,
  snapFor,
  spinSpeed,
  stepBound,
  targetFor,
} from './twinMotion';

// --- fixtures: the bindings of asset-classes.md, with the numbers its Bound part columns give ---------------

const NUMBER_0_100: BindingPoint = { kind: 'number', min: 0, max: 100, enumValues: null };
const NUMBER_RPM: BindingPoint = { kind: 'number', min: 0, max: 1800, enumValues: null };
const BOOLEAN: BindingPoint = { kind: 'boolean', min: null, max: null, enumValues: null };
const enumOf = (...values: string[]): BindingPoint => ({
  kind: 'enum',
  min: null,
  max: null,
  enumValues: values,
});

const binding = (
  motion: Motion,
  point: BindingPoint,
  range?: [number, number],
  axis: Axis = 'x',
): Binding => ({
  node: 'Part',
  key: 'point',
  motion,
  point,
  parent: null,
  ...(range === undefined ? {} : { axis, range }),
});

const SWITCH = binding('turn', enumOf('off', 'auto', 'hand'), [-35, 35]);
const BREAKER = binding('turn', BOOLEAN, [0, 35]);
const VALVE = binding('turn', NUMBER_0_100, [0, 90]);
const FAN = binding('spin', NUMBER_RPM, [0, 1800], 'y');
const SLIDER = binding('slide', NUMBER_0_100, [0, 2], 'z');
const MOTOR = binding('tint', NUMBER_0_100);

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Value → target → pose, in degrees: the path `useFrame` takes for a turning part. */
function poseDegrees(part: Binding, value: Parameters<typeof targetFor>[1]): number | null {
  const target = targetFor(part, value);
  const angle = target === null ? null : angleFor(part, target);
  return angle === null ? null : (angle * 180) / Math.PI;
}

// --- AC1: about 90 % of a step in 290 ms, at any frame rate --------------------------------------------------

describe('easeToward', () => {
  it('names λ as the brief does', () => {
    expect(EASE_LAMBDA).toBe(8);
  });

  it.each([30, 60, 144])('covers about 90 %% of a step in 290 ms at %i FPS', (fps) => {
    const frames = Math.ceil(0.29 * fps - 1e-9);
    const elapsed = frames / fps;
    let x = 0;
    for (let frame = 0; frame < frames; frame++) x = easeToward(x, 1, 1 / fps);

    // The frame count is not an integer at every rate, so "about": within 2 points of 90 %, and exactly what
    // the formula gives for the time that really passed.
    expect(x).toBeGreaterThan(0.88);
    expect(x).toBeLessThan(0.92);
    expect(x).toBeCloseTo(1 - Math.exp(-EASE_LAMBDA * elapsed), 10);
  });

  it('gives the same result for one step of 32 ms as for two of 16 ms', () => {
    const once = easeToward(10, 90, 0.032);
    const twice = easeToward(easeToward(10, 90, 0.016), 90, 0.016);

    expect(twice).toBeCloseTo(once, 10);
  });

  it('moves down as well as up, and stays at the target', () => {
    expect(easeToward(100, 0, 0.1)).toBeLessThan(100);
    expect(easeToward(100, 0, 0.1)).toBeGreaterThan(0);
    expect(easeToward(7, 7, 0.1)).toBe(7);
  });

  it('takes a lambda of its own', () => {
    expect(easeToward(0, 1, 0.1, 20)).toBeGreaterThan(easeToward(0, 1, 0.1, 2));
  });

  it('arrives at the target after a very long step, such as a tab coming back', () => {
    expect(easeToward(3, 10, 1e9)).toBeCloseTo(10, 10);
  });

  it.each([
    ['no time', 0],
    ['negative time', -0.016],
    ['time that is not a number', Number.NaN],
    ['time that is not finite', Number.POSITIVE_INFINITY],
  ])('leaves x where it is for %s', (_what, dtS) => {
    expect(easeToward(3, 10, dtS)).toBe(3);
  });

  it('never gives NaN: a target that is not a number leaves x, and so does a lambda that is not usable', () => {
    expect(easeToward(3, Number.NaN, 0.016)).toBe(3);
    expect(easeToward(3, Number.POSITIVE_INFINITY, 0.016)).toBe(3);
    expect(easeToward(1, 5, 0.016, 0)).toBe(1);
    expect(easeToward(1, 5, 0.016, -3)).toBe(1);
    expect(easeToward(1, 5, 0.016, Number.NaN)).toBe(1);
  });

  it('takes the target when x is not a number', () => {
    expect(easeToward(Number.NaN, 5, 0.016)).toBe(5);
  });
});

describe('hasSettled', () => {
  it('is true within SETTLE_EPSILON of the span, false outside it', () => {
    expect(SETTLE_EPSILON).toBe(0.001);
    expect(hasSettled(100, 100, 100)).toBe(true);
    expect(hasSettled(99.95, 100, 100)).toBe(true);
    expect(hasSettled(99.5, 100, 100)).toBe(false);
  });

  it('scales with the span, so a degree and a rev/s share one constant', () => {
    expect(hasSettled(0.9995, 1, 1)).toBe(true);
    expect(hasSettled(0.995, 1, 1)).toBe(false);
    expect(hasSettled(89.95, 90, 90)).toBe(true);
    expect(hasSettled(89.5, 90, 90)).toBe(false);
  });

  it('settles on equality when the span has no width, and on anything that is not a number', () => {
    expect(hasSettled(5, 5, 0)).toBe(true);
    expect(hasSettled(5, 5.1, 0)).toBe(false);
    expect(hasSettled(Number.NaN, 1, 1)).toBe(true);
    expect(hasSettled(1, Number.NaN, 1)).toBe(true);
    expect(hasSettled(1, 2, Number.NaN)).toBe(true);
  });
});

// --- AC2: a reconnect-sized step snaps, a small one eases, a first value snaps -------------------------------

describe('shouldSnap', () => {
  const RANGE: [number, number] = [0, 100];

  it('names the fraction of the span at which a step snaps', () => {
    expect(SNAP_FRACTION).toBe(0.5);
  });

  it('snaps on the first value, and when the previous one is not a number', () => {
    expect(shouldSnap(null, 5, RANGE)).toBe(true);
    expect(shouldSnap(Number.NaN, 5, RANGE)).toBe(true);
  });

  it('snaps on a step of half the span or more, in both directions, and eases a smaller one', () => {
    expect(shouldSnap(10, 59.9, RANGE)).toBe(false);
    expect(shouldSnap(10, 60, RANGE)).toBe(true);
    expect(shouldSnap(60, 10, RANGE)).toBe(true);
    expect(shouldSnap(60, 10.1, RANGE)).toBe(false);
    expect(shouldSnap(50, 50, RANGE)).toBe(false);
  });

  it('measures the step against the span of the range it is given, whatever the unit', () => {
    expect(shouldSnap(0, 900, [0, 1800])).toBe(true);
    expect(shouldSnap(0, 899, [0, 1800])).toBe(false);
    expect(shouldSnap(-35, 0, [-35, 35])).toBe(true);
    expect(shouldSnap(-35, -1, [-35, 35])).toBe(false);
  });

  it('never snaps on a value that is not a number, or by size on a range with no width', () => {
    expect(shouldSnap(null, Number.NaN, RANGE)).toBe(false);
    expect(shouldSnap(10, Number.POSITIVE_INFINITY, RANGE)).toBe(false);
    expect(shouldSnap(5, 500, [5, 5])).toBe(false);
    expect(shouldSnap(5, 500, [10, 5])).toBe(false);
  });
});

describe('snapFor', () => {
  it('snaps every kind on the first value', () => {
    for (const part of [FAN, VALVE, SLIDER, SWITCH, BREAKER, MOTOR]) {
      expect(snapFor(part, null, 1)).toBe(true);
    }
  });

  it('compares a spin’s readings with its range', () => {
    expect(snapFor(FAN, 1400, 0)).toBe(true); // a restart
    expect(snapFor(FAN, 1400, 1200)).toBe(false);
  });

  it('compares a turn’s and a slide’s encoded values with the domain of the point', () => {
    expect(snapFor(VALVE, 0, 100)).toBe(true);
    expect(snapFor(VALVE, 40, 50)).toBe(false);
    expect(snapFor(SLIDER, 100, 0)).toBe(true);
    expect(snapFor(SLIDER, 40, 50)).toBe(false);
  });

  it('eases a boolean, an enum and a tint by size, however large the step', () => {
    expect(snapFor(BREAKER, 0, 1)).toBe(false);
    expect(snapFor(SWITCH, 0, 2)).toBe(false);
    expect(snapFor(MOTOR, 1, 90)).toBe(false);
  });

  it('does not snap on a value that is not a number, and has no size for a spin without a range', () => {
    expect(snapFor(VALVE, 10, Number.NaN)).toBe(false);
    expect(snapFor(binding('spin', NUMBER_RPM), 0, 1800)).toBe(false);
  });
});

// --- spin ------------------------------------------------------------------------------------------------------

describe('spinSpeed', () => {
  const RANGE: [number, number] = [0, 1800];

  it('names the speed at the top of the range, 1.5 rev/s (V2-14.1)', () => {
    expect(MAX_VISUAL_REV_PER_S).toBe(1.5);
    expect(spinSpeed(1800, RANGE)).toBe(1.5);
  });

  it('is proportional, zero at zero, and flat outside the range', () => {
    expect(spinSpeed(0, RANGE)).toBe(0);
    expect(spinSpeed(900, RANGE)).toBeCloseTo(0.75, 10);
    expect(spinSpeed(2500, RANGE)).toBe(1.5);
    expect(spinSpeed(-5, RANGE)).toBe(0);
  });

  it('only goes up with the reading, and a real rotor speed is never shown', () => {
    let previous = -1;
    for (let reading = 0; reading <= 1800; reading += 100) {
      const speed = spinSpeed(reading, RANGE);
      expect(speed).toBeGreaterThanOrEqual(previous);
      previous = speed;
    }
    // 1,420 rpm is 23.7 rev/s; what is drawn is 1.18, which a 60 FPS frame can show.
    expect(spinSpeed(1420, RANGE)).toBeCloseTo(1.183, 3);
  });

  it('is zero for a reading that is not a number and for a range with no top', () => {
    expect(spinSpeed(Number.NaN, RANGE)).toBe(0);
    expect(spinSpeed(100, [0, 0])).toBe(0);
    expect(spinSpeed(100, [-10, -5])).toBe(0);
    expect(spinSpeed(100, [0, Number.NaN])).toBe(0);
  });
});

describe('integrateAngle', () => {
  it('turns by speed · 2π · dt', () => {
    expect(integrateAngle(0, 1, 0.25)).toBeCloseTo(Math.PI / 2, 10);
    expect(integrateAngle(1, 0, 1)).toBeCloseTo(1, 10);
  });

  it('wraps into [0, 2π) and never leaves it', () => {
    expect(integrateAngle(0, 1, 1.25)).toBeCloseTo(Math.PI / 2, 10);
    expect(integrateAngle(0, -1, 0.25)).toBeCloseTo((3 * Math.PI) / 2, 10);
    for (const [angle, speed, dtS] of [
      [0, 1.5, 1e6],
      [10, -1.5, 3.7],
      [-1e-20, 1, 1e-9],
      [-1e-20, 0, 1],
      [-7, 0.3, 0.016],
    ] as const) {
      const result = integrateAngle(angle, speed, dtS);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(2 * Math.PI);
    }
  });

  it('gives the same angle for one step of 32 ms as for two of 16 ms', () => {
    const once = integrateAngle(1, 0.75, 0.032);
    const twice = integrateAngle(integrateAngle(1, 0.75, 0.016), 0.75, 0.016);

    expect(twice).toBeCloseTo(once, 10);
  });

  it('keeps the angle (wrapped) when there is no time or no speed to apply, and starts from 0 for garbage', () => {
    expect(integrateAngle(1, 1, 0)).toBeCloseTo(1, 10);
    expect(integrateAngle(1, 1, -1)).toBeCloseTo(1, 10);
    expect(integrateAngle(1, Number.NaN, 0.1)).toBeCloseTo(1, 10);
    expect(integrateAngle(1, 1, Number.NaN)).toBeCloseTo(1, 10);
    expect(integrateAngle(7, 1, 0)).toBeCloseTo(7 - 2 * Math.PI, 10);
    expect(integrateAngle(Number.NaN, 0, 1)).toBe(0);
  });
});

// --- AC3: encoding and pose ------------------------------------------------------------------------------------

describe('targetFor', () => {
  it('encodes a number as it is, a boolean as 0 / 1, and an enum as its index', () => {
    expect(targetFor(VALVE, 50)).toBe(50);
    expect(targetFor(FAN, 1420)).toBe(1420);
    expect(targetFor(BREAKER, false)).toBe(0);
    expect(targetFor(BREAKER, true)).toBe(1);
    expect(targetFor(SWITCH, 'off')).toBe(0);
    expect(targetFor(SWITCH, 'auto')).toBe(1);
    expect(targetFor(SWITCH, 'hand')).toBe(2);
  });

  it.each([
    ['an absent value', VALVE, undefined],
    ['a flag for a number point', VALVE, true],
    ['text for a number point', VALVE, '50'],
    ['a number for a boolean point', BREAKER, 1],
    ['text for a boolean point', BREAKER, 'true'],
    ['a number for an enum point', SWITCH, 1],
    ['a word that is not one of the enum’s values', SWITCH, 'manual'],
    ['a number that is not a number', VALVE, Number.NaN],
    ['a number that is not finite', VALVE, Number.POSITIVE_INFINITY],
    ['a tint, which shows alarm and not value', MOTOR, 71],
  ])('is null for %s', (_what, part, value) => {
    expect(targetFor(part, value)).toBeNull();
  });
});

describe('the pose of a part', () => {
  it('puts switchState auto at 0°, off at −35° and hand at +35°', () => {
    expect(poseDegrees(SWITCH, 'auto')).toBeCloseTo(0, 10);
    expect(poseDegrees(SWITCH, 'off')).toBeCloseTo(-35, 10);
    expect(poseDegrees(SWITCH, 'hand')).toBeCloseTo(35, 10);
  });

  it('puts breakerClosed at 0° open and 35° closed', () => {
    expect(poseDegrees(BREAKER, false)).toBeCloseTo(0, 10);
    expect(poseDegrees(BREAKER, true)).toBeCloseTo(35, 10);
  });

  it('puts valveOpenPct 50 at 45°, and the ends at 0° and 90°', () => {
    expect(poseDegrees(VALVE, 50)).toBeCloseTo(45, 10);
    expect(poseDegrees(VALVE, 0)).toBeCloseTo(0, 10);
    expect(poseDegrees(VALVE, 100)).toBeCloseTo(90, 10);
  });

  it('returns radians', () => {
    expect(angleFor(VALVE, 50)).toBeCloseTo(radians(45), 10);
    expect(angleFor(SWITCH, 2)).toBeCloseTo(radians(35), 10);
  });

  it('clamps a value outside the domain to the ends of the range', () => {
    expect(angleFor(VALVE, 150)).toBeCloseTo(radians(90), 10);
    expect(angleFor(VALVE, -10)).toBeCloseTo(0, 10);
    expect(angleFor(SWITCH, 9)).toBeCloseTo(radians(35), 10);
  });

  it('maps a slide onto metres', () => {
    expect(offsetFor(SLIDER, 50)).toBeCloseTo(1, 10);
    expect(offsetFor(SLIDER, 0)).toBeCloseTo(0, 10);
    expect(offsetFor(SLIDER, 100)).toBeCloseTo(2, 10);
  });

  it('puts an enum of one value, and a domain with no width, at the start of the range', () => {
    expect(angleFor(binding('turn', enumOf('only'), [-35, 35]), 0)).toBeCloseTo(radians(-35), 10);
    const flat: BindingPoint = { kind: 'number', min: 5, max: 5, enumValues: null };
    expect(angleFor(binding('turn', flat, [10, 20]), 5)).toBeCloseTo(radians(10), 10);
  });

  it('is null for another motion, for no range, and for a value that is not a number', () => {
    expect(angleFor(FAN, 900)).toBeNull();
    expect(angleFor(SLIDER, 50)).toBeNull();
    expect(angleFor(MOTOR, 50)).toBeNull();
    expect(angleFor(VALVE, Number.NaN)).toBeNull();
    expect(offsetFor(VALVE, 50)).toBeNull();
    expect(offsetFor(SLIDER, Number.POSITIVE_INFINITY)).toBeNull();
    expect(offsetFor(binding('slide', NUMBER_0_100), 50)).toBeNull();
  });
});

describe('domainOf', () => {
  it('is a number’s bounds, a boolean’s 0 – 1 and an enum’s 0 – (n − 1)', () => {
    expect(domainOf(NUMBER_0_100)).toEqual([0, 100]);
    expect(domainOf(BOOLEAN)).toEqual([0, 1]);
    expect(domainOf(enumOf('a', 'b', 'c'))).toEqual([0, 2]);
  });

  it('has no width for an enum of one value or none, and for a number with an open bound', () => {
    expect(domainOf(enumOf('a'))).toEqual([0, 0]);
    expect(domainOf(enumOf())).toEqual([0, 0]);
    expect(domainOf({ kind: 'enum', min: null, max: null, enumValues: null })).toEqual([0, 0]);
    expect(domainOf({ kind: 'number', min: 0, max: null, enumValues: null })).toEqual([0, 0]);
  });
});

// --- the fixtures against the doc ------------------------------------------------------------------------------

describe('the fixtures above match asset-classes.md', () => {
  // The poses of AC3 are the ranges the doc's Bound part columns give; if a range there changes, this fails
  // and the fixtures (and the expectations) are revisited.
  it.each([
    ['`Switch` · turn · x · [-35, 35]'],
    ['`Valve` · turn · x · [0, 90]'],
    ['`Breaker` · turn · x · [0, 35]'],
    ['`FanBlade` · spin · y · [0, 1800]'],
    ['`RadiatorFan` · spin · y · [0, 1800]'],
  ])('says %s', (line) => {
    expect(assetClassesText).toContain(line);
  });
});

// --- V2-14.8: one frame of a bound part -------------------------------------------------------------------

const FRAME_S = 1 / 60;

/** Steps `state` for `frames` frames of `dtS` toward `reading`; how many of them asked for another frame, and the last answer. */
function run(
  part: Binding,
  state: BoundState,
  reading: number,
  frames: number,
  dtS = FRAME_S,
): { asked: number; last: boolean } {
  let asked = 0;
  let last = false;
  for (let i = 0; i < frames; i += 1) {
    last = stepBound(part, state, reading, dtS);
    if (last) asked += 1;
  }
  return { asked, last };
}

describe('frameDt', () => {
  it('names the longest step, 0.1 s', () => {
    expect(MAX_FRAME_DT_S).toBe(0.1);
  });

  it('is the delta itself within the limit, and the limit above it', () => {
    expect(frameDt(0.016)).toBe(0.016);
    expect(frameDt(0.1)).toBe(0.1);
    expect(frameDt(60)).toBe(MAX_FRAME_DT_S);
  });

  it('is 0 for a step that cannot be used', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(frameDt(bad)).toBe(0);
  });
});

describe('stepBound for a turn or a slide', () => {
  it('snaps the first value, and says the part is at rest', () => {
    const state = createBoundState();

    expect(stepBound(VALVE, state, 50, FRAME_S)).toBe(false);

    expect(state.value).toBe(50);
    expect(poseOfBound(VALVE, state)).toBeCloseTo(radians(45), 10);
  });

  it('eases a small step toward the reading and asks for frames until it arrives', () => {
    const state = createBoundState();
    stepBound(VALVE, state, 50, FRAME_S);

    expect(stepBound(VALVE, state, 60, FRAME_S)).toBe(true);
    expect(state.value).toBeGreaterThan(50);
    expect(state.value).toBeLessThan(60);

    const { last } = run(VALVE, state, 60, 120);
    expect(last).toBe(false);
    expect(state.value).toBe(60);
  });

  it('settles exactly on the reading, so the loop can sleep', () => {
    const state = createBoundState();
    stepBound(VALVE, state, 10, FRAME_S);

    run(VALVE, state, 30, 200);

    expect(state.value).toBe(30);
    expect(stepBound(VALVE, state, 30, FRAME_S)).toBe(false);
  });

  it('gives the same value for one step of 32 ms as for two of 16 ms', () => {
    const one = createBoundState();
    const two = createBoundState();
    for (const state of [one, two]) stepBound(VALVE, state, 50, FRAME_S);

    stepBound(VALVE, one, 60, 0.032);
    stepBound(VALVE, two, 60, 0.016);
    stepBound(VALVE, two, 60, 0.016);

    expect(one.value).toBeCloseTo(two.value as number, 10);
  });

  it('snaps a step of half the span or more, and does not ask for a frame', () => {
    const state = createBoundState();
    stepBound(VALVE, state, 0, FRAME_S);

    expect(stepBound(VALVE, state, 60, FRAME_S)).toBe(false);
    expect(state.value).toBe(60);
  });

  it('eases a boolean and an enum by size, however large the step', () => {
    const breaker = createBoundState();
    stepBound(BREAKER, breaker, 0, FRAME_S);
    expect(stepBound(BREAKER, breaker, 1, FRAME_S)).toBe(true);
    expect(breaker.value).toBeGreaterThan(0);
    expect(breaker.value).toBeLessThan(1);
    run(BREAKER, breaker, 1, 120);
    expect(breaker.value).toBe(1);

    const mode = createBoundState();
    stepBound(SWITCH, mode, 0, FRAME_S);
    expect(stepBound(SWITCH, mode, 2, FRAME_S)).toBe(true);
    expect(mode.value).toBeGreaterThan(0);
    expect(mode.value).toBeLessThan(2);
  });

  it('moves a slide along its range', () => {
    const state = createBoundState();
    stepBound(SLIDER, state, 0, FRAME_S);
    run(SLIDER, state, 50, 200);

    expect(poseOfBound(SLIDER, state)).toBeCloseTo(1, 10);
  });

  it('holds where it is for a reading that is not a number, and asks for no frame', () => {
    const state = createBoundState();
    stepBound(VALVE, state, 50, FRAME_S);

    expect(stepBound(VALVE, state, Number.NaN, FRAME_S)).toBe(false);

    expect(state.value).toBe(50);
    expect(state.previous).toBe(50);
  });

  it('keeps a part with no value at its authored pose', () => {
    const state = createBoundState();

    expect(stepBound(VALVE, state, Number.NaN, FRAME_S)).toBe(false);

    expect(state.value).toBeNull();
    expect(poseOfBound(VALVE, state)).toBeNull();
  });

  it('snaps the next value after a reset, as it does after a reconnect', () => {
    const state = createBoundState();
    stepBound(VALVE, state, 50, FRAME_S);

    resetBoundState(state);
    expect(state.previous).toBeNull();
    expect(stepBound(VALVE, state, 52, FRAME_S)).toBe(false);

    expect(state.value).toBe(52);
  });
});

describe('stepBound for a spin', () => {
  it('starts at the speed of the first reading, and keeps asking for frames while it turns', () => {
    const state = createBoundState();

    expect(stepBound(FAN, state, 900, FRAME_S)).toBe(true);

    expect(state.value).toBeCloseTo(0.75, 10);
    expect(state.angle).toBeCloseTo(integrateAngle(0, 0.75, FRAME_S), 10);
  });

  it('turns faster for a larger reading, and never at the rotor’s speed', () => {
    const slow = createBoundState();
    const fast = createBoundState();

    run(FAN, slow, 450, 120);
    run(FAN, fast, 1420, 120);

    expect(slow.value).toBeCloseTo(0.375, 10);
    expect(fast.value).toBeCloseTo(spinSpeed(1420, [0, 1800]), 10);
    expect(fast.value as number).toBeGreaterThan(slow.value as number);
    expect(fast.value as number).toBeLessThanOrEqual(MAX_VISUAL_REV_PER_S);
  });

  it('asks for a frame at every step of a steady turn, so the canvas stays awake', () => {
    const state = createBoundState();

    const { asked } = run(FAN, state, 1000, 300);

    expect(asked).toBe(300);
  });

  it('eases a drop to a live zero to a stop within about a second, then lets the canvas sleep', () => {
    const state = createBoundState();
    run(FAN, state, 600, 60);
    expect(state.value).toBeCloseTo(0.5, 10);

    let frames = 0;
    while (stepBound(FAN, state, 0, FRAME_S) && frames < 600) frames += 1;

    // λ = 8: about 0.8 s to within a thousandth of the span.
    expect(frames * FRAME_S).toBeLessThan(1);
    expect(frames).toBeGreaterThan(20);
    expect(state.value).toBe(0);
    expect(stepBound(FAN, state, 0, FRAME_S)).toBe(false);
  });

  it('stops at once when the reading falls by half the range or more (the snap rule)', () => {
    const state = createBoundState();
    run(FAN, state, 1420, 60);

    expect(stepBound(FAN, state, 0, FRAME_S)).toBe(false);

    expect(state.value).toBe(0);
  });

  it('keeps the angle where it stopped', () => {
    const state = createBoundState();
    run(FAN, state, 600, 30);
    run(FAN, state, 0, 120);
    const stopped = state.angle;

    run(FAN, state, 0, 30);

    expect(state.angle).toBe(stopped);
  });

  it('keeps the angle in [0, 2π) however long it turns', () => {
    const state = createBoundState();

    run(FAN, state, 1800, 2000, 0.1);

    expect(state.angle).toBeGreaterThanOrEqual(0);
    expect(state.angle).toBeLessThan(2 * Math.PI);
  });

  it('does not turn, or ask for a frame, for a first reading of zero', () => {
    const state = createBoundState();

    expect(stepBound(FAN, state, 0, FRAME_S)).toBe(false);

    expect(state.value).toBe(0);
    expect(state.angle).toBe(0);
  });

  it('holds for a reading that is not a number: no integration, no frame', () => {
    const state = createBoundState();
    run(FAN, state, 900, 30);
    const { value, angle } = state;

    expect(stepBound(FAN, state, Number.NaN, FRAME_S)).toBe(false);

    expect(state.value).toBe(value);
    expect(state.angle).toBe(angle);
  });

  it('does nothing for a spin with no range', () => {
    const state = createBoundState();

    expect(stepBound(binding('spin', NUMBER_RPM), state, 900, FRAME_S)).toBe(false);

    expect(state.value).toBeNull();
  });
});

describe('stepBound for a tint', () => {
  it('is not stepped: no state, no frame', () => {
    const state = createBoundState();

    expect(stepBound(MOTOR, state, 50, FRAME_S)).toBe(false);

    expect(state).toEqual(createBoundState());
  });
});

describe('poseOfBound', () => {
  it('is null until the first value, whatever the motion', () => {
    for (const part of [VALVE, SLIDER, FAN, MOTOR]) {
      expect(poseOfBound(part, createBoundState())).toBeNull();
    }
  });

  it('is radians for a turn, metres for a slide and the integrated angle for a spin', () => {
    const valve = createBoundState();
    stepBound(VALVE, valve, 100, FRAME_S);
    expect(poseOfBound(VALVE, valve)).toBeCloseTo(radians(90), 10);

    const slider = createBoundState();
    stepBound(SLIDER, slider, 100, FRAME_S);
    expect(poseOfBound(SLIDER, slider)).toBeCloseTo(2, 10);

    const fan = createBoundState();
    stepBound(FAN, fan, 900, FRAME_S);
    expect(poseOfBound(FAN, fan)).toBe(fan.angle);
  });

  it('is null for a tint even when a value is set', () => {
    expect(poseOfBound(MOTOR, { value: 5, angle: 0, previous: 5 })).toBeNull();
  });
});
