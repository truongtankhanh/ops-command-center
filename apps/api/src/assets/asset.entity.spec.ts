import { AssetEntity } from './asset.entity';
import { AssetClassEntity } from './asset-class.entity';
import { TelemetryPointEntity } from './telemetry-point.entity';

const point = (key: string, headline: 1 | 2 | null = null): TelemetryPointEntity =>
  Object.assign(new TelemetryPointEntity(), {
    id: `point-${key}`,
    assetClassId: 'class-1',
    key,
    label: `Label of ${key}`,
    unit: '°C',
    kind: 'number',
    min: 0,
    max: 150,
    enumValues: null,
    expectedIntervalS: 5,
    headline,
    createdAt: new Date('2026-10-01T08:00:00Z'),
  });

const assetClass = (over: Partial<AssetClassEntity> = {}): AssetClassEntity =>
  Object.assign(new AssetClassEntity(), {
    id: 'class-1',
    code: 'cooling_tower',
    name: 'Cooling tower',
    modelKey: null,
    footprintWM: 4,
    footprintDM: 3,
    footprintHM: 5,
    createdAt: new Date('2026-10-01T08:00:00Z'),
    points: [],
    ...over,
  });

const asset = (assetClassValue?: AssetClassEntity): AssetEntity =>
  Object.assign(new AssetEntity(), {
    id: 'asset-1',
    code: 'CT-01',
    name: 'Cooling tower 1',
    assetClassId: 'class-1',
    zoneId: 'zone-1',
    lng: 108.44,
    lat: 11.95,
    elevationM: 14,
    headingDeg: 90,
    createdAt: new Date('2026-10-01T08:00:00Z'),
    assetClass: assetClassValue,
  });

describe('AssetEntity.toContract()', () => {
  it('maps the asset, its position and its class, and nothing else', () => {
    const contract = asset(assetClass()).toContract();

    expect(contract).toEqual({
      id: 'asset-1',
      code: 'CT-01',
      name: 'Cooling tower 1',
      class: {
        id: 'class-1',
        code: 'cooling_tower',
        name: 'Cooling tower',
        modelUrl: null,
        footprintM: { width: 4, depth: 3, height: 5 },
      },
      zoneId: 'zone-1',
      position: [108.44, 11.95],
      elevationM: 14,
      headingDeg: 90,
      headline: [],
    });
  });

  it("serves the class's model file under /models/ and `null` when it has none", () => {
    expect(asset(assetClass({ modelKey: null })).toContract().class.modelUrl).toBeNull();
    expect(asset(assetClass({ modelKey: 'cooling_tower.glb' })).toContract().class.modelUrl).toBe(
      '/models/cooling_tower.glb',
    );
  });

  it('lists only the headline points, by rank, whatever order the class holds them in', () => {
    const points = [point('motorCurrentA'), point('motorTempC', 2), point('fanSpeedRpm', 1)];

    const { headline } = asset(assetClass({ points })).toContract();

    expect(headline.map((p) => p.key)).toEqual(['fanSpeedRpm', 'motorTempC']);
  });

  it('gives an empty headline, not an error, for a class with no headline point', () => {
    const { headline } = asset(assetClass({ points: [point('a'), point('b')] })).toContract();

    expect(headline).toEqual([]);
  });

  it('does not reorder the relation it was given', () => {
    const points = [point('b', 2), point('a', 1)];

    asset(assetClass({ points })).toContract();

    expect(points.map((p) => p.key)).toEqual(['b', 'a']);
  });

  it('refuses to map an asset whose class or points were not loaded', () => {
    // A request would answer 500 here; the routes always load both.
    expect(() => asset(undefined).toContract()).toThrow(/needs the `assetClass` relation/);
    expect(() => asset(assetClass({ points: undefined })).toContract()).toThrow(
      /needs the `assetClass` relation/,
    );
  });
});
