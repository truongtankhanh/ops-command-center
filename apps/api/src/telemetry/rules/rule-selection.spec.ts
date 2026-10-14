import type { TelemetryPoint, TelemetryPointKind } from '@occ/contracts';
import { type ResolvableRule, resolveAssetRules } from '../../assets/asset-resolution';
import { ASSET_CLASSES } from '../../database/seed/asset-catalogue';
import { selectEvaluableRules } from './rule-selection';

const THIS_ASSET = 'asset-1';
const ANOTHER_ASSET = 'asset-2';

const point = (
  key: string,
  kind: TelemetryPointKind = 'number',
  expectedIntervalS = 5,
): TelemetryPoint => ({
  key,
  label: key,
  unit: null,
  kind,
  min: null,
  max: null,
  enumValues: kind === 'enum' ? ['on', 'off'] : null,
  expectedIntervalS,
  headline: null,
});

/** A class rule; `assetId` makes it an override. */
const rule = (name: string, over: Partial<ResolvableRule> = {}): ResolvableRule => ({
  id: `${over.assetId ?? 'class'}/${name}`,
  name,
  key: 'motorTempC',
  comparator: 'above',
  limit: 85,
  clear: 80,
  forS: 60,
  severity: 'critical',
  incidentType: 'equipment_fault',
  assetId: null,
  enabled: true,
  ...over,
});

const POINTS = [
  point('motorTempC', 'number', 10),
  point('vibrationMms', 'number', 20),
  point('running', 'boolean', 5),
  point('switchState', 'enum', 5),
];

const asset = (rules: ResolvableRule[], points = POINTS, id = THIS_ASSET) => ({
  id,
  points,
  rules,
});

const ids = (selected: ReturnType<typeof selectEvaluableRules>, key: string) =>
  (selected.get(key) ?? []).map((r) => r.id);

describe('selectEvaluableRules', () => {
  it('groups the rules of an asset by the key they watch, in name order', () => {
    const selected = selectEvaluableRules(
      asset([
        rule('Motor over-temperature'),
        rule('High vibration', { key: 'vibrationMms', limit: 7.1, clear: 5 }),
        rule('Hot winding'),
      ]),
    );

    expect([...selected.keys()].sort()).toEqual(['motorTempC', 'vibrationMms']);
    expect(ids(selected, 'motorTempC')).toEqual([
      'class/Hot winding',
      'class/Motor over-temperature',
    ]);
    expect(ids(selected, 'vibrationMms')).toEqual(['class/High vibration']);
  });

  it("replaces the class rule of the same name with the asset's own override", () => {
    const override = rule('Motor over-temperature', { assetId: THIS_ASSET, limit: 95, clear: 90 });

    for (const rules of [
      [rule('Motor over-temperature'), override],
      [override, rule('Motor over-temperature')],
    ]) {
      const selected = selectEvaluableRules(asset(rules));

      expect(selected.get('motorTempC')).toEqual([
        expect.objectContaining({ id: override.id, limit: 95, clear: 90 }),
      ]);
    }
  });

  it("keeps the class rule for an asset that has no override, and ignores another asset's", () => {
    const rules = [
      rule('Motor over-temperature'),
      rule('Motor over-temperature', { assetId: ANOTHER_ASSET, limit: 95, clear: 90 }),
    ];

    const selected = selectEvaluableRules(asset(rules));

    expect(selected.get('motorTempC')).toEqual([
      expect.objectContaining({ id: 'class/Motor over-temperature', limit: 85 }),
    ]);
  });

  it('leaves a rule out when its override is disabled, and the class rule does not come back', () => {
    const rules = [
      rule('Motor over-temperature'),
      rule('Motor over-temperature', { assetId: THIS_ASSET, enabled: false }),
      rule('High vibration', { key: 'vibrationMms' }),
    ];

    const selected = selectEvaluableRules(asset(rules));

    expect(selected.has('motorTempC')).toBe(false);
    expect(ids(selected, 'vibrationMms')).toEqual(['class/High vibration']);
  });

  it('leaves a disabled class rule out', () => {
    const selected = selectEvaluableRules(
      asset([rule('Motor over-temperature', { enabled: false })]),
    );

    expect(selected.size).toBe(0);
  });

  it('drops a rule on an enum point and one on a key the asset does not have', () => {
    const selected = selectEvaluableRules(
      asset([
        rule('Switch state', { key: 'switchState' }),
        rule('Missing point', { key: 'noSuchPoint' }),
        rule('Motor over-temperature'),
      ]),
    );

    expect([...selected.keys()]).toEqual(['motorTempC']);
  });

  it('keeps a rule on a boolean point', () => {
    const selected = selectEvaluableRules(
      asset([rule('Stopped', { key: 'running', comparator: 'below', limit: 0.5, clear: 0.5 })]),
    );

    expect(ids(selected, 'running')).toEqual(['class/Stopped']);
  });

  it("carries the point's interval, which the machine measures a gap against", () => {
    const selected = selectEvaluableRules(
      asset([rule('Motor over-temperature'), rule('Stopped', { key: 'running' })]),
    );

    expect(selected.get('motorTempC')?.[0]?.expectedIntervalS).toBe(10);
    expect(selected.get('running')?.[0]?.expectedIntervalS).toBe(5);
  });

  it('gives the same result for a list that was already resolved', () => {
    const rules = [
      rule('Motor over-temperature'),
      rule('Motor over-temperature', { assetId: THIS_ASSET, limit: 95, clear: 90 }),
      rule('High vibration', { key: 'vibrationMms', enabled: false }),
      rule('Hot winding', { assetId: ANOTHER_ASSET }),
    ];

    expect(selectEvaluableRules(asset(resolveAssetRules(THIS_ASSET, rules)))).toEqual(
      selectEvaluableRules(asset(rules)),
    );
  });

  it('keeps a key such as __proto__ as a key', () => {
    const selected = selectEvaluableRules(
      asset([rule('Odd', { key: '__proto__' })], [point('__proto__')]),
    );

    expect(selected.size).toBe(1);
    expect(ids(selected, '__proto__')).toEqual(['class/Odd']);
  });

  it('has nothing for an asset with no rules', () => {
    expect(selectEvaluableRules(asset([])).size).toBe(0);
  });

  describe('the seeded catalogue', () => {
    const forClass = (code: string) => {
      const assetClass = ASSET_CLASSES.find((candidate) => candidate.code === code);
      if (!assetClass) throw new Error(`no class ${code}`);
      return {
        id: `asset-of-${code}`,
        points: assetClass.points.map((seed) => point(seed.key, seed.kind, seed.expectedIntervalS)),
        rules: assetClass.rules.map((seed) =>
          rule(seed.name, { ...seed, id: `${code}/${seed.name}`, assetId: null, enabled: true }),
        ),
      };
    };

    it.each(
      ASSET_CLASSES.filter((c) => c.rules.length > 0).map((c) => [c.code, c.rules.length] as const),
    )('%s: every seeded rule is evaluable (%i)', (code, count) => {
      const selected = selectEvaluableRules(forClass(code));

      const total = [...selected.values()].reduce((sum, rules) => sum + rules.length, 0);
      expect(total).toBe(count);
    });

    it('selects all 22 seeded rules across the classes', () => {
      const total = ASSET_CLASSES.reduce(
        (sum, assetClass) =>
          sum +
          [...selectEvaluableRules(forClass(assetClass.code)).values()].reduce(
            (inner, rules) => inner + rules.length,
            0,
          ),
        0,
      );

      expect(total).toBe(22);
    });

    it('has no rule for the indoor climate sensor', () => {
      expect(selectEvaluableRules(forClass('indoor_climate')).size).toBe(0);
    });
  });
});
