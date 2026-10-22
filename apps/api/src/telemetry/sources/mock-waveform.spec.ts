import type { TelemetryValue } from '@occ/contracts';
import { ASSET_CLASSES } from '../../database/seed/asset-catalogue';
import { safeBand, valueAt, type WaveformPoint, type WaveformRule } from './mock-waveform';

/** A multiple of every interval and window the waveform uses, so cases start on a boundary. */
const T0 = Date.parse('2026-10-13T08:00:00.000Z');
const HOUR = 3_600_000;
const WINDOW_MS = 600_000;

const numberPoint = (over: Partial<WaveformPoint> = {}): WaveformPoint => ({
  key: 'tempC',
  kind: 'number',
  min: 0,
  max: 100,
  enumValues: null,
  expectedIntervalS: 5,
  ...over,
});

const booleanPoint = (over: Partial<WaveformPoint> = {}) =>
  numberPoint({ key: 'running', kind: 'boolean', min: null, max: null, ...over });

const enumPoint = (enumValues: string[] | null, over: Partial<WaveformPoint> = {}) =>
  numberPoint({ key: 'switchState', kind: 'enum', min: null, max: null, enumValues, ...over });

const rule = (over: Partial<WaveformRule> = {}): WaveformRule => ({
  key: 'tempC',
  comparator: 'above',
  limit: 85,
  clear: 80,
  ...over,
});

/** `steps` values of a point, `stepMs` apart from `T0`: a day at the defaults. */
const series = (
  assetCode: string,
  point: WaveformPoint,
  rules: readonly WaveformRule[] = [],
  steps = 2_880,
  stepMs = 30_000,
): TelemetryValue[] =>
  Array.from(
    { length: steps },
    (_, step) => valueAt(assetCode, point, rules, T0 + step * stepMs) as TelemetryValue,
  );

const numbersOf = (values: TelemetryValue[]) => values as number[];

describe('safeBand', () => {
  it('is the point range when no rule narrows it', () => {
    expect(safeBand(numberPoint({ min: -20, max: 150 }), [])).toEqual({ lo: -20, hi: 150 });
  });

  it('lowers the top to the clear level of an above rule', () => {
    expect(safeBand(numberPoint({ min: -20, max: 150 }), [rule({ clear: 80 })])).toEqual({
      lo: -20,
      hi: 80,
    });
  });

  it('raises the bottom to the clear level of a below rule', () => {
    const below = rule({ comparator: 'below', limit: 24, clear: 25 });

    expect(safeBand(numberPoint({ min: 0, max: 32 }), [below])).toEqual({ lo: 25, hi: 32 });
  });

  it('ignores the rules of another key', () => {
    const other = rule({ key: 'vibrationMms', clear: 5 });

    expect(safeBand(numberPoint({ min: 0, max: 100 }), [other])).toEqual({ lo: 0, hi: 100 });
  });

  it('has no top for a point with no maximum, unless an above rule gives it one', () => {
    const unbounded = numberPoint({ min: 0, max: null });

    expect(safeBand(unbounded, [])).toEqual({ lo: 0, hi: Infinity });
    expect(safeBand(unbounded, [rule({ clear: 50 })])).toEqual({ lo: 0, hi: 50 });
  });
});

describe('valueAt: numbers', () => {
  it('is a pure function of asset, key and time', () => {
    expect(series('CT-01', numberPoint())).toEqual(series('CT-01', numberPoint()));
  });

  it('gives two assets of one class their own waveform', () => {
    expect(series('CT-01', numberPoint())).not.toEqual(series('CT-02', numberPoint()));
  });

  it('moves with time and stays in 20-80 % of the range when no rule narrows it', () => {
    const values = numbersOf(series('CT-01', numberPoint({ min: 0, max: 100 })));

    expect(Math.min(...values)).toBeGreaterThanOrEqual(20);
    expect(Math.max(...values)).toBeLessThanOrEqual(80);
    expect(new Set(values).size).toBeGreaterThan(100);
  });

  it('never rises above the clear level of an above rule', () => {
    const values = numbersOf(
      series('CT-01', numberPoint({ min: -20, max: 150 }), [rule({ clear: 80 })]),
    );

    expect(Math.max(...values)).toBeLessThanOrEqual(80);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(-20);
  });

  it('never falls below the clear level of a below rule', () => {
    const below = rule({ comparator: 'below', limit: 24, clear: 25 });
    const values = numbersOf(series('GEN-01', numberPoint({ min: 0, max: 32 }), [below]));

    expect(Math.min(...values)).toBeGreaterThanOrEqual(25);
    expect(Math.max(...values)).toBeLessThanOrEqual(32);
  });

  it('stays between the two when a point has a rule on each side', () => {
    const rules = [rule({ clear: 80 }), rule({ comparator: 'below', limit: 15, clear: 20 })];
    const values = numbersOf(series('CT-01', numberPoint({ min: 0, max: 100 }), rules));

    expect(Math.min(...values)).toBeGreaterThanOrEqual(20);
    expect(Math.max(...values)).toBeLessThanOrEqual(80);
  });

  it('settles on the middle when the rules leave no safe band', () => {
    const rules = [rule({ clear: 30 }), rule({ comparator: 'below', limit: 55, clear: 60 })];

    expect(new Set(series('CT-01', numberPoint({ min: 0, max: 100 }), rules))).toEqual(
      new Set([45]),
    );
  });

  describe('a point with no maximum', () => {
    const hours = numberPoint({ key: 'runHoursH', min: 0, max: null });
    const at = (assetCode: string, ms: number) => valueAt(assetCode, hours, [], ms) as number;

    it('is a counter that gains one per hour and never goes back', () => {
      expect(at('CT-01', T0 + HOUR) - at('CT-01', T0)).toBeCloseTo(1, 1);

      let previous = at('CT-01', T0);
      for (let day = 1; day <= 100; day++) {
        const value = at('CT-01', T0 + day * 24 * HOUR);
        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    });

    it('starts from a base of its own per asset, and above its minimum', () => {
      expect(at('CT-01', T0)).toBeGreaterThanOrEqual(1_000);
      expect(at('CT-01', T0)).not.toBe(at('CT-02', T0));
    });

    it('does not run below its minimum for a time before the counter epoch', () => {
      expect(at('CT-01', 0)).toBeGreaterThanOrEqual(1_000);
    });

    it('is a band, not a counter, once an above rule bounds it', () => {
      const values = numbersOf(series('CT-01', hours, [rule({ key: 'runHoursH', clear: 50 })]));

      expect(Math.max(...values)).toBeLessThanOrEqual(50);
      expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('valueAt: booleans', () => {
  const windowValues = (rules: WaveformRule[], windows = 2_000) =>
    Array.from(
      { length: windows },
      (_, index) => valueAt('LFT-A2', booleanPoint(), rules, T0 + index * WINDOW_MS) as boolean,
    );

  it('reads true, with the odd false, when no rule cares', () => {
    const values = windowValues([]);
    const falses = values.filter((value) => value === false).length;

    expect(falses).toBeGreaterThan(0);
    expect(falses).toBeLessThan(values.length * 0.15);
  });

  it('keeps one value for the whole of a window', () => {
    for (let index = 0; index < 20; index++) {
      const start = T0 + index * WINDOW_MS;
      const first = valueAt('LFT-A2', booleanPoint(), [], start);

      for (const offset of [5_000, 295_000, 595_000]) {
        expect(valueAt('LFT-A2', booleanPoint(), [], start + offset)).toBe(first);
      }
    }
  });

  it('reads false when true would breach an above rule', () => {
    const leak = rule({ key: 'running', comparator: 'above', limit: 0.5, clear: 0.5 });

    expect(new Set(windowValues([leak], 500))).toEqual(new Set([false]));
  });

  it('reads true when false would breach a below rule', () => {
    const inService = rule({ key: 'running', comparator: 'below', limit: 0.5, clear: 0.5 });

    expect(new Set(windowValues([inService], 500))).toEqual(new Set([true]));
  });

  it('reads true when the rules leave no safe value', () => {
    const rules = [
      rule({ key: 'running', comparator: 'above', limit: 0.5, clear: 0.5 }),
      rule({ key: 'running', comparator: 'below', limit: 0.5, clear: 0.5 }),
    ];

    expect(new Set(windowValues(rules, 100))).toEqual(new Set([true]));
  });
});

describe('valueAt: enums', () => {
  const values = ['off', 'auto', 'hand'];
  /** Twenty intervals of a 30 s point. */
  const HOLD_MS = 30_000 * 20;
  const point = enumPoint(values, { expectedIntervalS: 30 });

  it('only ever reads one of its values, and all of them in time', () => {
    const seen = new Set<TelemetryValue>();
    for (let hold = 0; hold < 100; hold++) {
      seen.add(valueAt('CT-01', point, [], T0 + hold * HOLD_MS) as TelemetryValue);
    }

    expect(seen).toEqual(new Set(values));
  });

  it('keeps a value for twenty of its intervals', () => {
    for (let hold = 0; hold < 20; hold++) {
      const start = T0 + hold * HOLD_MS;
      const first = valueAt('CT-01', point, [], start);

      for (let step = 1; step < 20; step++) {
        expect(valueAt('CT-01', point, [], start + step * 30_000)).toBe(first);
      }
    }
  });

  it.each([[null], [[]]])('has no value for an enum with %j as its values', (enumValues) => {
    expect(valueAt('CT-01', enumPoint(enumValues), [], T0)).toBeUndefined();
  });
});

/**
 * The reason the generator exists as "normal operation": with the real seed, nothing it produces is
 * on the breach side of a rule, so the telemetry rules never fire without a scripted event.
 */
describe('the seed catalogue stays healthy', () => {
  const SAMPLES = 2_000;
  /** Prime, so the sampled instants land on every offset of every interval. */
  const STRIDE_MS = 301_000;

  function problemWith(
    point: WaveformPoint,
    rules: readonly WaveformRule[],
    value: TelemetryValue | undefined,
  ): string | undefined {
    if (value === undefined) return 'no value';
    if (point.kind === 'enum') {
      return point.enumValues?.includes(value as string) ? undefined : `${value} is not a value`;
    }
    if (point.kind === 'boolean' && typeof value !== 'boolean') return `${value} is not a boolean`;
    if (point.kind === 'number' && typeof value !== 'number') return `${value} is not a number`;

    // A boolean compares as 1 and 0 (ADR-0018).
    const asNumber = typeof value === 'boolean' ? Number(value) : (value as number);
    if (point.min !== null && asNumber < point.min) return `${value} is under its minimum`;
    if (point.max !== null && asNumber > point.max) return `${value} is over its maximum`;
    for (const each of rules) {
      const breached = each.comparator === 'above' ? asNumber > each.clear : asNumber < each.clear;
      if (breached) return `${value} is past clear ${each.clear} of an ${each.comparator} rule`;
    }
    return undefined;
  }

  it('has classes to check', () => {
    expect(ASSET_CLASSES.length).toBeGreaterThan(0);
  });

  it.each(ASSET_CLASSES.map((assetClass) => [assetClass.code, assetClass] as const))(
    '%s: every point stays in its range and on the safe side of its rules',
    (_code, assetClass) => {
      const violations: string[] = [];

      for (const assetCode of ['CT-01', 'ICS-DC']) {
        for (const point of assetClass.points) {
          const ofKey = assetClass.rules.filter((each) => each.key === point.key);
          for (let sample = 0; sample < SAMPLES; sample++) {
            const value = valueAt(assetCode, point, assetClass.rules, T0 + sample * STRIDE_MS);
            const problem = problemWith(point, ofKey, value);
            if (problem) violations.push(`${assetCode} ${point.key} #${sample}: ${problem}`);
          }
        }
      }

      expect(violations).toEqual([]);
    },
  );
});
