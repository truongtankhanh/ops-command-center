import type { TelemetryValue } from '@occ/contracts';
import { encodeReading } from './telemetry/ringBuffer';
import type { Binding, BindingPoint } from './twinBindings';

/*
 * The motion maths of a bound part (V2-14.3): easing, the snap rule, spin as a visual speed integrated into
 * an angle, and the encoding of a reading into a pose. Pure: no `three`, no DOM, so what runs in `useFrame`
 * and cannot be tested there (a result that depends on the frame rate, a jump, a wrong sign) is tested
 * here. Brief § Worker and render loop and ADR-0020 § State "Settled in V2-14.1" are the specification;
 * `twin/useBoundParts.ts` (V2-14.8) applies it. The functions below it step one part by one frame
 * (`stepBound`) and say what pose that is (`poseOfBound`); the loop writes that pose onto the node.
 *
 * Units, because a `Binding` carries only numbers:
 *  - `turn`: the model's `range` is in degrees and `angleFor` returns radians.
 *  - `slide`: the range is in metres (1 unit = 1 m, the model contract) and `offsetFor` returns metres.
 *  - `spin`: a speed is in revolutions a second and an angle in radians, wrapped into `[0, 2π)` so a fan
 *    that has run for days does not lose precision.
 * An encoded value (`targetFor`) is in the point's own domain: a number as it is, a boolean 0 / 1, an enum
 * its index. A step's size is always compared as a fraction of a span, which is the same in every linear
 * unit, so the readings, the domain and the pose agree.
 *
 * No function throws, and none invents a `NaN`: an input that cannot move anything leaves the value where it is.
 */

/** λ of the brief: about 90 % of a step in 290 ms (1 − e^(−8·0.29) = 0.90). */
export const EASE_LAMBDA = 8;

/** V2-14.1: the visual speed of a part whose reading is at the top of its range, in rev/s. */
export const MAX_VISUAL_REV_PER_S = 1.5;

/** A value is "arrived" within this fraction of the bound's span, so the loop can sleep. */
export const SETTLE_EPSILON = 0.001;

/**
 * A step of at least this fraction of the bound's span snaps instead of easing (a restart, a reconnect). The
 * brief says "larger than the bound's range", which no in-domain step can be (the largest is the whole
 * span, and the API drops a reading outside `min`/`max`), so the threshold is a fraction of it.
 */
export const SNAP_FRACTION = 0.5;

/**
 * The longest step the render loop takes, in seconds. A demand-mode canvas that has slept for a minute gets a
 * `delta` of a minute on its next frame, which would turn a spinning part by an arbitrary angle; easing
 * converges for any step, so clamping changes nothing for it.
 */
export const MAX_FRAME_DT_S = 0.1;

const TWO_PI = 2 * Math.PI;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** `x` moved toward `target` by `dtS` seconds, whatever the frame rate: two 16 ms steps equal one 32 ms step. */
export function easeToward(x: number, target: number, dtS: number, lambda = EASE_LAMBDA): number {
  if (!Number.isFinite(target)) return x;
  if (!Number.isFinite(x)) return target;
  if (!(dtS > 0) || !Number.isFinite(dtS) || !(lambda > 0) || !Number.isFinite(lambda)) return x;
  return x + (target - x) * (1 - Math.exp(-lambda * dtS));
}

/** Whether `x` is as good as at `target`, within `SETTLE_EPSILON` of the span. Nothing to move toward counts as settled. */
export function hasSettled(x: number, target: number, span: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(target) || !Number.isFinite(span)) return true;
  return Math.abs(target - x) <= SETTLE_EPSILON * Math.abs(span);
}

/**
 * Whether a step from `previous` to `next` snaps: the first value (`previous` is `null`, after a model loads
 * or after the caller has reset on a reconnect), or a step of at least `SNAP_FRACTION` of `range`'s span.
 * The three arguments share one unit. A `next` that is not a number never snaps; a range with no width
 * has no size to compare.
 */
export function shouldSnap(
  previous: number | null,
  next: number,
  range: readonly [number, number],
): boolean {
  if (!Number.isFinite(next)) return false;
  if (previous === null || !Number.isFinite(previous)) return true;
  const span = range[1] - range[0];
  return Number.isFinite(span) && span > 0 && Math.abs(next - previous) >= SNAP_FRACTION * span;
}

/** The span an encoded value is mapped from: a number's `[min, max]`, a boolean's `[0, 1]`, an enum's `[0, n − 1]`. */
export function domainOf(point: BindingPoint): [number, number] {
  switch (point.kind) {
    case 'boolean':
      return [0, 1];
    case 'enum':
      return [0, Math.max((point.enumValues?.length ?? 0) - 1, 0)];
    default: {
      // A number with an open bound never reaches here (V2-14.2 drops it as `no-domain`): no width, so no division.
      const { min, max } = point;
      return typeof min === 'number' && typeof max === 'number' && Number.isFinite(min + max)
        ? [min, max]
        : [0, 0];
    }
  }
}

/**
 * `shouldSnap` for a binding, with the exception the rule needs: a boolean or an enum is discrete, so by
 * size it always eases (a breaker closing is a 290 ms motion, not a jump), and so does a `tint`, which does
 * not move. Only the first value snaps them. A `spin` compares readings against its `range`; a `turn` or a
 * `slide` compares encoded values against the point's domain.
 */
export function snapFor(binding: Binding, previous: number | null, next: number): boolean {
  if (!Number.isFinite(next)) return false;
  if (previous === null || !Number.isFinite(previous)) return true;
  if (binding.motion === 'tint' || binding.point.kind !== 'number') return false;
  if (binding.motion === 'spin') {
    return binding.range === undefined ? false : shouldSnap(previous, next, binding.range);
  }
  return shouldSnap(previous, next, domainOf(binding.point));
}

/** The visual speed, in rev/s, of a spinning part: proportional to the reading, never the rotor's real speed. */
export function spinSpeed(reading: number, range: readonly [number, number]): number {
  const top = range[1];
  if (!Number.isFinite(reading) || !Number.isFinite(top) || top <= 0) return 0;
  return clamp(reading / top, 0, 1) * MAX_VISUAL_REV_PER_S;
}

const wrapAngle = (angle: number): number => {
  const wrapped = angle % TWO_PI;
  const positive = wrapped < 0 ? wrapped + TWO_PI : wrapped;
  // A tiny negative angle plus a turn rounds to exactly one turn.
  return positive >= TWO_PI ? 0 : positive;
};

/** `angle` (radians) turned by `speed` (rev/s) for `dtS` seconds, in `[0, 2π)`. */
export function integrateAngle(angle: number, speed: number, dtS: number): number {
  const start = Number.isFinite(angle) ? angle : 0;
  if (!(dtS > 0) || !Number.isFinite(dtS) || !Number.isFinite(speed)) return wrapAngle(start);
  return wrapAngle(start + speed * TWO_PI * dtS);
}

/**
 * The number a binding wants for a value, in the point's domain units (ADR-0020 § State): `null` when the
 * value is absent, when its type is not the point's kind (a flag for a number, a word that is not one of
 * the enum's values), when it is not finite, and for a `tint`, which shows alarm, not value. A `spin`'s
 * target is the reading itself; `spinSpeed` turns it into a speed.
 */
export function targetFor(binding: Binding, value: TelemetryValue | undefined): number | null {
  if (value === undefined || binding.motion === 'tint') return null;
  const { kind, enumValues } = binding.point;
  switch (kind) {
    case 'number':
      return typeof value === 'number' ? encodeReading(value, null) : null;
    case 'boolean':
      return typeof value === 'boolean' ? encodeReading(value, null) : null;
    case 'enum':
      return typeof value === 'string' ? encodeReading(value, enumValues) : null;
    default:
      return null;
  }
}

/** An encoded value mapped linearly, clamped, from the point's domain onto the binding's `range`. */
function poseOf(binding: Binding, encoded: number): number | null {
  if (!Number.isFinite(encoded) || binding.range === undefined) return null;
  const [from, to] = domainOf(binding.point);
  const [low, high] = binding.range;
  const fraction = to > from ? clamp((encoded - from) / (to - from), 0, 1) : 0;
  return low + fraction * (high - low);
}

/**
 * A `turn` part's angle in radians for an encoded value. The brief's "shortest path" is the scene's
 * quaternion slerp: a range is narrower than half a turn, so there is no path to choose here.
 * `null` for any other motion, or when there is no range or no number.
 */
export function angleFor(binding: Binding, encoded: number): number | null {
  const degrees = binding.motion === 'turn' ? poseOf(binding, encoded) : null;
  return degrees === null ? null : (degrees * Math.PI) / 180;
}

/** A `slide` part's offset in metres for an encoded value; `null` for any other motion, or no range or number. */
export function offsetFor(binding: Binding, encoded: number): number | null {
  return binding.motion === 'slide' ? poseOf(binding, encoded) : null;
}

/** The frame's `delta` as the loop uses it: clamped to `MAX_FRAME_DT_S`, and `0` for a step that is not usable. */
export function frameDt(deltaS: number): number {
  return Number.isFinite(deltaS) && deltaS > 0 ? Math.min(deltaS, MAX_FRAME_DT_S) : 0;
}

/**
 * Where one bound part is between frames (V2-14.8). Plain numbers, mutated in place by `stepBound`, so the loop
 * allocates nothing.
 */
export interface BoundState {
  /**
   * `turn` / `slide`: the eased encoded value, in the point's domain units. `spin`: the eased visual speed in
   * rev/s. `null` until the first value, while the part sits at its authored pose.
   */
  value: number | null;
  /** `spin` only: the integrated angle in radians, in `[0, 2π)`. */
  angle: number;
  /** The last reading seen, the previous side of `snapFor`; `null` means the next value snaps. */
  previous: number | null;
}

export const createBoundState = (): BoundState => ({ value: null, angle: 0, previous: null });

/** Makes the next value snap instead of ease: the first one after a reconnect (brief § Worker and render loop). */
export function resetBoundState(state: BoundState): void {
  state.previous = null;
}

/** A `turn` / `slide` part: ease the encoded value toward the reading, snapping on the first value or a large step. */
function stepPose(binding: Binding, state: BoundState, reading: number, dtS: number): boolean {
  const [from, to] = domainOf(binding.point);
  state.value =
    state.value === null || snapFor(binding, state.previous, reading)
      ? reading
      : easeToward(state.value, reading, dtS);
  state.previous = reading;
  if (hasSettled(state.value, reading, to - from)) {
    state.value = reading;
    return false;
  }
  return true;
}

/**
 * A `spin` part: ease the visual **speed** toward the reading's, then integrate the angle, so a fan never jumps
 * or reverses when a reading arrives. The speed is settled to exactly the target (a stop is exactly 0), and
 * the part asks for frames for as long as it turns.
 */
function stepSpin(binding: Binding, state: BoundState, reading: number, dtS: number): boolean {
  if (binding.range === undefined) return false;
  const target = spinSpeed(reading, binding.range);
  state.value =
    state.value === null || snapFor(binding, state.previous, reading)
      ? target
      : easeToward(state.value, target, dtS);
  state.previous = reading;
  if (hasSettled(state.value, target, MAX_VISUAL_REV_PER_S)) state.value = target;
  if (state.value > 0) state.angle = integrateAngle(state.angle, state.value, dtS);
  return state.value > 0;
}

/**
 * Advances one bound part by one frame of `dtS` seconds toward `reading` (an encoded number from the targets
 * buffer: a number as it is, a boolean 0 / 1, an enum its index) and says whether it needs another frame.
 * That answer is the "needs a frame" predicate of the demand-mode canvas: `true` while a value has not settled
 * and while a part spins, `false` for a part at rest. A `tint` is not stepped here (V2-14.9). A reading that
 * is not a number (no value yet, or a layout just rebuilt) changes nothing and asks for nothing: the part
 * holds where it is.
 */
export function stepBound(
  binding: Binding,
  state: BoundState,
  reading: number,
  dtS: number,
): boolean {
  if (binding.motion === 'tint' || !Number.isFinite(reading)) return false;
  return binding.motion === 'spin'
    ? stepSpin(binding, state, reading, dtS)
    : stepPose(binding, state, reading, dtS);
}

/**
 * What to write onto the node: radians about the axis for a `turn`, metres along it for a `slide`, the
 * integrated angle for a `spin`. `null` for a `tint` and for a part with no value yet, which stays at the pose
 * it was authored in.
 */
export function poseOfBound(binding: Binding, state: BoundState): number | null {
  if (state.value === null) return null;
  switch (binding.motion) {
    case 'spin':
      return state.angle;
    case 'turn':
      return angleFor(binding, state.value);
    case 'slide':
      return offsetFor(binding, state.value);
    default:
      return null;
  }
}
