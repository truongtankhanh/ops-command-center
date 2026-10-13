import type { TelemetryPoint } from '@occ/contracts';
import type { CatalogueAsset } from '../assets/assets.service';
import type { RawReading } from './telemetry-source';
import {
  indexCatalogue,
  MAX_CLOCK_SKEW_MS,
  validateReading,
  type CatalogueIndex,
  type ValidatedReading,
} from './validate-reading';

const NOW = Date.parse('2026-10-13T08:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

const point = (key: string, over: Partial<TelemetryPoint> = {}): TelemetryPoint => ({
  key,
  label: key,
  unit: null,
  kind: 'number',
  min: 0,
  max: 100,
  enumValues: null,
  expectedIntervalS: 5,
  headline: null,
  ...over,
});

const asset = (code: string, points: TelemetryPoint[]): CatalogueAsset => ({
  id: `id-${code}`,
  code,
  points,
  rules: [],
});

const index: CatalogueIndex = indexCatalogue([
  asset('CT-01', [
    point('temp', { min: -10, max: 100 }),
    point('count', { min: null, max: null }),
    point('running', { kind: 'boolean', min: null, max: null }),
    point('mode', { kind: 'enum', min: null, max: null, enumValues: ['run', 'idle'] }),
  ]),
]);

/** `invalid` with nothing applied. `toMatchObject` would let an unexpected value through. */
function expectNothingApplied(checked: ValidatedReading): void {
  expect(checked.result).toBe('invalid');
  expect(checked.values).toEqual({});
}

const reading = (values: unknown, over: Partial<RawReading> = {}): RawReading => ({
  assetCode: 'CT-01',
  values: values as RawReading['values'],
  ...over,
});

describe('indexCatalogue', () => {
  it('lists the headline keys by rank, whatever the order of the points', () => {
    const indexed = indexCatalogue([
      asset('CT-01', [point('b', { headline: 2 }), point('x'), point('a', { headline: 1 })]),
    ]);

    expect(indexed.get('CT-01')?.headlineKeys).toEqual(['a', 'b']);
  });

  it('has no headline keys for a class with none', () => {
    const indexed = indexCatalogue([asset('CT-01', [point('x')])]);

    expect(indexed.get('CT-01')?.headlineKeys).toEqual([]);
  });

  it('finds a point by key and an unknown asset by nothing', () => {
    expect(index.get('CT-01')?.points.get('temp')?.max).toBe(100);
    expect(index.get('CT-01')?.points.get('nope')).toBeUndefined();
    expect(index.get('XX-99')).toBeUndefined();
  });
});

describe('validateReading', () => {
  describe('the asset', () => {
    it('is `unknown_asset` when the code is not in the catalogue', () => {
      const checked = validateReading(index, reading({ temp: 1 }, { assetCode: 'XX-99' }), NOW);

      expect(checked).toEqual({
        result: 'unknown_asset',
        at: iso(NOW),
        values: {},
        unknownKeys: [],
      });
    });

    it('is `unknown_asset` when the code is not even a string', () => {
      const raw = { assetCode: 42, values: { temp: 1 } } as unknown as RawReading;

      expect(validateReading(index, raw, NOW).result).toBe('unknown_asset');
    });

    it('is `unknown_asset` before anything else, a skewed `at` included', () => {
      const raw = reading({ nope: 1 }, { assetCode: 'XX-99', at: iso(NOW - 3_600_000) });

      expect(validateReading(index, raw, NOW).result).toBe('unknown_asset');
    });
  });

  describe('a value', () => {
    it('is accepted when its kind and range fit', () => {
      const checked = validateReading(
        index,
        reading({ temp: 21.5, running: true, mode: 'idle' }),
        NOW,
      );

      expect(checked.result).toBe('accepted');
      expect(checked.values).toEqual({ temp: 21.5, running: true, mode: 'idle' });
      expect(checked.unknownKeys).toEqual([]);
    });

    it('accepts the bounds themselves: `min` and `max` are inclusive', () => {
      const checked = validateReading(index, reading({ temp: -10 }), NOW);
      const upper = validateReading(index, reading({ temp: 100 }), NOW);

      expect(checked.values).toEqual({ temp: -10 });
      expect(upper.values).toEqual({ temp: 100 });
    });

    it('is dropped, never clamped, below `min` and above `max`', () => {
      const below = validateReading(index, reading({ temp: -10.01 }), NOW);
      const above = validateReading(index, reading({ temp: 100.01 }), NOW);

      expectNothingApplied(below);
      expectNothingApplied(above);
    });

    it('has no bound on a side where the point has none', () => {
      const checked = validateReading(index, reading({ count: -1_000_000 }), NOW);

      expect(checked).toMatchObject({ result: 'accepted', values: { count: -1_000_000 } });
    });

    it.each([
      ['a numeric string', '21'],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['a boolean', true],
      ['null', null],
    ])('drops %s for a `number` point', (_label, value) => {
      expectNothingApplied(validateReading(index, reading({ temp: value }), NOW));
    });

    it.each([
      ['a string', 'true'],
      ['a number', 1],
      ['null', null],
    ])('drops %s for a `boolean` point', (_label, value) => {
      expectNothingApplied(validateReading(index, reading({ running: value }), NOW));
    });

    it.each([
      ['a string that is not one of its values', 'standby'],
      ['a number', 0],
      ['a boolean', true],
    ])('drops %s for an `enum` point', (_label, value) => {
      expectNothingApplied(validateReading(index, reading({ mode: value }), NOW));
    });

    it('is `invalid` for an unknown key, which is reported by name', () => {
      const checked = validateReading(index, reading({ voltage: 5 }), NOW);

      expectNothingApplied(checked);
      expect(checked.unknownKeys).toEqual(['voltage']);
    });
  });

  describe('a reading with some values bad', () => {
    it('is `invalid` once, and the values that passed are still returned', () => {
      const checked = validateReading(
        index,
        reading({ temp: 20, running: 'yes', voltage: 5, mode: 'run' }),
        NOW,
      );

      expect(checked.result).toBe('invalid');
      expect(checked.values).toEqual({ temp: 20, mode: 'run' });
      expect(checked.unknownKeys).toEqual(['voltage']);
    });
  });

  describe('keys that are not points', () => {
    it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
      'drops `%s` as an unknown key and leaves the result a plain object',
      (key) => {
        const raw = reading(JSON.parse(`{ "${key}": 1, "temp": 2 }`));

        const checked = validateReading(index, raw, NOW);

        expect(checked.result).toBe('invalid');
        expect(checked.unknownKeys).toEqual([key]);
        expect(checked.values).toEqual({ temp: 2 });
        expect(Object.getPrototypeOf(checked.values)).toBe(Object.prototype);
      },
    );
  });

  describe('the values object', () => {
    it.each([
      ['null', null],
      ['an array', [1, 2]],
      ['a string', 'temp=1'],
      ['a number', 5],
      ['an empty object', {}],
      ['absent', undefined],
    ])('is `invalid` and applies nothing when it is %s', (_label, values) => {
      const checked = validateReading(index, reading(values), NOW);

      expectNothingApplied(checked);
      expect(checked.unknownKeys).toEqual([]);
    });
  });

  describe('`at`', () => {
    it('is the receive time, and no fault, when the source did not say', () => {
      const checked = validateReading(index, reading({ temp: 1 }), NOW);

      expect(checked).toMatchObject({ result: 'accepted', at: iso(NOW) });
    });

    it('is kept, normalised to UTC, when it is within the window', () => {
      const checked = validateReading(
        index,
        reading({ temp: 1 }, { at: '2026-10-13T15:00:30+07:00' }),
        NOW,
      );

      expect(checked).toMatchObject({ result: 'accepted', at: '2026-10-13T08:00:30.000Z' });
    });

    it('is kept at exactly the limit, and replaced just past it', () => {
      const atLimit = validateReading(
        index,
        reading({ temp: 1 }, { at: iso(NOW - MAX_CLOCK_SKEW_MS) }),
        NOW,
      );
      const past = validateReading(
        index,
        reading({ temp: 1 }, { at: iso(NOW - MAX_CLOCK_SKEW_MS - 1) }),
        NOW,
      );

      expect(atLimit).toMatchObject({ result: 'accepted', at: iso(NOW - MAX_CLOCK_SKEW_MS) });
      expect(past).toMatchObject({ result: 'clock_skew', at: iso(NOW) });
    });

    it('is replaced when it is in the future, as when it is in the past', () => {
      const checked = validateReading(
        index,
        reading({ temp: 1 }, { at: iso(NOW + 6 * 60_000) }),
        NOW,
      );

      expect(checked).toMatchObject({ result: 'clock_skew', at: iso(NOW) });
    });

    it.each([
      ['not a date', 'yesterday'],
      ['a bare number string, which Date.parse would read', '1'],
      ['a date with no time', '2026-10-13'],
      ['a date-time that is not a real date', '2026-13-45T00:00:00Z'],
      ['not a string', 1_760_342_400_000],
    ])('is replaced and counted a skew when it is %s', (_label, at) => {
      const raw = reading({ temp: 1 }, { at: at as unknown as string });

      const checked = validateReading(index, raw, NOW);

      expect(checked).toMatchObject({ result: 'clock_skew', at: iso(NOW), values: { temp: 1 } });
    });
  });

  describe('precedence', () => {
    it('puts `invalid` before `clock_skew`, and still applies the good values', () => {
      const raw = reading({ temp: 1, running: 'yes' }, { at: iso(NOW - 3_600_000) });

      const checked = validateReading(index, raw, NOW);

      expect(checked.result).toBe('invalid');
      expect(checked.values).toEqual({ temp: 1 });
      expect(checked.at).toBe(iso(NOW));
    });

    it('is `clock_skew` when every value is good and only `at` is off', () => {
      const raw = reading({ temp: 1, running: true }, { at: iso(NOW + 3_600_000) });

      const checked = validateReading(index, raw, NOW);

      expect(checked.result).toBe('clock_skew');
      expect(checked.values).toEqual({ temp: 1, running: true });
    });
  });
});
