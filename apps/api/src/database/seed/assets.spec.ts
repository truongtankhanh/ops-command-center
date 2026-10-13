import { ASSET_CLASSES } from './asset-catalogue';
import { ASSETS } from './assets';
import { ZONES, type ZoneSeed } from './campus';

/** The database's `asset_code_check` (V2-05.1 widened it from ADR-0018's first pattern). */
const ASSET_CODE_PATTERN = /^[A-Z]{2,4}-[A-Z0-9]{2,6}$/;

/** How far outside its zone's rectangle an asset may stand (V2-05.1: a generator in the yard). */
const MAX_OUTSIDE_M = 5;

const ZONE_BY_CODE = new Map(ZONES.map((zone) => [zone.code, zone]));

/** Metres from a point to a zone's rectangle, in metres from the campus centre; 0 inside it. */
const distanceFromZone = (
  { at, size }: ZoneSeed,
  [east, north]: readonly [number, number],
): number => {
  const pastEast = Math.max(Math.abs(east - at[0]) - size[0] / 2, 0);
  const pastNorth = Math.max(Math.abs(north - at[1]) - size[1] / 2, 0);
  return Math.hypot(pastEast, pastNorth);
};

describe('demo asset seed', () => {
  const codes = ASSETS.map((asset) => asset.code);

  it('has thirty-one assets: twenty-two equipment and nine indoor climate sensors', () => {
    // Literals, so a change is a conscious edit (the e2e seed case counts the rows too).
    expect(ASSETS).toHaveLength(31);
    const sensors = ASSETS.filter((asset) => asset.class === 'indoor_climate');
    expect(sensors).toHaveLength(9);
    expect(ASSETS.length - sensors.length).toBe(22);
  });

  it('has unique codes and names the asset table accepts', () => {
    expect(new Set(codes).size).toBe(codes.length);
    for (const { code, name } of ASSETS) {
      // `asset.code` is varchar(32) with `asset_code_check`, `name` varchar(120).
      expect([code, ASSET_CODE_PATTERN.test(code), code.length <= 32]).toEqual([code, true, true]);
      expect([code, name.length > 0, name.length <= 120]).toEqual([code, true, true]);
    }
  });

  it('stands every asset in a seed zone and gives it a seed class', () => {
    const classCodes = new Set(ASSET_CLASSES.map((assetClass) => assetClass.code));
    for (const { code, zone, class: classCode } of ASSETS) {
      expect([code, ZONE_BY_CODE.has(zone)]).toEqual([code, true]);
      expect([code, classCodes.has(classCode)]).toEqual([code, true]);
    }
  });

  it('keeps every position within 5 m of its zone, and only the generator outside it', () => {
    const outside: string[] = [];
    for (const { code, zone, at } of ASSETS) {
      const seedZone = ZONE_BY_CODE.get(zone);
      // A missing zone is the previous case's failure, not this one's.
      if (!seedZone) continue;
      const distance = distanceFromZone(seedZone, at);
      expect([code, distance <= MAX_OUTSIDE_M]).toEqual([code, true]);
      if (distance > 0) outside.push(code);
    }
    // V2-05.1 Q4: the generator is 3 m east of the Data Center, in the yard no zone covers.
    expect(outside).toEqual(['GEN-01']);
    const generator = ASSETS.find((asset) => asset.code === 'GEN-01')!;
    expect(distanceFromZone(ZONE_BY_CODE.get(generator.zone)!, generator.at)).toBeCloseTo(3, 6);
  });

  it('gives every asset an elevation and a heading the asset table accepts', () => {
    for (const { code, zone, elevationM, headingDeg } of ASSETS) {
      // `asset_elevation_check` and `asset_heading_check`.
      expect([code, elevationM >= 0]).toEqual([code, true]);
      expect([code, headingDeg >= 0 && headingDeg < 360]).toEqual([code, true]);
      // Nothing stands above the roof of its building.
      const heightM = ZONE_BY_CODE.get(zone)?.heightM;
      if (heightM !== undefined) expect([code, elevationM <= heightM]).toEqual([code, true]);
    }
  });

  it('puts the three roof assets at the height of their building', () => {
    const roofs = ['CT-01', 'CT-02', 'AHU-H1'];
    for (const code of roofs) {
      const asset = ASSETS.find((candidate) => candidate.code === code)!;
      const heightM = ZONE_BY_CODE.get(asset.zone)?.heightM;
      expect([code, asset.elevationM, heightM]).toEqual([code, heightM, heightM]);
      expect([code, heightM !== undefined && heightM > 0]).toEqual([code, true]);
    }
    // Nothing else stands at a roof: the other raised assets are on a level (4 m a floor).
    const raised = ASSETS.filter((asset) => asset.elevationM > 0).map((asset) => asset.code);
    expect(raised.sort()).toEqual(['AHU-H1', 'CT-01', 'CT-02', 'FH-L1', 'LKS-B3']);
  });

  it('gives every building without an air handler one indoor climate sensor', () => {
    const buildings = ZONES.filter((zone) => zone.kind === 'building').map((zone) => zone.code);
    const withAirHandler = new Set(
      ASSETS.filter((asset) => asset.class === 'air_handler').map((asset) => asset.zone),
    );
    const sensorZones = ASSETS.filter((asset) => asset.class === 'indoor_climate').map(
      (asset) => asset.zone,
    );
    // Sorted lists, so a building with two sensors, or a sensor outside a building, is a difference.
    expect(sensorZones.sort()).toEqual(
      buildings.filter((code) => !withAirHandler.has(code)).sort(),
    );
    expect(sensorZones).toHaveLength(9);
  });

  it('has the demo assets of each class, as asset-classes.md lists them', () => {
    const perClass: Record<string, number> = {};
    for (const { class: classCode } of ASSETS) {
      perClass[classCode] = (perClass[classCode] ?? 0) + 1;
    }
    expect(perClass).toEqual({
      cooling_tower: 2,
      standby_generator: 1,
      ups: 1,
      ups_battery: 1,
      precision_cooling: 2,
      transformer: 1,
      switchgear: 1,
      chiller: 1,
      air_handler: 3,
      booster_pump: 1,
      lift: 3,
      barrier_arm: 2,
      fume_hood: 1,
      gas_detector: 1,
      leak_sensor: 1,
      indoor_climate: 9,
    });
    // Every class of the catalogue has an asset to draw.
    for (const { code } of ASSET_CLASSES) expect([code, code in perClass]).toEqual([code, true]);
  });
});
