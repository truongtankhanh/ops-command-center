import type { TelemetryPoint, TelemetryRule, TelemetryValue } from '@occ/contracts';

/** What the waveform reads of a point: the contract's `TelemetryPoint`, or a seed's `PointSeed`. */
export type WaveformPoint = Pick<
  TelemetryPoint,
  'key' | 'kind' | 'min' | 'max' | 'enumValues' | 'expectedIntervalS'
>;

/** What the waveform reads of a rule: the contract's `TelemetryRule`, or a seed's `RuleSeed`. */
export type WaveformRule = Pick<TelemetryRule, 'key' | 'comparator' | 'limit' | 'clear'>;

// A number swings around the middle of its safe band by a quarter of the band and wobbles by a
// twentieth, so it stays inside 20-80 % of the band whatever the phase.
const AMPLITUDE = 0.25;
const JITTER = 0.05;
const PERIOD_MIN_S = 600;
const PERIOD_SPAN_S = 600;

// A counter (a point with no maximum, like run hours) starts at a per-asset base and grows with
// the clock, so it never goes backwards and every replica agrees on it.
const COUNTER_EPOCH_MS = Date.UTC(2026, 0, 1);
const COUNTER_BASE_MIN = 1_000;
const COUNTER_BASE_SPAN = 9_000;
const HOUR_MS = 3_600_000;

// A boolean that no rule cares about reads `true`, except in one ten-minute window in twenty, so a
// console sees the odd Standby.
const BOOLEAN_WINDOW_MS = 600_000;
const FALSE_ONE_IN = 20;

// An enum keeps a value for this many of its point's intervals before moving on.
const ENUM_HOLD_INTERVALS = 20;

/**
 * FNV-1a, 32-bit, then a murmur3 finaliser: dependency-free, the same everywhere, and spread
 * evenly enough for a waveform. Not for anything that needs to be unpredictable.
 */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A repeatable number in `[0, 1)` for these parts. */
function unit(...parts: Array<string | number>): number {
  return hash(parts.join('|')) / 2 ** 32;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * The values of a `number` point that keep it out of every rule on its key: inside its range, and
 * on the safe side of each rule's `clear` level. `hi` is `Infinity` for a point with no maximum
 * and no `above` rule. Contradictory rules give `lo > hi`; the caller decides what that means.
 */
export function safeBand(
  point: WaveformPoint,
  rules: readonly WaveformRule[],
): { lo: number; hi: number } {
  let hi = point.max ?? Infinity;
  let lo = point.min ?? Math.min(0, hi);
  for (const rule of rules) {
    if (rule.key !== point.key) continue;
    if (rule.comparator === 'above') hi = Math.min(hi, rule.clear);
    else lo = Math.max(lo, rule.clear);
  }
  return { lo, hi };
}

function numberAt(
  assetCode: string,
  point: WaveformPoint,
  rules: readonly WaveformRule[],
  boundaryMs: number,
): number {
  const { lo, hi } = safeBand(point, rules);
  if (hi === Infinity) {
    const base = lo + COUNTER_BASE_MIN + unit(assetCode, point.key, 'base') * COUNTER_BASE_SPAN;
    return round2(base + Math.max(0, boundaryMs - COUNTER_EPOCH_MS) / HOUR_MS);
  }
  if (lo >= hi) return round2((lo + hi) / 2);

  const periodMs = (PERIOD_MIN_S + unit(assetCode, point.key, 'period') * PERIOD_SPAN_S) * 1000;
  const phase = unit(assetCode, point.key, 'phase') * 2 * Math.PI;
  const wave = Math.sin((2 * Math.PI * boundaryMs) / periodMs + phase);
  const jitter = unit(assetCode, point.key, boundaryMs) * 2 - 1;
  const value = lo + (hi - lo) * (0.5 + AMPLITUDE * wave + JITTER * jitter);
  // Rounding can step out of a very narrow band by half a hundredth.
  return Math.min(hi, Math.max(lo, round2(value)));
}

function booleanAt(
  assetCode: string,
  point: WaveformPoint,
  rules: readonly WaveformRule[],
  boundaryMs: number,
): boolean {
  // A boolean compares as 1 and 0 (ADR-0018), so each value is safe or not like a number would be.
  const ofKey = rules.filter((rule) => rule.key === point.key);
  const isSafe = (value: 0 | 1): boolean =>
    ofKey.every((rule) =>
      rule.comparator === 'above' ? value <= rule.clear : value >= rule.clear,
    );
  const trueIsSafe = isSafe(1);
  const falseIsSafe = isSafe(0);

  if (trueIsSafe && falseIsSafe) {
    const window = Math.floor(boundaryMs / BOOLEAN_WINDOW_MS);
    return Math.floor(unit(assetCode, point.key, 'window', window) * FALSE_ONE_IN) !== 0;
  }
  // Contradictory rules leave no safe value: `true`, as an unconstrained boolean mostly is.
  return trueIsSafe || !falseIsSafe;
}

function enumAt(
  assetCode: string,
  point: WaveformPoint,
  boundaryMs: number,
): TelemetryValue | undefined {
  const values = point.enumValues;
  if (!values || values.length === 0) return undefined;
  const holdMs = point.expectedIntervalS * 1000 * ENUM_HOLD_INTERVALS;
  const offset = Math.floor(unit(assetCode, point.key, 'enum') * values.length);
  return values[(Math.floor(boundaryMs / holdMs) + offset) % values.length];
}

/**
 * What a healthy asset reports for one point at one boundary instant (ADR-0019). A pure function
 * of its arguments, with no clock and no randomness, so every replica produces the same reading
 * with no coordination.
 *
 * "Healthy" is deliberate: the value stays on the safe side of every rule given in `rules`, so the
 * generator alone never raises an incident. A breach is a scripted event, never a drift. `rules`
 * are the asset's resolved, enabled rules; a rule that was switched off is not in the list, and the
 * value may then leave its band.
 *
 * `undefined` for an `enum` point with no values, which the database forbids.
 */
export function valueAt(
  assetCode: string,
  point: WaveformPoint,
  rules: readonly WaveformRule[],
  boundaryMs: number,
): TelemetryValue | undefined {
  switch (point.kind) {
    case 'number':
      return numberAt(assetCode, point, rules, boundaryMs);
    case 'boolean':
      return booleanAt(assetCode, point, rules, boundaryMs);
    case 'enum':
      return enumAt(assetCode, point, boundaryMs);
  }
}
