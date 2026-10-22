import type { TelemetryPoint, TelemetryRule, TelemetryValue } from '@occ/contracts';

/** What the scenario reads of a point: the contract's `TelemetryPoint`, or a seed's `PointSeed`. */
export type ScenarioPoint = Pick<
  TelemetryPoint,
  'key' | 'kind' | 'min' | 'max' | 'expectedIntervalS'
>;

/** What the scenario reads of a rule: the contract's `TelemetryRule`, or a seed's `RuleSeed`. */
export type ScenarioRule = Pick<TelemetryRule, 'key' | 'comparator' | 'limit' | 'forS'>;

/**
 * One scripted breach: the point `key` of the asset `assetCode` is held past its rule's `limit`
 * for a window of every cycle (ADR-0018, ADR-0019).
 */
export interface DemoScenarioEntry {
  assetCode: string;
  key: string;
  /** Seconds between two window openings. Anchored to the epoch, never to this process. */
  cycleS: number;
  /** Seconds after each cycle boundary at which the window opens. */
  offsetS: number;
  /** Seconds added to the dwell the rule asks for; `DEFAULT_MARGIN_S` when absent. */
  marginS?: number;
}

/**
 * The demo's breaches (frames 04 and 10, `unverified`: open question 7).
 *
 * - `CT-01` `motorTempC`: 92 °C for 80 s every 10 minutes, opening at minute 1 so a fresh
 *   `docker compose up` does not alarm in its first second.
 * - `LKS-B3` `leakDetected`: `true` for 620 s once an hour, opening at minute 20. It takes two
 *   readings, 300 s apart, to raise (see `windowMs`).
 *
 * The windows of the two overlap at times, which is harmless: they are two assets.
 */
export const DEMO_SCENARIO: readonly DemoScenarioEntry[] = [
  { assetCode: 'CT-01', key: 'motorTempC', cycleS: 600, offsetS: 60 },
  { assetCode: 'LKS-B3', key: 'leakDetected', cycleS: 3_600, offsetS: 1_200 },
];

/**
 * The slack in a window beyond what the rule needs. The rule engine measures the dwell with the
 * time the replica received each reading, and a timer drifts by milliseconds: a window of exactly
 * `for_s` plus one interval can miss the completing reading by one boundary. Ten seconds covers
 * that drift many times over and is short enough to read as "a little over `for_s`".
 */
export const DEFAULT_MARGIN_S = 10;

/** How far past `limit` a number is held, in the unit of its point: 85 °C reads 92 °C. */
const OVERSHOOT = 7;

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** A modulo that stays in `[0, m)` for a negative `n`, which a time before the offset gives. */
const mod = (n: number, m: number): number => ((n % m) + m) % m;

/**
 * How long a window is open, for the point and the rule it breaches. `for_s` is the dwell. A
 * breach is decided on the reading that arrives `for_s` after the first one, so the window needs
 * two more boundaries than the dwell alone: one for the reading that starts it, and one to absorb
 * a boundary that falls just short. Hence `for_s + 2 × interval + margin`: 80 s for a 5 s point
 * with a `for_s` of 60, and 620 s for a 300 s point with a `for_s` of 10, which still holds two
 * 300 s boundaries whatever the alignment (the second is the one that raises).
 */
function windowMs(rule: ScenarioRule, point: ScenarioPoint, entry: DemoScenarioEntry): number {
  const marginS = entry.marginS ?? DEFAULT_MARGIN_S;
  return (rule.forS + 2 * point.expectedIntervalS + marginS) * 1000;
}

/**
 * The value that is strictly past `limit` and still a value the point accepts, or `undefined` when
 * there is none (a point whose range ends at the limit cannot breach). A boolean reads as 1 / 0 in
 * a rule (ADR-0018), so it is `true` for an `above` rule and `false` for a `below` one, if that is
 * past the limit.
 */
function breachValue(point: ScenarioPoint, rule: ScenarioRule): TelemetryValue | undefined {
  if (point.kind === 'boolean') {
    const candidate = rule.comparator === 'above' ? 1 : 0;
    const past = rule.comparator === 'above' ? candidate > rule.limit : candidate < rule.limit;
    return past ? candidate === 1 : undefined;
  }

  if (rule.comparator === 'above') {
    const value = round2(rule.limit + OVERSHOOT);
    const capped = point.max === null ? value : Math.min(value, point.max);
    return capped > rule.limit ? capped : undefined;
  }
  const value = round2(rule.limit - OVERSHOOT);
  const floored = point.min === null ? value : Math.max(value, point.min);
  return floored < rule.limit ? floored : undefined;
}

/**
 * What a scripted breach makes of one point at one boundary instant, or `undefined` when the
 * waveform stands: no entry for this asset and key, outside every window, or nothing to script.
 *
 * A pure function of its arguments, with no clock and no randomness, so every replica agrees with
 * no coordination (as `valueAt`). The values come from the asset's **resolved, enabled** rule
 * (`rules` is `CatalogueAsset.rules`), so an operator's change of the limit still breaches, and a
 * rule that was switched off scripts nothing. It is also why nothing here can make a healthy asset
 * breach: an entry names one asset and one key, and every other pair is `undefined`.
 *
 * Nothing is scripted either when the point is an `enum`, when no value can get past the limit
 * inside the point's range, or when the window does not fit in the cycle.
 *
 * After a window the caller falls back to `valueAt`, which is on the safe side of `clear` by
 * construction, so "returns below 80" needs no recovery value of its own.
 */
export function scenarioValueAt(
  entries: readonly DemoScenarioEntry[],
  assetCode: string,
  point: ScenarioPoint,
  rules: readonly ScenarioRule[],
  boundaryMs: number,
): TelemetryValue | undefined {
  if (point.kind === 'enum') return undefined;
  const rule = rules.find((each) => each.key === point.key);
  if (rule === undefined) return undefined;

  for (const entry of entries) {
    if (entry.assetCode !== assetCode || entry.key !== point.key) continue;
    const cycleMs = entry.cycleS * 1000;
    const open = windowMs(rule, point, entry);
    if (!(cycleMs > 0) || open >= cycleMs) continue;
    if (mod(boundaryMs - entry.offsetS * 1000, cycleMs) >= open) continue;
    return breachValue(point, rule);
  }
  return undefined;
}

/** One line for the log, once at start: which breaches are scripted and how often. */
export function scenarioSummary(entries: readonly DemoScenarioEntry[]): string {
  return entries
    .map((entry) => `${entry.assetCode}/${entry.key} every ${entry.cycleS} s`)
    .join(', ');
}
