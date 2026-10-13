import { orderPoints, type ResolvableRule, resolveAssetRules } from './asset-resolution';

const THIS_ASSET = 'asset-1';
const ANOTHER_ASSET = 'asset-2';

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

const ids = (rules: ResolvableRule[]) => rules.map((r) => r.id);

describe('resolveAssetRules', () => {
  it('gives the class rules when the asset has no override', () => {
    const rules = [rule('Motor over-temperature'), rule('High vibration')];

    expect(ids(resolveAssetRules(THIS_ASSET, rules))).toEqual([
      'class/High vibration',
      'class/Motor over-temperature',
    ]);
  });

  it("replaces the class rule of the same name with the asset's own, and keeps the others", () => {
    const override = rule('Motor over-temperature', { assetId: THIS_ASSET, limit: 95, clear: 90 });
    const rules = [rule('Motor over-temperature'), rule('High vibration'), override];

    const resolved = resolveAssetRules(THIS_ASSET, rules);

    expect(ids(resolved)).toEqual(['class/High vibration', `${THIS_ASSET}/Motor over-temperature`]);
    expect(resolved[1]).toBe(override);
    expect(resolved[1]).toMatchObject({ limit: 95, clear: 90 });
  });

  it('lets the override win whatever order the rules arrive in', () => {
    const classRule = rule('Motor over-temperature');
    const override = rule('Motor over-temperature', { assetId: THIS_ASSET, limit: 95 });

    for (const rules of [
      [classRule, override],
      [override, classRule],
    ]) {
      expect(resolveAssetRules(THIS_ASSET, rules)).toEqual([override]);
    }
  });

  it('leaves out a disabled class rule', () => {
    const rules = [rule('Motor over-temperature'), rule('High vibration', { enabled: false })];

    expect(ids(resolveAssetRules(THIS_ASSET, rules))).toEqual(['class/Motor over-temperature']);
  });

  it('turns a rule off for the asset whose own rule is disabled, and for that asset only', () => {
    const rules = [
      rule('Motor over-temperature'),
      rule('High vibration'),
      rule('Motor over-temperature', { assetId: THIS_ASSET, enabled: false }),
    ];

    // The disabled override replaced the class rule and was then dropped: it does not fall away
    // and let the class rule alarm again.
    expect(ids(resolveAssetRules(THIS_ASSET, rules))).toEqual(['class/High vibration']);
    // Another asset of the class is not silenced by it.
    expect(ids(resolveAssetRules(ANOTHER_ASSET, rules))).toEqual([
      'class/High vibration',
      'class/Motor over-temperature',
    ]);
  });

  it("ignores another asset's override", () => {
    const rules = [
      rule('Motor over-temperature'),
      rule('Motor over-temperature', { assetId: ANOTHER_ASSET, limit: 120 }),
      rule('Bearing temperature', { assetId: ANOTHER_ASSET }),
    ];

    expect(resolveAssetRules(THIS_ASSET, rules)).toEqual([rule('Motor over-temperature')]);
  });

  it('orders by name by code point, whatever the input order', () => {
    const rules = [rule('b rule'), rule('a rule'), rule('B rule'), rule('A rule')];

    expect(resolveAssetRules(THIS_ASSET, rules).map((r) => r.name)).toEqual([
      'A rule',
      'B rule',
      'a rule',
      'b rule',
    ]);
    expect(resolveAssetRules(THIS_ASSET, [...rules].reverse()).map((r) => r.name)).toEqual([
      'A rule',
      'B rule',
      'a rule',
      'b rule',
    ]);
  });

  it('does not change the list it was given', () => {
    const rules = [rule('b'), rule('a', { enabled: false }), rule('c')];
    const before = [...rules];

    resolveAssetRules(THIS_ASSET, rules);

    expect(rules).toEqual(before);
  });

  it('gives nothing for no rules', () => {
    expect(resolveAssetRules(THIS_ASSET, [])).toEqual([]);
  });
});

describe('orderPoints', () => {
  const point = (key: string, headline: 1 | 2 | null = null) => ({ key, headline });

  it('puts the headline points first by rank, then the rest by key', () => {
    const points = [
      point('zeta'),
      point('alpha'),
      point('beta', 2),
      point('gamma', 1),
      point('Delta'),
    ];

    expect(orderPoints(points).map((p) => p.key)).toEqual([
      'gamma',
      'beta',
      'Delta',
      'alpha',
      'zeta',
    ]);
  });

  it('orders a class with no headline point by key', () => {
    expect(orderPoints([point('b'), point('a'), point('c')]).map((p) => p.key)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('does not depend on the input order', () => {
    const points = [point('c'), point('a', 2), point('b', 1)];

    expect(orderPoints(points)).toEqual(orderPoints([...points].reverse()));
  });

  it('returns a new array and leaves the input as it was', () => {
    const points = [point('b'), point('a', 1)];
    const before = [...points];

    const ordered = orderPoints(points);

    expect(ordered).not.toBe(points);
    expect(points).toEqual(before);
  });
});
