import type { TelemetryComparator, TelemetryPoint, TelemetryRule } from '@occ/contracts';
import {
  describeEvidence,
  evidenceOfTimeline,
  matchRule,
  parseEvidence,
  type RuleEvidence,
  summariseEvidence,
} from './telemetryEvidence';

/*
 * The grammar is a coupling to the API (`formatRuleEvidence`, ADR-0018 § Evaluation). The samples
 * below are the ones `apps/api/src/telemetry/rules/rule-evidence.spec.ts` pins for the producer: if
 * the producer's format changes, one of the two specs goes red, which is the point.
 */
const PRODUCER_SAMPLES: [string, RuleEvidence][] = [
  [
    'motorTempC 92 > 85 for 60 s',
    { key: 'motorTempC', value: 92, comparator: 'above', limit: 85, forS: 60 },
  ],
  [
    'fuelLevelPct 22 < 25 for 300 s',
    { key: 'fuelLevelPct', value: 22, comparator: 'below', limit: 25, forS: 300 },
  ],
  [
    'leakDetected 1 > 0.5 for 10 s',
    { key: 'leakDetected', value: 1, comparator: 'above', limit: 0.5, forS: 10 },
  ],
  [
    'inService 0 < 0.5 for 300 s',
    { key: 'inService', value: 0, comparator: 'below', limit: 0.5, forS: 300 },
  ],
  [
    'vibrationMms 7.4 > 7.1 for 120 s',
    { key: 'vibrationMms', value: 7.4, comparator: 'above', limit: 7.1, forS: 120 },
  ],
  [
    'starterBatteryV 23.5 < 24 for 300 s',
    { key: 'starterBatteryV', value: 23.5, comparator: 'below', limit: 24, forS: 300 },
  ],
  [
    'busVoltageKv 19 < 19.8 for 0 s',
    { key: 'busVoltageKv', value: 19, comparator: 'below', limit: 19.8, forS: 0 },
  ],
];

const rule = (overrides: Partial<TelemetryRule> & Pick<TelemetryRule, 'name' | 'key'>) =>
  ({
    comparator: 'above',
    limit: 85,
    clear: 80,
    forS: 60,
    severity: 'critical',
    incidentType: 'equipment_fault',
    ...overrides,
  }) satisfies TelemetryRule;

/** `CT-01`'s class rules as the seed has them (`asset-catalogue.ts`). */
const CT_RULES: TelemetryRule[] = [
  rule({ name: 'Motor over-temperature', key: 'motorTempC' }),
  rule({
    name: 'High vibration',
    key: 'vibrationMms',
    limit: 7.1,
    clear: 5,
    forS: 120,
    severity: 'high',
  }),
  rule({
    name: 'Motor overcurrent',
    key: 'motorCurrentA',
    limit: 24,
    clear: 22,
    severity: 'high',
  }),
];

/** `LKS-B3`'s rules: a boolean (0.5 is its encoding) and a battery. */
const LEAK_RULES: TelemetryRule[] = [
  rule({
    name: 'Water leak',
    key: 'leakDetected',
    limit: 0.5,
    clear: 0.5,
    forS: 10,
    severity: 'medium',
    incidentType: 'water_leak',
  }),
  rule({
    name: 'Leak sensor battery low',
    key: 'batteryPct',
    comparator: 'below',
    limit: 20,
    clear: 25,
    forS: 3600,
    severity: 'low',
  }),
];

type PointShape = Pick<TelemetryPoint, 'key' | 'label' | 'kind' | 'unit'>;
const MOTOR_TEMP: PointShape = {
  key: 'motorTempC',
  label: 'Motor temperature',
  kind: 'number',
  unit: '°C',
};
const LEAK: PointShape = { key: 'leakDetected', label: 'Leak', kind: 'boolean', unit: null };
const BATTERY: PointShape = { key: 'batteryPct', label: 'Battery', kind: 'number', unit: '%' };
const BUS: PointShape = { key: 'busVoltageKv', label: 'Bus voltage', kind: 'number', unit: 'kV' };

describe('parseEvidence', () => {
  it.each(PRODUCER_SAMPLES)('reads the producer’s note %j', (note, expected) => {
    expect(parseEvidence(note)).toEqual(expected);
  });

  it('reads a negative reading, a decimal one and an exponent as the producer writes them', () => {
    expect(parseEvidence('tempC -3 < -1.5 for 30 s')).toEqual({
      key: 'tempC',
      value: -3,
      comparator: 'below',
      limit: -1.5,
      forS: 30,
    });
    expect(parseEvidence('driftMm 1e-7 > 1e+21 for 1 s')).toEqual({
      key: 'driftMm',
      value: 1e-7,
      comparator: 'above',
      limit: 1e21,
      forS: 1,
    });
  });

  it.each<[string, string | null | undefined]>([
    ['an empty note', ''],
    ['no note', null],
    ['an undefined note', undefined],
    ['an operator’s note', 'Guard sent to the gate'],
    [
      'the producer’s note with a suffix (frame 10’s "on CT-01")',
      'motorTempC 92 > 85 for 60 s on CT-01',
    ],
    ['text before it', ' motorTempC 92 > 85 for 60 s'],
    ['a trailing newline', 'motorTempC 92 > 85 for 60 s\n'],
    ['a doubled space', 'motorTempC  92 > 85 for 60 s'],
    ['a comparator this build does not know', 'motorTempC 92 >= 85 for 60 s'],
    ['a word comparator', 'motorTempC 92 above 85 for 60 s'],
    ['a dwell without its unit', 'motorTempC 92 > 85 for 60'],
    ['a negative dwell', 'motorTempC 92 > 85 for -1 s'],
    ['a fractional dwell', 'motorTempC 92 > 85 for 1.5 s'],
    ['a minutes dwell', 'motorTempC 92 > 85 for 2 min'],
    ['a value that is not a number', 'motorTempC NaN > 85 for 60 s'],
    ['an infinite value', 'motorTempC Infinity > 85 for 60 s'],
    ['a number too large to be one', 'motorTempC 1e999 > 85 for 60 s'],
    ['a negative zero', 'motorTempC -0 > 85 for 60 s'],
    ['a key that starts with a digit', '9motorTempC 92 > 85 for 60 s'],
    ['a key with a dash', 'motor-temp 92 > 85 for 60 s'],
    ['a key that starts with an underscore (`__proto__`)', '__proto__ 1 > 0.5 for 10 s'],
  ])('is not evidence: %s', (_, note) => {
    expect(parseEvidence(note)).toBeNull();
  });

  it('reads a key that is a prototype member as plain text, never off a prototype', () => {
    for (const key of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(parseEvidence(`${key} 1 > 0.5 for 10 s`)).toEqual({
        key,
        value: 1,
        comparator: 'above',
        limit: 0.5,
        forS: 10,
      });
    }
  });

  it('declines a very long note without scanning it', () => {
    expect(parseEvidence('x'.repeat(200_000))).toBeNull();
    expect(parseEvidence(`motorTempC ${'9'.repeat(400)} > 85 for 60 s`)).toBeNull();
    expect(parseEvidence(`${'a'.repeat(100_000)} 1 > 1 for 1 s`)).toBeNull();
  });
});

// A seeded generator, so a failure is reproducible and the suite needs no property-testing package.
function seeded(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (max: number) => Math.floor(next() * max),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
  };
}

describe('parseEvidence on any string', () => {
  const ALPHABET = [...'0123456789 .-+eE<>fors_AZaz\t\n\r:·—é猫😀\u0000'];

  it('never throws, and gives null or finite numbers', () => {
    const random = seeded(20261016);
    for (let round = 0; round < 4000; round += 1) {
      const length = random.int(70);
      const text = Array.from({ length }, () => random.pick(ALPHABET)).join('');
      const evidence = parseEvidence(text);
      if (evidence === null) continue;
      expect(Number.isFinite(evidence.value)).toBe(true);
      expect(Number.isFinite(evidence.limit)).toBe(true);
      expect(Number.isSafeInteger(evidence.forS)).toBe(true);
      expect(['above', 'below']).toContain(evidence.comparator);
    }
  });

  it('never throws on a sample note with characters changed, added or removed', () => {
    const random = seeded(7);
    const [sample] = random.pick(PRODUCER_SAMPLES);
    for (let round = 0; round < 3000; round += 1) {
      const chars = [...sample];
      const at = random.int(chars.length);
      const how = random.int(3);
      if (how === 0) chars.splice(at, 1);
      else if (how === 1) chars.splice(at, 0, random.pick(ALPHABET));
      else chars[at] = random.pick(ALPHABET);
      expect(() => parseEvidence(chars.join(''))).not.toThrow();
    }
  });

  // The producer's template, restated: `${key} ${value} ${op} ${limit} for ${forS} s`.
  it('reads back what the producer’s template writes, for any evidence', () => {
    const random = seeded(99);
    const keys = ['motorTempC', 'leakDetected', 'fuelLevelPct', 'vibrationMms', 'a', 'X9_y'];
    const numbers = (): number =>
      random.pick([
        random.int(200_000) - 100_000,
        random.int(1_000_000) / 100,
        random.int(1_000) / 1_000,
        1e-7,
        1e21,
        0.5,
        0,
      ]);
    for (let round = 0; round < 2000; round += 1) {
      const comparator: TelemetryComparator = random.pick(['above', 'below'] as const);
      const evidence: RuleEvidence = {
        key: random.pick(keys),
        value: numbers(),
        comparator,
        limit: numbers(),
        forS: random.int(90_000),
      };
      const operator = comparator === 'above' ? '>' : '<';
      const note = `${evidence.key} ${evidence.value} ${operator} ${evidence.limit} for ${evidence.forS} s`;
      expect(parseEvidence(note)).toEqual(evidence);
    }
  });
});

describe('evidenceOfTimeline', () => {
  const reported = (note: string | null) => ({ kind: 'reported' as const, note });

  it('reads the note of the first reported entry', () => {
    expect(
      evidenceOfTimeline([
        reported('motorTempC 92 > 85 for 60 s'),
        { kind: 'acknowledged', note: 'On my way' },
      ]),
    ).toMatchObject({ key: 'motorTempC', value: 92 });
  });

  it('is null for an incident an operator reported', () => {
    expect(evidenceOfTimeline([reported('Smoke by the lift')])).toBeNull();
    expect(evidenceOfTimeline([reported(null)])).toBeNull();
  });

  it('never reads an acknowledge or a resolve note as evidence', () => {
    expect(
      evidenceOfTimeline([
        reported(null),
        { kind: 'acknowledged', note: 'motorTempC 92 > 85 for 60 s' },
        { kind: 'resolved', note: 'motorTempC 92 > 85 for 60 s' },
      ]),
    ).toBeNull();
  });

  it('is null for an empty timeline', () => {
    expect(evidenceOfTimeline([])).toBeNull();
  });
});

describe('matchRule', () => {
  it('matches the seeded CT-01 evidence to its rule', () => {
    const evidence = parseEvidence('motorTempC 92 > 85 for 60 s')!;

    expect(matchRule(evidence, CT_RULES, 'Motor over-temperature — Cooling tower 1')).toBe(
      CT_RULES[0],
    );
  });

  it('matches the seeded LKS-B3 evidence to its rule, not the battery rule', () => {
    const evidence = parseEvidence('leakDetected 1 > 0.5 for 10 s')!;

    expect(matchRule(evidence, LEAK_RULES, 'Water leak — Leak sensor, level 3')).toBe(
      LEAK_RULES[0],
    );
  });

  it('matches a below rule on its comparator', () => {
    const evidence = parseEvidence('batteryPct 18 < 20 for 3600 s')!;

    expect(matchRule(evidence, LEAK_RULES, '')).toBe(LEAK_RULES[1]);
  });

  it('gives no rule when the rule changed after the incident', () => {
    const evidence = parseEvidence('motorTempC 92 > 85 for 60 s')!;
    const edited = [rule({ name: 'Motor over-temperature', key: 'motorTempC', limit: 90 })];

    expect(matchRule(evidence, edited, 'Motor over-temperature — Cooling tower 1')).toBeNull();
  });

  it.each<[string, Partial<TelemetryRule>]>([
    ['a different dwell', { forS: 120 }],
    ['the other comparator', { comparator: 'below' }],
    ['another key', { key: 'motorCurrentA' }],
  ])('gives no rule for %s', (_, change) => {
    const evidence = parseEvidence('motorTempC 92 > 85 for 60 s')!;
    const changed = [rule({ name: 'Motor over-temperature', key: 'motorTempC', ...change })];

    expect(matchRule(evidence, changed, 'Motor over-temperature — Cooling tower 1')).toBeNull();
  });

  it('gives no rule when the asset has none', () => {
    expect(matchRule(parseEvidence('motorTempC 92 > 85 for 60 s')!, [], 'x')).toBeNull();
  });

  describe('two rules with the same thresholds', () => {
    const twins = [
      rule({ name: 'Motor over-temperature', key: 'motorTempC' }),
      rule({ name: 'Motor hot (night)', key: 'motorTempC', severity: 'high' }),
    ];
    const evidence = parseEvidence('motorTempC 92 > 85 for 60 s')!;

    it('tells them apart by the title’s prefix', () => {
      expect(matchRule(evidence, twins, 'Motor hot (night) — Cooling tower 1')).toBe(twins[1]);
      expect(matchRule(evidence, twins, 'Motor over-temperature — Cooling tower 1')).toBe(twins[0]);
    });

    it('gives none rather than the first when the title names neither', () => {
      expect(matchRule(evidence, twins, 'Something else — Cooling tower 1')).toBeNull();
      expect(matchRule(evidence, twins, '')).toBeNull();
    });

    it('gives none when a rule name is cut by the title’s length', () => {
      const long = 'M'.repeat(200);
      const cut = [
        rule({ name: long, key: 'motorTempC' }),
        rule({ name: `${long}2`, key: 'motorTempC' }),
      ];

      expect(matchRule(evidence, cut, `${'M'.repeat(120)}…`)).toBeNull();
    });

    it('does not take a rule whose name is only the start of another', () => {
      const names = [
        rule({ name: 'Motor', key: 'motorTempC' }),
        rule({ name: 'Motor over-temperature', key: 'motorTempC' }),
      ];

      expect(matchRule(evidence, names, 'Motor over-temperature — Cooling tower 1')).toBe(names[1]);
    });
  });

  it('does not read a key off a prototype', () => {
    const evidence = parseEvidence('constructor 1 > 0.5 for 10 s')!;

    expect(matchRule(evidence, LEAK_RULES, 'Water leak — Leak sensor')).toBeNull();
  });
});

describe('describeEvidence', () => {
  const evidence = (note: string) => parseEvidence(note)!;

  it('says CT-01’s breach as frame 10 does', () => {
    const description = describeEvidence(
      evidence('motorTempC 92 > 85 for 60 s'),
      CT_RULES[0]!,
      MOTOR_TEMP,
    );

    expect(description).toEqual({
      label: 'Motor temperature',
      reading: '92 °C',
      rule: 'Rule Motor over-temperature · above 85 °C for 60 s',
      limit: 'Limit 85 °C · clears below 80 °C',
      ruleName: 'Motor over-temperature',
    });
  });

  it('says a below rule with its low line and the level it clears above', () => {
    const description = describeEvidence(
      evidence('batteryPct 18 < 20 for 3600 s'),
      LEAK_RULES[1]!,
      BATTERY,
    );

    expect(description.reading).toBe('18 %');
    expect(description.rule).toBe('Rule Leak sensor battery low · below 20 % for 1 h');
    expect(description.limit).toBe('Low at 20 % · clears above 25 %');
  });

  it('says a boolean point in its words, with no number and no limit line', () => {
    const description = describeEvidence(
      evidence('leakDetected 1 > 0.5 for 10 s'),
      LEAK_RULES[0]!,
      LEAK,
    );

    expect(description).toEqual({
      label: 'Leak',
      reading: 'Wet',
      rule: 'Rule Water leak · Wet for 10 s',
      limit: null,
      ruleName: 'Water leak',
    });
  });

  it('says a boolean that fell as its word', () => {
    const point: PointShape = { key: 'inService', label: 'Service', kind: 'boolean', unit: null };

    const description = describeEvidence(evidence('inService 0 < 0.5 for 300 s'), null, point);

    expect(description.reading).toBe('Out of service');
  });

  it.each<[number, string]>([
    [0, ''],
    [1, ' for 1 s'],
    [60, ' for 60 s'],
    [119, ' for 119 s'],
    [120, ' for 2 min'],
    [300, ' for 5 min'],
    [3600, ' for 1 h'],
  ])('writes a dwell of %i s', (forS, words) => {
    const description = describeEvidence(
      { key: 'busVoltageKv', value: 19, comparator: 'below', limit: 19.8, forS },
      null,
      BUS,
    );

    expect(description.rule).toBe(`below 19.8 kV${words}`);
  });

  // The rule changed after the incident: the values are the evidence's, and nothing is claimed
  // about a clear level that the console cannot vouch for.
  it('describes the evidence alone, with no rule name and no limit line, when no rule matched', () => {
    const description = describeEvidence(evidence('motorTempC 92 > 85 for 60 s'), null, MOTOR_TEMP);

    expect(description).toEqual({
      label: 'Motor temperature',
      reading: '92 °C',
      rule: 'above 85 °C for 60 s',
      limit: null,
      ruleName: null,
    });
  });

  it('describes a key this console has no point for from the evidence itself', () => {
    const description = describeEvidence(evidence('motorTempC 92 > 85 for 60 s'), null, undefined);

    expect(description).toEqual({
      label: 'motorTempC',
      reading: '92',
      rule: 'above 85 for 60 s',
      limit: null,
      ruleName: null,
    });
  });

  it('keeps one decimal at most, as the rest of the console writes a reading', () => {
    const description = describeEvidence(evidence('vibrationMms 7.46 > 7.1 for 120 s'), null, {
      key: 'vibrationMms',
      label: 'Vibration',
      kind: 'number',
      unit: 'mm/s',
    });

    expect(description.reading).toBe('7.5 mm/s');
    expect(description.rule).toBe('above 7.1 mm/s for 2 min');
  });
});

describe('summariseEvidence', () => {
  const evidence = (note: string) => parseEvidence(note)!;

  it('says CT-01’s breach in one line, as frame 04 does', () => {
    expect(summariseEvidence(evidence('motorTempC 92 > 85 for 60 s'), MOTOR_TEMP)).toBe(
      '92 °C for 60 s, limit 85 °C',
    );
  });

  it('says a below rule with the same words, the dwell as an age past two minutes', () => {
    expect(summariseEvidence(evidence('batteryPct 18 < 20 for 3600 s'), BATTERY)).toBe(
      '18 % for 1 h, limit 20 %',
    );
    expect(summariseEvidence(evidence('batteryPct 22 < 25 for 300 s'), BATTERY)).toBe(
      '22 % for 5 min, limit 25 %',
    );
  });

  it('writes a dwell up to 119 s in seconds and the next in minutes', () => {
    expect(summariseEvidence(evidence('batteryPct 18 < 20 for 119 s'), BATTERY)).toBe(
      '18 % for 119 s, limit 20 %',
    );
    expect(summariseEvidence(evidence('batteryPct 18 < 20 for 120 s'), BATTERY)).toBe(
      '18 % for 2 min, limit 20 %',
    );
  });

  it('leaves out a dwell of 0', () => {
    expect(summariseEvidence(evidence('busVoltageKv 19 < 19.8 for 0 s'), BUS)).toBe(
      '19 kV, limit 19.8 kV',
    );
  });

  it('says a boolean point in its word and the dwell, with no limit', () => {
    expect(summariseEvidence(evidence('leakDetected 1 > 0.5 for 10 s'), LEAK)).toBe('Wet for 10 s');
  });

  it('has no unit without the point, which is less and not wrong', () => {
    expect(summariseEvidence(evidence('motorTempC 92 > 85 for 60 s'), undefined)).toBe(
      '92 for 60 s, limit 85',
    );
  });

  it('keeps one decimal at most, as the rest of the console writes a reading', () => {
    const vibration: PointShape = {
      key: 'vibrationMms',
      label: 'Vibration',
      kind: 'number',
      unit: 'mm/s',
    };

    expect(summariseEvidence(evidence('vibrationMms 7.46 > 7.1 for 120 s'), vibration)).toBe(
      '7.5 mm/s for 2 min, limit 7.1 mm/s',
    );
  });

  it('agrees with describeEvidence on the reading', () => {
    const motor = evidence('motorTempC 92 > 85 for 60 s');

    expect(
      summariseEvidence(motor, MOTOR_TEMP).startsWith(
        describeEvidence(motor, null, MOTOR_TEMP).reading,
      ),
    ).toBe(true);
  });
});
