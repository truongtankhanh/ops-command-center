import type { TelemetryValue } from '@occ/contracts';
import { ASSET_CLASSES } from '../database/seed/asset-catalogue';
import { ASSETS } from '../database/seed/assets';
import {
  DEFAULT_MARGIN_S,
  DEMO_SCENARIO,
  type DemoScenarioEntry,
  type ScenarioPoint,
  type ScenarioRule,
  scenarioSummary,
  scenarioValueAt,
} from './mock-scenario';
import { valueAt } from './mock-waveform';
import { ARMED, evaluateRule, type RuleState } from './rules/rule-state';

/** A multiple of an hour, so a cycle of 10 or 60 minutes opens exactly at `T0 + offset`. */
const T0 = Date.parse('2026-10-13T08:00:00.000Z');
const DAY_MS = 86_400_000;

const point = (over: Partial<ScenarioPoint> = {}): ScenarioPoint => ({
  key: 'motorTempC',
  kind: 'number',
  min: -20,
  max: 150,
  expectedIntervalS: 5,
  ...over,
});

const rule = (over: Partial<ScenarioRule> = {}): ScenarioRule => ({
  key: 'motorTempC',
  comparator: 'above',
  limit: 85,
  forS: 60,
  ...over,
});

const entry = (over: Partial<DemoScenarioEntry> = {}): DemoScenarioEntry => ({
  assetCode: 'CT-01',
  key: 'motorTempC',
  cycleS: 600,
  offsetS: 60,
  ...over,
});

/** The scenario's value of one point, `seconds` after `T0`. */
function at(
  seconds: number,
  options: {
    entries?: readonly DemoScenarioEntry[];
    code?: string;
    point?: ScenarioPoint;
    rules?: readonly ScenarioRule[];
  } = {},
): TelemetryValue | undefined {
  return scenarioValueAt(
    options.entries ?? [entry()],
    options.code ?? 'CT-01',
    options.point ?? point(),
    options.rules ?? [rule()],
    T0 + seconds * 1000,
  );
}

describe('scenarioValueAt', () => {
  describe('the window', () => {
    // `for_s` 60 + two 5 s intervals + the 10 s margin: 80 s, opening 60 s into every 600 s.
    it('is open for for_s plus two intervals plus the margin, from the offset', () => {
      expect(at(59)).toBeUndefined();
      expect(at(60)).toBe(92);
      expect(at(139)).toBe(92);
      expect(at(140)).toBeUndefined();
    });

    it('repeats every cycle', () => {
      expect(at(660)).toBe(92);
      expect(at(739)).toBe(92);
      expect(at(740)).toBeUndefined();
      expect(at(3_660)).toBe(92);
    });

    it('is anchored to the epoch, so a time before the offset still has a phase', () => {
      const before = (seconds: number) =>
        scenarioValueAt([entry()], 'CT-01', point(), [rule()], seconds * 1000);

      // -540 s is 60 s into the cycle that began at -600 s.
      expect(before(-540)).toBe(92);
      expect(before(-545)).toBeUndefined();
    });

    it('does not depend on what was asked before: two replicas agree', () => {
      const seconds = Array.from({ length: 1_200 }, (_, index) => index * 5);

      const forward = seconds.map((each) => at(each));
      const backward = [...seconds]
        .reverse()
        .map((each) => at(each))
        .reverse();

      expect(backward).toEqual(forward);
    });

    it('is as long as the margin says', () => {
      const short = { entries: [entry({ marginS: 0 })] };

      // 60 + 10 + 0: 70 s.
      expect(at(60 + 69, short)).toBe(92);
      expect(at(60 + 70, short)).toBeUndefined();
      expect(DEFAULT_MARGIN_S).toBe(10);
    });

    it('is not scripted when it would not fit in the cycle', () => {
      expect(at(60, { entries: [entry({ cycleS: 80 })] })).toBeUndefined();
      expect(at(60, { entries: [entry({ cycleS: 0 })] })).toBeUndefined();
    });
  });

  describe('what it scripts', () => {
    it('is nothing for another asset or another key', () => {
      expect(at(100, { code: 'CT-02' })).toBeUndefined();
      expect(
        at(100, {
          point: point({ key: 'vibrationMms' }),
          rules: [rule({ key: 'vibrationMms' })],
        }),
      ).toBeUndefined();
    });

    it('is nothing with no entries', () => {
      expect(at(100, { entries: [] })).toBeUndefined();
    });

    it('is nothing when the asset has no enabled rule on the key', () => {
      expect(at(100, { rules: [] })).toBeUndefined();
      expect(at(100, { rules: [rule({ key: 'vibrationMms' })] })).toBeUndefined();
    });

    it('follows an operator change of the rule, not a number of its own', () => {
      const changed = { rules: [rule({ limit: 90, forS: 120 })] };

      // 120 + 10 + 10: 140 s, and 90 + 7.
      expect(at(60 + 139, changed)).toBe(97);
      expect(at(60 + 140, changed)).toBeUndefined();
    });

    it('is strictly past the limit and inside the range of the point', () => {
      expect(at(100, { point: point({ max: 90 }) })).toBe(90);
      expect(at(100, { point: point({ max: 85 }) })).toBeUndefined();
      expect(at(100, { point: point({ max: null }) })).toBe(92);
    });

    it('goes under the limit of a below rule, and no lower than the range', () => {
      const below = {
        point: point({ key: 'supplyTempC', min: 0, max: 40 }),
        rules: [rule({ key: 'supplyTempC', comparator: 'below', limit: 24 })],
        entries: [entry({ key: 'supplyTempC' })],
      };

      expect(at(100, below)).toBe(17);
      expect(at(100, { ...below, point: { ...below.point, min: 20 } })).toBe(20);
      expect(at(100, { ...below, point: { ...below.point, min: 24 } })).toBeUndefined();
    });

    it('rounds like the waveform: two decimals', () => {
      expect(at(100, { rules: [rule({ limit: 7.1 })] })).toBe(14.1);
    });

    it('is a boolean for a boolean point: true for above, false for below', () => {
      const leak = {
        entries: [entry({ assetCode: 'LKS-B3', key: 'leakDetected', cycleS: 3_600, offsetS: 0 })],
        code: 'LKS-B3',
        point: point({
          key: 'leakDetected',
          kind: 'boolean',
          min: null,
          max: null,
          expectedIntervalS: 300,
        }),
        rules: [rule({ key: 'leakDetected', limit: 0.5, forS: 10 })],
      };

      expect(at(0, leak)).toBe(true);
      expect(
        at(0, { ...leak, rules: [rule({ key: 'leakDetected', comparator: 'below', limit: 0.5 })] }),
      ).toBe(false);
      // `true` is 1, which is not past a limit of 1.
      expect(at(0, { ...leak, rules: [rule({ key: 'leakDetected', limit: 1 })] })).toBeUndefined();
    });

    it('is nothing for an enum', () => {
      expect(at(100, { point: point({ kind: 'enum', min: null, max: null }) })).toBeUndefined();
    });
  });

  describe('the demo scenario over the seed', () => {
    const classes = new Map(ASSET_CLASSES.map((assetClass) => [assetClass.code, assetClass]));

    function seeded(assetCode: string, key: string) {
      const asset = ASSETS.find((each) => each.code === assetCode)!;
      const assetClass = classes.get(asset.class)!;
      return {
        point: assetClass.points.find((each) => each.key === key)!,
        rules: assetClass.rules,
      };
    }

    /** The boundaries of the point over `ms` from `T0` at which the scenario has a value. */
    function scripted(assetCode: string, key: string, ms: number): TelemetryValue[] {
      const { point: seededPoint, rules } = seeded(assetCode, key);
      const step = seededPoint.expectedIntervalS * 1000;
      const values: TelemetryValue[] = [];
      for (let time = T0; time < T0 + ms; time += step) {
        const value = scenarioValueAt(DEMO_SCENARIO, assetCode, seededPoint, rules, time);
        if (value !== undefined) values.push(value);
      }
      return values;
    }

    it('holds CT-01 at 92 °C for 80 s of every 10 minutes', () => {
      // An hour: six cycles of sixteen 5 s boundaries.
      const values = scripted('CT-01', 'motorTempC', 3_600_000);

      expect(values).toHaveLength(6 * 16);
      expect(new Set(values)).toEqual(new Set([92]));
    });

    it('holds LKS-B3 true for 620 s once an hour', () => {
      // 1200 s to 1820 s: three 300 s boundaries.
      const values = scripted('LKS-B3', 'leakDetected', 3_600_000);

      expect(values).toEqual([true, true, true]);
    });

    it('is nothing for every other asset', () => {
      const others = ASSETS.filter((asset) => !['CT-01', 'LKS-B3'].includes(asset.code));

      const counts = others.map((asset) => {
        const assetClass = classes.get(asset.class)!;
        return assetClass.points.flatMap((each) => scripted(asset.code, each.key, 3_600_000))
          .length;
      });

      expect(counts.every((count) => count === 0)).toBe(true);
    });

    it('says what is scripted, for the log', () => {
      expect(scenarioSummary(DEMO_SCENARIO)).toBe(
        'CT-01/motorTempC every 600 s, LKS-B3/leakDetected every 3600 s',
      );
    });
  });
});

/**
 * The reason the scenario exists as an override and not as a drift (V2-06.3, V2-07.5): run the
 * values the source would emit over the real seed through the rule state machine for a simulated
 * day. With the scenario off nothing raises, which is what keeps a demo or a dev machine quiet.
 * With it on, exactly the two scripted rules raise and the other twenty do not.
 *
 * It steps at each point's own boundary, as the source does, and uses the boundary as the time the
 * rule engine sees, which is the best case for a raise: a rule that cannot raise here cannot raise
 * in the running source either.
 */
describe('the seed catalogue under the rule state machine', () => {
  const classes = new Map(ASSET_CLASSES.map((assetClass) => [assetClass.code, assetClass]));

  /** `asset:rule name` of every raise over a day, for the assets of the seed. */
  function raisedOverADay(scenario: readonly DemoScenarioEntry[]): string[] {
    const raised: string[] = [];

    for (const asset of ASSETS) {
      const assetClass = classes.get(asset.class)!;
      for (const seeded of assetClass.rules) {
        const watched = assetClass.points.find((each) => each.key === seeded.key)!;
        const spec = {
          key: seeded.key,
          comparator: seeded.comparator,
          limit: seeded.limit,
          clear: seeded.clear,
          forS: seeded.forS,
          expectedIntervalS: watched.expectedIntervalS,
        };
        const step = watched.expectedIntervalS * 1000;
        let state: RuleState = ARMED;

        for (let time = T0; time < T0 + DAY_MS; time += step) {
          const value =
            scenarioValueAt(scenario, asset.code, watched, assetClass.rules, time) ??
            valueAt(asset.code, watched, assetClass.rules, time);
          const result = evaluateRule(state, { at: time, value }, spec);
          if (result.action.kind === 'raise') raised.push(`${asset.code}:${seeded.name}`);
          state = result.state;
        }
      }
    }
    return raised;
  }

  it('covers the 22 seeded rules', () => {
    const rules = ASSET_CLASSES.reduce((sum, assetClass) => sum + assetClass.rules.length, 0);

    expect(rules).toBe(22);
  });

  it('raises nothing in a day with the scenario off', () => {
    expect(raisedOverADay([])).toEqual([]);
  });

  it('raises exactly the two scripted rules in a day with the demo scenario on', () => {
    const raised = raisedOverADay(DEMO_SCENARIO);

    // Each is held until it clears, so one raise per cycle: 144 for the tower, 24 for the sensor.
    expect(new Set(raised)).toEqual(new Set(['CT-01:Motor over-temperature', 'LKS-B3:Water leak']));
    expect(raised.filter((each) => each.startsWith('CT-01:'))).toHaveLength(144);
    expect(raised.filter((each) => each.startsWith('LKS-B3:'))).toHaveLength(24);
  });
});
