import type { Asset, LngLat, Zone, ZoneKind } from '@occ/contracts';
import { offsetM } from './geo';
import { fanOutAssets } from './mapFeatures';
import { DEFAULT_BUILDING_HEIGHT_M, makeFrame } from './twinScene';
import { assetPose, boxOf, type PlacedAsset, placeAssets, placementOf } from './twinPlacement';

/*
 * The demo campus, copied: the zones the 31 assets stand in and the assets themselves, in metres east and north
 * of the campus centre. The sources are `docs/design/v2/asset-classes.md` § Demo assets, `seed/campus.ts` (zones)
 * and `seed/assets.ts` in the API; the console cannot import them (ADR-0001), so there is no guard against drift
 * but this test: if a position is off, the seed is right and this table is wrong (V2-14.6).
 */
const CENTER: LngLat = [108.4415, 11.953];
const frame = makeFrame(CENTER);

/** A zone as the API serves it: a rectangle of `size` metres centred `at` metres east and north of the centre. */
function zoneAt(
  code: string,
  kind: ZoneKind,
  at: [number, number],
  size: [number, number],
  heightM?: number,
): Zone {
  const [east, north] = at;
  const [width, depth] = size;
  const corner = (x: number, y: number) => offsetM(CENTER, east + x * width, north + y * depth);
  return {
    id: code,
    code,
    name: code,
    kind,
    ...(heightM === undefined ? {} : { heightM }),
    polygon: [
      corner(-0.5, -0.5),
      corner(0.5, -0.5),
      corner(0.5, 0.5),
      corner(-0.5, 0.5),
      corner(-0.5, -0.5),
    ],
    center: offsetM(CENTER, east, north),
  };
}

const ZONES: Zone[] = [
  zoneAt('GATE-MAIN', 'gate', [0, -250], [44, 22]),
  zoneAt('BLD-HUB', 'building', [-120, 60], [90, 60], 24),
  zoneAt('BLD-LIB', 'building', [40, 120], [70, 50], 18),
  zoneAt('BLD-DC', 'building', [175, 40], [60, 46], 14),
  zoneAt('BLD-LHA', 'building', [-60, -110], [80, 40], 16),
  zoneAt('BLD-STU', 'building', [110, -95], [72, 50], 12),
  zoneAt('BLD-LAB', 'building', [170, 212], [90, 64], 16),
  zoneAt('BLD-DORA', 'building', [80, -181.5], [90, 47], 20),
  zoneAt('BLD-DORB', 'building', [178.5, -181.5], [87, 47], 20),
  zoneAt('BLD-CLINIC', 'building', [183.5, -240], [77, 56], 10),
  zoneAt('BLD-SPORTS', 'building', [-40, 207], [80, 74], 14),
  zoneAt('BLD-ADMIN', 'building', [-226, -14], [92, 68], 14),
  zoneAt('BLD-SEC', 'building', [42, -251.5], [32, 27], 6),
  zoneAt('UTL-PLANT', 'utility', [65, 207], [110, 74]),
  zoneAt('GATE-EAST', 'gate', [216.5, -55], [23, 34]),
];

/** `footprint_m` (width × depth × height) per class, from `asset-classes.md` § Classes. */
const FOOTPRINTS: Record<string, [number, number, number]> = {
  cooling_tower: [4, 4, 5],
  standby_generator: [6, 2.5, 3],
  ups: [2, 1, 2],
  ups_battery: [3, 0.8, 2],
  precision_cooling: [1.8, 0.9, 2],
  transformer: [2.5, 2, 2.5],
  switchgear: [6, 1, 2.3],
  chiller: [6, 2, 2.5],
  air_handler: [4, 2, 2],
  booster_pump: [1.2, 0.8, 1.2],
  lift: [2, 2, 3],
  barrier_arm: [4, 0.4, 1.2],
  fume_hood: [1.8, 0.9, 2.4],
  gas_detector: [1.4, 1.4, 1.4],
  leak_sensor: [1.4, 1.4, 1.4],
  indoor_climate: [1.4, 1.4, 1.4],
};

/** [code, class, zone, east, north, elevation m], in the order of § Demo assets. */
const ROWS: [string, string, string, number, number, number][] = [
  ['CT-01', 'cooling_tower', 'BLD-DC', 161, 48, 14],
  ['CT-02', 'cooling_tower', 'BLD-DC', 174, 48, 14],
  ['GEN-01', 'standby_generator', 'BLD-DC', 208, 46.5, 0],
  ['UPS-01', 'ups', 'BLD-DC', 164.5, 29.7, 0],
  ['BAT-01', 'ups_battery', 'BLD-DC', 179.5, 29.7, 0],
  ['CRAC-01', 'precision_cooling', 'BLD-DC', 190, 50.2, 0],
  ['CRAC-02', 'precision_cooling', 'BLD-DC', 190, 42.25, 0],
  ['TR-01', 'transformer', 'UTL-PLANT', 94, 216, 0],
  ['SWG-01', 'switchgear', 'UTL-PLANT', 46, 215, 0],
  ['CH-01', 'chiller', 'UTL-PLANT', 30, 200, 0],
  ['AHU-C1', 'air_handler', 'BLD-CLINIC', 183, -240, 0],
  ['AHU-L1', 'air_handler', 'BLD-LIB', 40, 120, 0],
  ['AHU-H1', 'air_handler', 'BLD-HUB', -130, 60, 24],
  ['PMP-S1', 'booster_pump', 'BLD-STU', 110, -95, 0],
  ['LFT-A2', 'lift', 'BLD-DORA', 60, -172, 0],
  ['LFT-B1', 'lift', 'BLD-DORB', 152, -170, 0],
  ['LFT-H1', 'lift', 'BLD-HUB', -100, 45, 0],
  ['BAR-01', 'barrier_arm', 'GATE-MAIN', 8, -252, 0],
  ['BAR-02', 'barrier_arm', 'GATE-EAST', 216, -55, 0],
  ['FH-L1', 'fume_hood', 'BLD-LAB', 150, 205, 4],
  ['GAS-L1', 'gas_detector', 'BLD-LAB', 192, 200, 0],
  ['LKS-B3', 'leak_sensor', 'BLD-DORB', 204, -193, 8],
  ['ICS-DC', 'indoor_climate', 'BLD-DC', 175, 40, 0],
  ['ICS-LHA', 'indoor_climate', 'BLD-LHA', -60, -110, 0],
  ['ICS-STU', 'indoor_climate', 'BLD-STU', 110, -95, 0],
  ['ICS-LAB', 'indoor_climate', 'BLD-LAB', 170, 212, 0],
  ['ICS-DORA', 'indoor_climate', 'BLD-DORA', 80, -181.5, 0],
  ['ICS-DORB', 'indoor_climate', 'BLD-DORB', 178.5, -181.5, 0],
  ['ICS-SPORTS', 'indoor_climate', 'BLD-SPORTS', -40, 207, 0],
  ['ICS-ADMIN', 'indoor_climate', 'BLD-ADMIN', -226, -14, 0],
  ['ICS-SEC', 'indoor_climate', 'BLD-SEC', 42, -251.5, 0],
];

const ASSETS: Asset[] = ROWS.map(([code, classCode, zoneId, east, north, elevationM]) => {
  const [width, depth, height] = FOOTPRINTS[classCode]!;
  return {
    id: code,
    code,
    name: code,
    class: {
      id: classCode,
      code: classCode,
      name: classCode,
      modelUrl: null,
      footprintM: { width, depth, height },
    },
    zoneId,
    position: offsetM(CENTER, east, north),
    elevationM,
    headingDeg: 0,
    headline: [],
  };
});

const placed = placeAssets(ASSETS, ZONES, frame);
const byCode = (code: string): PlacedAsset => placed.find((p) => p.code === code)!;
const codesOf = (list: readonly PlacedAsset[]) => list.map((p) => p.code).sort();
const inPlacement = (placement: PlacedAsset['placement']) =>
  codesOf(placed.filter((p) => p.placement === placement));

describe('the demo campus', () => {
  it('has 31 assets, each with a pose, ordered by code', () => {
    expect(placed).toHaveLength(31);
    expect(placed.map((p) => p.code)).toEqual([...ASSETS.map((a) => a.code)].sort());
    for (const { pose } of placed) {
      for (const value of Object.values(pose)) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('carries each asset’s class code, which is what a model replaces the box by', () => {
    expect(byCode('CT-01').classCode).toBe('cooling_tower');
    expect(byCode('GEN-01').classCode).toBe('standby_generator');
    expect(byCode('ICS-DC').classCode).toBe('indoor_climate');
    expect(placed.map((p) => p.classCode)).toEqual(
      [...ASSETS].sort((a, b) => (a.code < b.code ? -1 : 1)).map((a) => a.class.code),
    );
  });

  it('puts three assets on a roof, six outdoors and 22 inside', () => {
    expect(inPlacement('roof')).toEqual(['AHU-H1', 'CT-01', 'CT-02']);
    expect(inPlacement('outdoor')).toEqual([
      'BAR-01',
      'BAR-02',
      'CH-01',
      'GEN-01',
      'SWG-01',
      'TR-01',
    ]);
    expect(inPlacement('inside')).toHaveLength(22);
  });

  it('stands the cooling towers on the Data Center roof, 14 m up', () => {
    for (const code of ['CT-01', 'CT-02']) {
      expect(byCode(code).placement).toBe('roof');
      expect(byCode(code).pose.y).toBe(14);
    }
  });

  it('stands the generator outdoors, 3 m outside its zone', () => {
    expect(byCode('GEN-01').placement).toBe('outdoor');
    expect(byCode('GEN-01').zoneId).toBe('BLD-DC');
    expect(byCode('GEN-01').pose.y).toBe(0);
  });

  it('puts the leak sensor inside Dormitory B at 8 m', () => {
    expect(byCode('LKS-B3')).toMatchObject({ placement: 'inside', zoneId: 'BLD-DORB' });
    expect(byCode('LKS-B3').pose.y).toBe(8);
  });

  it('sizes each box from its class: width east–west, height up, depth north–south', () => {
    expect(byCode('CT-01').size).toEqual({ x: 4, y: 5, z: 4 });
    expect(byCode('BAR-01').size).toEqual({ x: 4, y: 1.2, z: 0.4 });
    expect(byCode('LKS-B3').size).toEqual({ x: 1.4, y: 1.4, z: 1.4 });
  });

  it('puts north on −z and east on +x', () => {
    const { x, z } = byCode('CT-01').pose;
    expect(x).toBeCloseTo(161, 5);
    expect(z).toBeCloseTo(-48, 5);
    expect(byCode('AHU-H1').pose.x).toBeLessThan(0);
    expect(byCode('AHU-C1').pose.z).toBeGreaterThan(0);
  });

  it('draws the booster pump and the climate sensor on one spot apart, as the 2D map does', () => {
    const pump = byCode('PMP-S1');
    const sensor = byCode('ICS-STU');
    const drawn = fanOutAssets(ASSETS);

    for (const item of [pump, sensor]) {
      const [x, z] = frame.toLocal(drawn.get(item.code)!);
      expect(item.pose.x).toBeCloseTo(x, 9);
      expect(item.pose.z).toBeCloseTo(z, 9);
    }
    const apart = Math.hypot(pump.pose.x - sensor.pose.x, pump.pose.z - sensor.pose.z);
    expect(apart).toBeGreaterThan(3);
    // Both stand at the same catalogue position, so only the fan-out separates them; both are inside.
    expect(ASSETS.find((a) => a.code === 'PMP-S1')!.position).toEqual(
      ASSETS.find((a) => a.code === 'ICS-STU')!.position,
    );
    expect(pump.placement).toBe('inside');
    expect(sensor.placement).toBe('inside');
  });

  it('leaves every other asset where the catalogue has it', () => {
    const drawn = fanOutAssets(ASSETS);
    for (const asset of ASSETS) {
      if (asset.code === 'PMP-S1' || asset.code === 'ICS-STU') continue;
      expect(drawn.get(asset.code)).toEqual(asset.position);
    }
  });
});

describe('assetPose', () => {
  const asset = (headingDeg: number) => ({
    position: CENTER,
    elevationM: 3,
    headingDeg,
  });

  it('puts the box on the centre of its base', () => {
    expect(assetPose(asset(0), frame)).toMatchObject({ x: 0, y: 3, z: 0 });
  });

  it('uses the drawn position when one is given', () => {
    const pose = assetPose(asset(0), frame, offsetM(CENTER, 10, 20));
    expect(pose.x).toBeCloseTo(10, 5);
    expect(pose.z).toBeCloseTo(-20, 5);
  });

  it('turns a model, whose front is +Z (south), to face its heading', () => {
    expect(assetPose(asset(0), frame).rotationY).toBeCloseTo(Math.PI, 12);
    expect(assetPose(asset(90), frame).rotationY).toBeCloseTo(Math.PI / 2, 12);
    expect(assetPose(asset(180), frame).rotationY).toBeCloseTo(0, 12);
    expect(assetPose(asset(270), frame).rotationY).toBeCloseTo(-Math.PI / 2, 12);
  });

  // three.js sends +Z to (sin θ, cos θ); the heading's direction is east = sin h and north = cos h = −z.
  it.each([0, 45, 90, 180, 270, 315])(
    'makes the front point along heading %i° (east, north)',
    (h) => {
      const { rotationY } = assetPose(asset(h), frame);
      const radians = (h * Math.PI) / 180;
      expect(Math.sin(rotationY)).toBeCloseTo(Math.sin(radians), 9);
      expect(-Math.cos(rotationY)).toBeCloseTo(Math.cos(radians), 9);
    },
  );
});

describe('boxOf', () => {
  it('maps width to x, height to y and depth to z', () => {
    expect(boxOf({ width: 6, depth: 2.5, height: 3 })).toEqual({ x: 6, y: 3, z: 2.5 });
  });
});

describe('placementOf', () => {
  const building = (heightM?: number, size: [number, number] = [60, 46]) =>
    zoneAt('B', 'building', [0, 0], size, heightM);
  const at = (east: number, north: number, elevationM: number) => ({
    position: offsetM(CENTER, east, north),
    elevationM,
  });

  it('is inside for a position in the footprint below the roof', () => {
    expect(placementOf(at(0, 0, 0), building(14))).toBe('inside');
    expect(placementOf(at(0, 0, 13.9), building(14))).toBe('inside');
  });

  it('is roof when the base is at the height', () => {
    expect(placementOf(at(0, 0, 14), building(14))).toBe('roof');
  });

  it('is outdoor above the roof', () => {
    expect(placementOf(at(0, 0, 15), building(14))).toBe('outdoor');
  });

  it('is outdoor outside the footprint, inset band included', () => {
    // The zone is 60 × 46 m; the footprint is inset 8 m, so it runs to 22 m east and 15 m north.
    expect(placementOf(at(21, 0, 0), building(14))).toBe('inside');
    expect(placementOf(at(25, 0, 0), building(14))).toBe('outdoor');
    expect(placementOf(at(0, 20, 0), building(14))).toBe('outdoor');
    expect(placementOf(at(40, 0, 0), building(14))).toBe('outdoor');
  });

  it('is outdoor when the zone is not a building, whatever the elevation', () => {
    const utility = zoneAt('U', 'utility', [0, 0], [60, 46]);
    expect(placementOf(at(0, 0, 0), utility)).toBe('outdoor');
    expect(placementOf(at(0, 0, DEFAULT_BUILDING_HEIGHT_M), utility)).toBe('outdoor');
  });

  it('is outdoor when the zone is not in the list', () => {
    expect(placementOf(at(0, 0, 0), undefined)).toBe('outdoor');
  });

  it('is outdoor in a building too small to have a footprint', () => {
    expect(placementOf(at(0, 0, 0), building(14, [14, 14]))).toBe('outdoor');
  });

  it('takes the height the shell is drawn at when the zone has none', () => {
    expect(placementOf(at(0, 0, DEFAULT_BUILDING_HEIGHT_M), building())).toBe('roof');
    expect(placementOf(at(0, 0, DEFAULT_BUILDING_HEIGHT_M - 1), building())).toBe('inside');
    expect(placementOf(at(0, 0, DEFAULT_BUILDING_HEIGHT_M + 1), building())).toBe('outdoor');
  });
});

describe('placeAssets', () => {
  it('gives nothing for no assets', () => {
    expect(placeAssets([], ZONES, frame)).toEqual([]);
  });

  it('puts an asset of an unknown zone outdoors rather than losing it', () => {
    const lost = { ...ASSETS[0]!, zoneId: 'GONE' };
    const [result] = placeAssets([lost], ZONES, frame);
    expect(result).toMatchObject({ code: 'CT-01', placement: 'outdoor', zoneId: 'GONE' });
  });

  it('does not depend on the order it is given', () => {
    expect(placeAssets([...ASSETS].reverse(), ZONES, frame)).toEqual(placed);
  });
});
