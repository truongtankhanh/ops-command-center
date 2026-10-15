import type { TelemetryPoint } from '@occ/contracts';
// `?raw` (typed by `vite/client`): the file's text, with no `node:fs` and no `@types/node`.
import catalogueText from '../../../../ops/telemetry-sim/catalogue.json?raw';
import { hasChildren, partsOf, partText } from './assetParts';

/**
 * The simulator's copy of the seeded catalogue: the assets and the points of their class. The API's
 * `telemetry-sim-catalogue.spec.ts` keeps it equal to the seed, and an app never imports another
 * app (ADR-0001), so this is the console's way to see "the seeded catalogue" (V2-09.9). The path is
 * from `apps/console/src/lib` to the repo root.
 */
interface SimAsset {
  code: string;
  classCode: string;
  points: { key: string; kind: string }[];
}
const CATALOGUE = JSON.parse(catalogueText) as { assets: SimAsset[] };

const pointsOfClass = (classCode: string): string[] => {
  const asset = CATALOGUE.assets.find((candidate) => candidate.classCode === classCode);
  return asset === undefined ? [] : asset.points.map((point) => point.key);
};

const MODELLED = ['cooling_tower', 'standby_generator'];

const point = (overrides: Partial<TelemetryPoint> = {}): TelemetryPoint => ({
  key: 'fanSpeedRpm',
  label: 'Fan speed',
  unit: 'rpm',
  kind: 'number',
  min: null,
  max: null,
  enumValues: null,
  expectedIntervalS: 1,
  headline: null,
  ...overrides,
});

describe('the part tables', () => {
  it('holds the two modelled classes and no other', () => {
    for (const classCode of MODELLED) expect(partsOf(classCode)).toBeDefined();
    expect(partsOf('leak_sensor')).toBeUndefined();
    expect(partsOf('unknown_class')).toBeUndefined();
  });

  it('does not read a class off the object prototype', () => {
    expect(partsOf('constructor')).toBeUndefined();
    expect(partsOf('__proto__')).toBeUndefined();
  });

  it.each(MODELLED)('binds only points of %s in the seeded catalogue', (classCode) => {
    const keys = pointsOfClass(classCode);
    expect(keys.length).toBeGreaterThan(0);

    for (const part of partsOf(classCode) ?? []) {
      if (part.bind !== null) expect(keys, `${classCode} ${part.role}`).toContain(part.bind);
    }
  });

  it.each(MODELLED)('names each role once, and a parent that is a role of %s', (classCode) => {
    const parts = partsOf(classCode) ?? [];
    const roles = parts.map((part) => part.role);

    expect(new Set(roles).size).toBe(roles.length);
    for (const part of parts) {
      if (part.parent !== null) expect(roles, `${classCode} ${part.role}`).toContain(part.parent);
    }
  });

  it.each(MODELLED)('draws a child after its parent, in %s', (classCode) => {
    const parts = partsOf(classCode) ?? [];
    for (const [index, part] of parts.entries()) {
      if (part.parent === null) continue;
      expect(parts.findIndex((other) => other.role === part.parent)).toBeLessThan(index);
    }
  });

  it('binds a point once per class', () => {
    for (const classCode of MODELLED) {
      const keys = (partsOf(classCode) ?? []).flatMap((part) => (part.bind ? [part.bind] : []));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('hasChildren', () => {
  it('is true for a part another part sits under', () => {
    const parts = partsOf('cooling_tower') ?? [];
    const fanStack = parts.find((part) => part.role === 'FanStack');
    const casing = parts.find((part) => part.role === 'Casing');

    expect(fanStack && hasChildren(fanStack, parts)).toBe(true);
    expect(casing && hasChildren(casing, parts)).toBe(false);
  });
});

describe('partText', () => {
  const fan = point();

  it('says static for a part that binds nothing, even when stale', () => {
    expect(partText({ bind: null }, undefined, undefined, false)).toBe('static');
    expect(partText({ bind: null }, undefined, undefined, true)).toBe('static');
  });

  it('writes the reading as the readings rows do', () => {
    expect(partText({ bind: 'fanSpeedRpm' }, fan, 1420, false)).toBe('1,420 rpm');
    expect(
      partText(
        { bind: 'breakerClosed' },
        point({ key: 'breakerClosed', kind: 'boolean', unit: null }),
        false,
        false,
      ),
    ).toBe('Open');
  });

  it('says "last" before a reading that is not live', () => {
    expect(partText({ bind: 'fanSpeedRpm' }, fan, 1420, true)).toBe('last 1,420 rpm');
  });

  it('shows a dash for a part with no reading or no point, never "last —"', () => {
    expect(partText({ bind: 'fanSpeedRpm' }, fan, undefined, false)).toBe('—');
    expect(partText({ bind: 'fanSpeedRpm' }, fan, undefined, true)).toBe('—');
    expect(partText({ bind: 'fanSpeedRpm' }, undefined, 1420, false)).toBe('—');
  });
});
