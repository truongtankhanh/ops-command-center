import type { TelemetryRule } from '@occ/contracts';
import type { RuleEvidence } from './rule-evidence';

/**
 * A reading is stale after this many of its point's intervals, the same rule the console applies
 * (ADR-0019, "Freshness"; asset-classes.md). A silence longer than that means the breach was not
 * observed for the whole of its `for_s`, so the dwell starts again.
 */
export const STALE_AFTER_INTERVALS = 3;

/**
 * What the machine reads of a rule and of the point it watches. `expectedIntervalS` is the
 * point's, attached once when the rules are selected (`rule-selection.ts`), so a reading does not
 * cost a point lookup.
 */
export type RuleSpec = Pick<TelemetryRule, 'key' | 'comparator' | 'limit' | 'clear' | 'forS'> & {
  expectedIntervalS: number;
};

/**
 * Where one `(asset, rule)` stands (ADR-0018, "How many incidents per breach"). A value, never
 * mutated: the caller keeps the state it had until it has acted on the step's result, so a failed
 * incident write is retried by feeding the same reading to the same state.
 *
 * `lastAt` is the time of the last usable reading. It is what a gap and an out-of-order reading
 * are measured against; a reading that could not be used does not move it.
 */
export type RuleState =
  | { readonly phase: 'armed'; readonly lastAt: number | null }
  | { readonly phase: 'breaching'; readonly since: number; readonly lastAt: number }
  | { readonly phase: 'raised'; readonly lastAt: number };

/** A rule nobody has fed yet, which is also what a new telemetry leader starts every rule in. */
export const ARMED: RuleState = Object.freeze({ phase: 'armed', lastAt: null });

export interface RuleInput {
  /**
   * Epoch milliseconds the replica received the reading (`receivedAt`), not the device's `at`:
   * ingest is latest-wins by arrival, and `at` can be replaced on clock skew or go backwards.
   */
  at: number;
  /**
   * `unknown` on purpose. Ingest has already dropped what does not fit the point, but the
   * decision of an alarm does not rely on its caller having done so.
   */
  value: unknown;
}

export type RuleAction = { kind: 'none' } | { kind: 'raise'; evidence: RuleEvidence };

export interface RuleStep {
  /** The state to keep once the action has been carried out. */
  state: RuleState;
  action: RuleAction;
}

const NONE: RuleAction = { kind: 'none' };

/**
 * One step of the alarm decision: `armed → breaching → raised → armed`, with `for_s` as the dwell
 * and `clear` as the hysteresis (ADR-0018).
 *
 * - A breach is strictly past `limit`. It raises once it has held for `forS`, and then no more
 *   while the state is `raised`.
 * - `raised` goes back to `armed` only when a reading is at or past `clear`, never because the
 *   incident was resolved: a resolved incident whose equipment is still over the limit must not
 *   open a new one on the next reading.
 * - In `breaching`, a reading that is not a breach, the hysteresis band included, starts the dwell
 *   over: the condition "past `limit`" was not held.
 * - A silence of more than `STALE_AFTER_INTERVALS` intervals resets `breaching`, then the reading
 *   is judged as from `armed`. A gap never touches `raised`: the incident exists, and only a
 *   reading past `clear` says the equipment recovered.
 * - A reading that cannot be used (a non-finite time or number, a string, which is how an enum
 *   point reads) or that is older than the last one is ignored: it does not advance, raise or
 *   reset anything.
 *
 * A boolean compares as `1` / `0`, so `above 0.5` is "true" and `below 0.5` is "false"
 * (asset-classes.md). Pure: no clock, no timer, no I/O, nothing mutated, and it never throws.
 */
export function evaluateRule(state: RuleState, input: RuleInput, rule: RuleSpec): RuleStep {
  const { at } = input;
  const value = comparable(input.value);
  if (!Number.isFinite(at) || value === undefined) return { state, action: NONE };
  if (state.lastAt !== null && at < state.lastAt) return { state, action: NONE };

  const current = state.phase === 'breaching' && isGap(state.lastAt, at, rule) ? ARMED : state;

  switch (current.phase) {
    case 'armed':
      return isBreach(rule, value)
        ? hold(at, at, value, rule)
        : { state: { phase: 'armed', lastAt: at }, action: NONE };
    case 'breaching':
      return isBreach(rule, value)
        ? hold(current.since, at, value, rule)
        : { state: { phase: 'armed', lastAt: at }, action: NONE };
    case 'raised':
      return {
        state: isClear(rule, value)
          ? { phase: 'armed', lastAt: at }
          : { phase: 'raised', lastAt: at },
        action: NONE,
      };
  }
}

/** The breach that began at `since` is still going at `at`: raise if it has lasted `forS`. */
function hold(since: number, at: number, value: number, rule: RuleSpec): RuleStep {
  if (at - since >= rule.forS * 1000) {
    const { key, comparator, limit, forS } = rule;
    return {
      state: { phase: 'raised', lastAt: at },
      action: { kind: 'raise', evidence: { key, value, comparator, limit, forS } },
    };
  }
  return { state: { phase: 'breaching', since, lastAt: at }, action: NONE };
}

function isGap(lastAt: number, at: number, rule: RuleSpec): boolean {
  return at - lastAt > STALE_AFTER_INTERVALS * rule.expectedIntervalS * 1000;
}

function isBreach(rule: RuleSpec, value: number): boolean {
  return rule.comparator === 'above' ? value > rule.limit : value < rule.limit;
}

function isClear(rule: RuleSpec, value: number): boolean {
  return rule.comparator === 'above' ? value <= rule.clear : value >= rule.clear;
}

/** The number a reading compares as, or `undefined` for what a rule cannot compare. */
function comparable(value: unknown): number | undefined {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
