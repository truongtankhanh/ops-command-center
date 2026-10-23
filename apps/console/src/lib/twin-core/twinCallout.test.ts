import type { TelemetryPoint, TelemetryRule } from '@occ/contracts';
import { type CalloutInput, calloutOf } from './twinCallout';

const point = (overrides: Partial<TelemetryPoint> = {}): TelemetryPoint => ({
  key: 'fanSpeedRpm',
  label: 'Fan speed',
  unit: 'rpm',
  kind: 'number',
  min: 0,
  max: 1800,
  enumValues: null,
  expectedIntervalS: 1,
  headline: 1,
  ...overrides,
});

const rule = (
  overrides: Partial<TelemetryRule> = {},
): Pick<TelemetryRule, 'comparator' | 'limit'> => ({
  comparator: 'above',
  limit: 85,
  ...overrides,
});

/** The cooling tower's fan blade, live: 1,420 rpm. */
const blade = (overrides: Partial<CalloutInput> = {}): CalloutInput => ({
  assetCode: 'CT-01',
  node: 'FanBlade',
  row: { label: 'Fan blade', bind: 'fanSpeedRpm' },
  point: point(),
  rule: null,
  value: 1420,
  stale: false,
  ageMs: 800,
  ...overrides,
});

describe('calloutOf', () => {
  it('is the asset and the node over the part`s label, with its live reading large', () => {
    expect(calloutOf(blade())).toEqual({
      eyebrow: 'CT-01 · FanBlade',
      label: 'Fan blade',
      reading: { text: '1,420', unit: 'rpm', last: false },
      subline: 'Live',
      limit: null,
    });
  });

  describe('a stale reading', () => {
    it('is the remembered value marked "last", with its age and never "Live"', () => {
      const callout = calloutOf(blade({ stale: true, ageMs: 72_000 }));

      expect(callout.reading).toEqual({ text: '1,420', unit: 'rpm', last: true });
      expect(callout.subline).toBe('1 min old');
    });

    it('counts the age in two units at most, so it does not change every second', () => {
      expect(calloutOf(blade({ stale: true, ageMs: 3_700_000 })).subline).toBe('1 h old');
      expect(calloutOf(blade({ stale: true, ageMs: 12_000 })).subline).toBe('12 s old');
    });

    it('has no subline when the age is not known yet', () => {
      expect(calloutOf(blade({ stale: true, ageMs: null })).subline).toBeNull();
    });
  });

  describe('words', () => {
    const breaker = point({
      key: 'breakerClosed',
      label: 'Main breaker',
      unit: null,
      kind: 'boolean',
    });

    it('reads a boolean point in words, with no unit: "Closed", "Open"', () => {
      const closed = calloutOf(
        blade({
          node: 'Breaker',
          row: { label: 'Breaker', bind: 'breakerClosed' },
          point: breaker,
          value: true,
        }),
      );
      const open = calloutOf(
        blade({
          node: 'Breaker',
          row: { label: 'Breaker', bind: 'breakerClosed' },
          point: breaker,
          value: false,
        }),
      );

      expect(closed.reading).toEqual({ text: 'Closed', unit: null, last: false });
      expect(open.reading).toEqual({ text: 'Open', unit: null, last: false });
    });

    it('reads an enum point in sentence case', () => {
      const mode = point({ key: 'mode', unit: null, kind: 'enum', enumValues: ['auto', 'manual'] });

      expect(calloutOf(blade({ point: mode, value: 'auto' })).reading).toEqual({
        text: 'Auto',
        unit: null,
        last: false,
      });
    });

    it('draws a point of a kind from a newer API as it came', () => {
      const newer = point({ kind: 'duration' as unknown as TelemetryPoint['kind'], unit: 's' });

      expect(calloutOf(blade({ point: newer, value: 12 })).reading).toEqual({
        text: '12',
        unit: null,
        last: false,
      });
    });
  });

  describe('the rule that watches the point', () => {
    it('adds "Limit 85 °C" for a rule above', () => {
      const temp = point({ key: 'motorTempC', unit: '°C' });

      expect(calloutOf(blade({ point: temp, value: 71, rule: rule() })).limit).toBe('Limit 85 °C');
    });

    it('adds "Low at 20 %" for a rule below', () => {
      const fuel = point({ key: 'fuelLevelPct', unit: '%' });

      expect(
        calloutOf(blade({ point: fuel, value: 86, rule: rule({ comparator: 'below', limit: 20 }) }))
          .limit,
      ).toBe('Low at 20 %');
    });

    it('adds nothing for a boolean point, whose limit is an encoding', () => {
      const breaker = point({ key: 'breakerClosed', unit: null, kind: 'boolean' });

      expect(
        calloutOf(blade({ point: breaker, value: true, rule: rule({ limit: 0.5 }) })).limit,
      ).toBeNull();
    });

    it('adds nothing when no rule watches it', () => {
      expect(calloutOf(blade({ rule: null })).limit).toBeNull();
    });

    it('still says the limit of a stale reading: the rule is the point`s, not the reading`s', () => {
      const temp = point({ key: 'motorTempC', unit: '°C' });

      expect(calloutOf(blade({ point: temp, value: 71, rule: rule(), stale: true })).limit).toBe(
        'Limit 85 °C',
      );
    });
  });

  describe('what is not known', () => {
    it('reads "—" for a bound part the console holds no reading for, with no subline', () => {
      const callout = calloutOf(blade({ value: undefined, rule: rule() }));

      expect(callout.reading).toEqual({ text: '—', unit: null, last: false });
      expect(callout.subline).toBeNull();
    });

    it('reads "—" when the part has a reading and is stale but nothing ever arrived', () => {
      expect(calloutOf(blade({ value: undefined, stale: true })).reading.text).toBe('—');
    });

    it('reads "static" for a node of the model that binds nothing, with nothing else', () => {
      const callout = calloutOf(
        blade({
          node: 'Housing',
          row: { label: 'Housing', bind: null },
          point: undefined,
          value: undefined,
          rule: rule(),
        }),
      );

      expect(callout).toEqual({
        eyebrow: 'CT-01 · Housing',
        label: 'Housing',
        reading: { text: 'static', unit: null, last: false },
        subline: null,
        limit: null,
      });
    });

    it('falls back to the node`s name in sentence case while the model`s tree is on its way', () => {
      const callout = calloutOf(blade({ row: undefined, point: undefined, value: undefined }));

      expect(callout.label).toBe('Fan blade');
      expect(callout.eyebrow).toBe('CT-01 · FanBlade');
      expect(callout.reading.text).toBe('—');
    });

    it('reads "—" while the asset`s detail is on its way, whatever the entry holds', () => {
      expect(calloutOf(blade({ point: undefined, rule: null })).reading.text).toBe('—');
    });
  });
});
