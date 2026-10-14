import { formatRuleEvidence } from './rule-evidence';

describe('formatRuleEvidence', () => {
  it('renders the evidence of an above rule as the timeline note reads it', () => {
    expect(
      formatRuleEvidence({
        key: 'motorTempC',
        value: 92,
        comparator: 'above',
        limit: 85,
        forS: 60,
      }),
    ).toBe('motorTempC 92 > 85 for 60 s');
  });

  it('renders a below rule with <', () => {
    expect(
      formatRuleEvidence({
        key: 'fuelLevelPct',
        value: 22,
        comparator: 'below',
        limit: 25,
        forS: 300,
      }),
    ).toBe('fuelLevelPct 22 < 25 for 300 s');
  });

  it('renders a boolean as the 1 or 0 the machine compared, against the 0.5 limit', () => {
    expect(
      formatRuleEvidence({
        key: 'leakDetected',
        value: 1,
        comparator: 'above',
        limit: 0.5,
        forS: 10,
      }),
    ).toBe('leakDetected 1 > 0.5 for 10 s');
    expect(
      formatRuleEvidence({
        key: 'inService',
        value: 0,
        comparator: 'below',
        limit: 0.5,
        forS: 300,
      }),
    ).toBe('inService 0 < 0.5 for 300 s');
  });

  it('keeps decimals and drops a trailing .0', () => {
    expect(
      formatRuleEvidence({
        key: 'vibrationMms',
        value: 7.4,
        comparator: 'above',
        limit: 7.1,
        forS: 120,
      }),
    ).toBe('vibrationMms 7.4 > 7.1 for 120 s');
    expect(
      formatRuleEvidence({
        key: 'starterBatteryV',
        value: 23.5,
        comparator: 'below',
        limit: 24.0,
        forS: 300,
      }),
    ).toBe('starterBatteryV 23.5 < 24 for 300 s');
  });

  it('renders a rule with no dwell', () => {
    expect(
      formatRuleEvidence({
        key: 'busVoltageKv',
        value: 19,
        comparator: 'below',
        limit: 19.8,
        forS: 0,
      }),
    ).toBe('busVoltageKv 19 < 19.8 for 0 s');
  });
});
