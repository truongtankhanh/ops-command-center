import { ASSET_CLASSES } from '../../database/seed/asset-catalogue';
import { formatRuleEvidence } from './rule-evidence';
import {
  ARMED,
  evaluateRule,
  type RuleAction,
  type RuleSpec,
  type RuleState,
  STALE_AFTER_INTERVALS,
} from './rule-state';

const SECOND = 1000;
const T0 = Date.UTC(2026, 9, 14, 12, 0, 0);

/** The rule drawn in frames 04 and 10: above 85 for 60 s, clears at 80. */
const motor: RuleSpec = {
  key: 'motorTempC',
  comparator: 'above',
  limit: 85,
  clear: 80,
  forS: 60,
  expectedIntervalS: 10,
};

/** A below rule: low fuel, below 25 for 300 s, clears at 30. */
const fuel: RuleSpec = {
  key: 'fuelLevelPct',
  comparator: 'below',
  limit: 25,
  clear: 30,
  forS: 300,
  expectedIntervalS: 60,
};

type Series = ReadonlyArray<readonly [seconds: number, value: unknown]>;

interface Fed {
  state: RuleState;
  actions: RuleAction[];
  raisedAt: number[];
}

/** Folds `evaluateRule` over a series; times are seconds after `T0`. */
function feed(rule: RuleSpec, series: Series, from: RuleState = ARMED): Fed {
  let state = from;
  const actions: RuleAction[] = [];
  const raisedAt: number[] = [];
  for (const [seconds, value] of series) {
    const step = evaluateRule(state, { at: T0 + seconds * SECOND, value }, rule);
    state = step.state;
    actions.push(step.action);
    if (step.action.kind === 'raise') raisedAt.push(seconds);
  }
  return { state, actions, raisedAt };
}

/** `from`, `from + step`, … up to and including `to`. */
function ticks(from: number, to: number, step = 10): number[] {
  const times: number[] = [];
  for (let t = from; t <= to; t += step) times.push(t);
  return times;
}

const reading = (value: unknown, times: readonly number[]): Series =>
  times.map((seconds) => [seconds, value] as const);

const stateAfter = (rule: RuleSpec, series: Series): RuleState => feed(rule, series).state;

describe('evaluateRule', () => {
  describe('the 85 / 80 / 60 s rule', () => {
    it('raises nothing for a breach shorter than for_s', () => {
      const fed = feed(motor, reading(90, ticks(0, 50)));

      expect(fed.raisedAt).toEqual([]);
      expect(fed.state).toMatchObject({ phase: 'breaching', since: T0 });
    });

    it('raises once, when the breach has lasted for_s, with the evidence of that reading', () => {
      const series: Series = [...reading(90, ticks(0, 50)), [60, 92]];

      const fed = feed(motor, series);

      expect(fed.raisedAt).toEqual([60]);
      const raise = fed.actions.at(-1);
      expect(raise).toEqual({
        kind: 'raise',
        evidence: { key: 'motorTempC', value: 92, comparator: 'above', limit: 85, forS: 60 },
      });
      expect(raise?.kind === 'raise' && formatRuleEvidence(raise.evidence)).toBe(
        'motorTempC 92 > 85 for 60 s',
      );
      expect(fed.state).toEqual({ phase: 'raised', lastAt: T0 + 60 * SECOND });
    });

    it('raises nothing more while the breach goes on', () => {
      const fed = feed(motor, reading(90, ticks(0, 300)));

      expect(fed.raisedAt).toEqual([60]);
      expect(fed.state.phase).toBe('raised');
    });

    it('does not treat the limit itself as a breach', () => {
      const fed = feed(motor, reading(85, ticks(0, 120)));

      expect(fed.raisedAt).toEqual([]);
      expect(fed.state).toEqual({ phase: 'armed', lastAt: T0 + 120 * SECOND });
    });

    it('re-arms only at clear, not at the limit nor inside the band', () => {
      const raised = stateAfter(motor, reading(90, ticks(0, 60)));

      const atLimit = feed(motor, [[70, 85]], raised);
      expect(atLimit.state.phase).toBe('raised');
      const inBand = feed(
        motor,
        [
          [70, 84],
          [80, 81],
        ],
        raised,
      );
      expect(inBand.state.phase).toBe('raised');
      const atClear = feed(motor, [[70, 80]], raised);
      expect(atClear.state.phase).toBe('armed');
      const pastClear = feed(motor, [[70, 79]], raised);
      expect(pastClear.state.phase).toBe('armed');
    });

    it('raises again after a re-arm and a new sustained breach', () => {
      const series: Series = [
        ...reading(90, ticks(0, 60)),
        [70, 78],
        ...reading(90, ticks(80, 140)),
      ];

      expect(feed(motor, series).raisedAt).toEqual([60, 140]);
    });

    it('does not re-arm because the incident was resolved: the reading decides', () => {
      // The machine has no notion of "resolved": a rule still over the limit stays raised, so a
      // resolved incident does not open a new one on the next reading.
      const fed = feed(motor, reading(90, ticks(0, 600)));

      expect(fed.raisedAt).toEqual([60]);
    });

    it('starts the dwell over when a reading falls back into the hysteresis band', () => {
      const series: Series = [
        ...reading(90, ticks(0, 20)),
        [30, 82],
        ...reading(90, ticks(40, 90)),
      ];

      // 82 is not past the limit: the breach that began at 40 s is the one that counts, so the
      // 60 s are not complete at 90 s, and are at 100 s.
      expect(feed(motor, series).raisedAt).toEqual([]);
      expect(feed(motor, [...series, [100, 90]]).raisedAt).toEqual([100]);
    });

    it('does not change a raised rule for a reading inside the band', () => {
      const raised = stateAfter(motor, reading(90, ticks(0, 60)));

      const step = evaluateRule(raised, { at: T0 + 70 * SECOND, value: 82 }, motor);

      expect(step.action).toEqual({ kind: 'none' });
      expect(step.state).toEqual({ phase: 'raised', lastAt: T0 + 70 * SECOND });
    });
  });

  describe('a below rule (25 / 30 / 300 s)', () => {
    it('mirrors the above rule: breach under the limit, re-arm at or over clear', () => {
      const breaching = reading(20, ticks(0, 300, 60));

      const fed = feed(fuel, breaching);
      expect(fed.raisedAt).toEqual([300]);
      expect(fed.actions.at(-1)).toEqual({
        kind: 'raise',
        evidence: { key: 'fuelLevelPct', value: 20, comparator: 'below', limit: 25, forS: 300 },
      });

      expect(feed(fuel, [[360, 26]], fed.state).state.phase).toBe('raised');
      expect(feed(fuel, [[360, 29]], fed.state).state.phase).toBe('raised');
      expect(feed(fuel, [[360, 30]], fed.state).state.phase).toBe('armed');
    });

    it('does not treat the limit itself as a breach', () => {
      expect(feed(fuel, reading(25, ticks(0, 600, 60))).raisedAt).toEqual([]);
    });
  });

  describe('booleans', () => {
    const leak: RuleSpec = {
      key: 'leakDetected',
      comparator: 'above',
      limit: 0.5,
      clear: 0.5,
      forS: 10,
      expectedIntervalS: 5,
    };
    const inService: RuleSpec = {
      key: 'inService',
      comparator: 'below',
      limit: 0.5,
      clear: 0.5,
      forS: 300,
      expectedIntervalS: 30,
    };

    it('compares true as 1 and false as 0 on an above 0.5 rule', () => {
      const fed = feed(leak, reading(true, ticks(0, 10, 5)));

      expect(fed.raisedAt).toEqual([10]);
      expect(fed.actions.at(-1)).toEqual({
        kind: 'raise',
        evidence: { key: 'leakDetected', value: 1, comparator: 'above', limit: 0.5, forS: 10 },
      });
      expect(feed(leak, reading(false, ticks(0, 60, 5))).raisedAt).toEqual([]);
    });

    it('compares false as the breach on a below 0.5 rule', () => {
      const fed = feed(inService, reading(false, ticks(0, 300, 30)));

      expect(fed.raisedAt).toEqual([300]);
      expect(fed.actions.at(-1)).toMatchObject({ evidence: { value: 0, comparator: 'below' } });
      expect(feed(inService, reading(true, ticks(0, 600, 30))).raisedAt).toEqual([]);
    });

    it('re-arms on the first reading that is not the breach, because clear equals limit', () => {
      const raised = stateAfter(leak, reading(true, ticks(0, 10, 5)));

      expect(feed(leak, [[15, true]], raised).state.phase).toBe('raised');
      expect(feed(leak, [[15, false]], raised).state.phase).toBe('armed');
    });

    it('reads a 1 and a 0 as numbers the same way', () => {
      expect(feed(leak, reading(1, ticks(0, 10, 5))).raisedAt).toEqual([10]);
      expect(feed(leak, reading(0, ticks(0, 60, 5))).raisedAt).toEqual([]);
    });
  });

  describe('a gap in the readings', () => {
    const threshold = STALE_AFTER_INTERVALS * motor.expectedIntervalS;

    it('is more than three intervals; exactly three is not a gap', () => {
      const atThreshold = feed(motor, [
        [0, 90],
        [threshold, 90],
      ]);
      expect(atThreshold.state).toMatchObject({ phase: 'breaching', since: T0 });

      const past = feed(motor, [
        [0, 90],
        [threshold + 1, 90],
      ]);
      expect(past.state).toMatchObject({
        phase: 'breaching',
        since: T0 + (threshold + 1) * SECOND,
      });
    });

    it('resets a breaching rule, so a late reading does not complete the old dwell', () => {
      // Without the reset, 61 s after the first breaching reading would raise.
      const series: Series = [...reading(90, ticks(0, 20)), [61, 90]];

      const fed = feed(motor, series);

      expect(fed.raisedAt).toEqual([]);
      expect(fed.state).toMatchObject({ phase: 'breaching', since: T0 + 61 * SECOND });
    });

    it('goes to armed when the reading after the gap is not a breach', () => {
      const fed = feed(motor, [...reading(90, ticks(0, 20)), [61, 70]]);

      expect(fed.state).toEqual({ phase: 'armed', lastAt: T0 + 61 * SECOND });
    });

    it('never touches a raised rule', () => {
      const raised = stateAfter(motor, reading(90, ticks(0, 60)));

      const stillOver = feed(motor, [[2000, 90]], raised);
      expect(stillOver.state.phase).toBe('raised');
      expect(stillOver.actions).toEqual([{ kind: 'none' }]);
      expect(feed(motor, [[2000, 70]], raised).state.phase).toBe('armed');
    });

    it('is measured from the last usable reading, not from one that was ignored', () => {
      const series: Series = [
        [0, 90],
        [10, 'running'],
        [20, NaN],
        [31, 90],
      ];

      // 31 s after the last usable reading (0 s) is a gap, whatever arrived in between.
      expect(feed(motor, series).state).toMatchObject({
        phase: 'breaching',
        since: T0 + 31 * SECOND,
      });
    });
  });

  describe('input the machine cannot use', () => {
    const breaching: RuleState = { phase: 'breaching', since: T0, lastAt: T0 + 10 * SECOND };
    const raised: RuleState = { phase: 'raised', lastAt: T0 + 10 * SECOND };
    const states: Array<[string, RuleState]> = [
      ['armed', ARMED],
      ['breaching', breaching],
      ['raised', raised],
    ];
    const values: Array<[string, unknown]> = [
      ['an enum value', 'running'],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
      ['undefined', undefined],
      ['null', null],
      ['an object', { value: 90 }],
      ['an array', [90]],
      ['a numeric string', '90'],
    ];

    it.each(states)('leaves a %s rule alone for every kind of unusable value', (_phase, state) => {
      for (const [, value] of values) {
        const step = evaluateRule(state, { at: T0 + 20 * SECOND, value }, motor);

        expect(step.state).toBe(state);
        expect(step.action).toEqual({ kind: 'none' });
      }
    });

    it.each(states)('leaves a %s rule alone for a time that is not a number', (_phase, state) => {
      for (const at of [Number.NaN, Number.POSITIVE_INFINITY]) {
        const step = evaluateRule(state, { at, value: 90 }, motor);

        expect(step.state).toBe(state);
        expect(step.action).toEqual({ kind: 'none' });
      }
    });
  });

  describe('a reading out of order', () => {
    const breaching: RuleState = { phase: 'breaching', since: T0, lastAt: T0 + 20 * SECOND };

    it('is ignored when it is older than the last one, even if it would reset', () => {
      const step = evaluateRule(breaching, { at: T0 + 10 * SECOND, value: 70 }, motor);

      expect(step.state).toBe(breaching);
      expect(step.action).toEqual({ kind: 'none' });
    });

    it('is used when it carries the same time as the last one', () => {
      const step = evaluateRule(breaching, { at: T0 + 20 * SECOND, value: 70 }, motor);

      expect(step.state).toEqual({ phase: 'armed', lastAt: T0 + 20 * SECOND });
    });
  });

  describe('a rule with no dwell', () => {
    it('raises on the first breaching reading', () => {
      const instant: RuleSpec = { ...motor, forS: 0 };

      const fed = feed(instant, [[0, 86]]);

      expect(fed.raisedAt).toEqual([0]);
      expect(fed.actions[0]).toMatchObject({ evidence: { forS: 0, value: 86 } });
    });
  });

  describe('as a value', () => {
    it('does not mutate the state it is given', () => {
      const frozen: RuleState = Object.freeze({
        phase: 'breaching',
        since: T0,
        lastAt: T0 + 50 * SECOND,
      });

      // A raise, a reset and a gap: the three ways the state can change.
      for (const [seconds, value] of [
        [60, 90],
        [55, 70],
        [200, 90],
      ] as const) {
        expect(() =>
          evaluateRule(frozen, { at: T0 + seconds * SECOND, value }, motor),
        ).not.toThrow();
      }
      expect(frozen).toEqual({ phase: 'breaching', since: T0, lastAt: T0 + 50 * SECOND });
    });

    it('raises again for the same reading when the caller keeps the previous state', () => {
      const before = stateAfter(motor, reading(90, ticks(0, 50)));
      const input = { at: T0 + 60 * SECOND, value: 90 };

      const first = evaluateRule(before, input, motor);
      // The incident write failed: the caller does not commit `first.state`.
      const retry = evaluateRule(before, input, motor);

      expect(first.action.kind).toBe('raise');
      expect(retry).toEqual(first);
    });
  });

  describe('the seeded rules', () => {
    interface Seeded {
      label: string;
      rule: RuleSpec;
      breach: unknown;
      safe: unknown;
    }

    // A value past the limit and one past clear, in the kind the point carries: a boolean point is
    // read as a boolean, a number point as a number a unit away from the level.
    const seeded: Seeded[] = ASSET_CLASSES.flatMap((assetClass) =>
      assetClass.rules.map((rule) => {
        const point = assetClass.points.find((candidate) => candidate.key === rule.key);
        if (!point) throw new Error(`${assetClass.code}: no point ${rule.key}`);
        const above = rule.comparator === 'above';
        let breach: unknown;
        let safe: unknown;
        if (point.kind === 'boolean') {
          breach = above;
          safe = !above;
        } else {
          breach = above ? rule.limit + 1 : rule.limit - 1;
          safe = above ? rule.clear - 1 : rule.clear + 1;
        }
        return {
          label: `${assetClass.code} · ${rule.name}`,
          rule: {
            key: rule.key,
            comparator: rule.comparator,
            limit: rule.limit,
            clear: rule.clear,
            forS: rule.forS,
            expectedIntervalS: point.expectedIntervalS,
          },
          breach,
          safe,
        };
      }),
    );

    /** One reading per interval, from 0 to the first one at or past for_s. */
    function breachTimes(rule: RuleSpec): number[] {
      const times = [0];
      let t = 0;
      while (t < rule.forS) {
        t += rule.expectedIntervalS;
        times.push(t);
      }
      return times;
    }

    it('covers the 22 rules of the catalogue', () => {
      expect(seeded).toHaveLength(22);
    });

    it.each(seeded.map((s) => [s.label, s] as const))(
      '%s: raises nothing before for_s, once at for_s, nothing while it lasts',
      (_label, { rule, breach }) => {
        const times = breachTimes(rule);
        const last = times.at(-1) ?? 0;

        const before = feed(rule, reading(breach, times.slice(0, -1)));
        const sustained = feed(rule, [
          ...reading(breach, times),
          ...reading(breach, [last + rule.expectedIntervalS, last + 2 * rule.expectedIntervalS]),
        ]);

        // A rule with no dwell has no "before": its only reading already raises.
        if (rule.forS > 0) {
          expect(before.raisedAt).toEqual([]);
          expect(before.state.phase).toBe('breaching');
        }
        expect(sustained.raisedAt).toEqual([last]);
        expect(sustained.state.phase).toBe('raised');
      },
    );

    it.each(seeded.map((s) => [s.label, s] as const))(
      '%s: re-arms past clear and raises again on a new sustained breach',
      (_label, { rule, breach, safe }) => {
        const times = breachTimes(rule);
        const last = times.at(-1) ?? 0;
        const step = rule.expectedIntervalS;
        const resume = last + step;
        const series: Series = [
          ...reading(breach, times),
          [resume, safe],
          ...reading(
            breach,
            times.map((t) => t + resume + step),
          ),
        ];

        const fed = feed(rule, series);

        expect(fed.raisedAt).toEqual([last, last + 2 * step + last]);
      },
    );

    it.each(seeded.map((s) => [s.label, s] as const))(
      '%s: is not breached at the limit and is re-armed at clear',
      (_label, { rule, breach }) => {
        const raised = stateAfter(rule, reading(breach, breachTimes(rule)));
        // Long after the last breaching reading, whatever the rule's dwell and interval.
        const after = 100_000;

        expect(feed(rule, [[after, rule.limit]]).state.phase).toBe('armed');
        expect(feed(rule, [[after, rule.clear]], raised).state.phase).toBe('armed');
      },
    );

    it.each(seeded.filter((s) => s.rule.clear !== s.rule.limit).map((s) => [s.label, s] as const))(
      '%s: stays raised for a reading between the limit and clear',
      (_label, { rule, breach }) => {
        const raised = stateAfter(rule, reading(breach, breachTimes(rule)));
        const band = (rule.limit + rule.clear) / 2;
        const later = (breachTimes(rule).at(-1) ?? 0) + rule.expectedIntervalS;

        expect(feed(rule, [[later, band]], raised).state.phase).toBe('raised');
      },
    );
  });
});
