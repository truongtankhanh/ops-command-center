import type { LngLat, Zone } from '@occ/contracts';
import { offsetM } from '../map/geo';
import type { FitBox } from './twinCamera';
import type { PlacedAsset } from './twinPlacement';
import {
  assetBoxes,
  buildingBoxes,
  type CameraStep,
  type LevelKey,
  levelCameraStep,
  levelKeyOf,
  startAssetBoxOf,
  startBoxOf,
} from './twinLevelCamera';
import { DEFAULT_BUILDING_HEIGHT_M, makeFrame } from './twinScene';

const ANCHOR: LngLat = [108.4415, 11.953];
const frame = makeFrame(ANCHOR);

const at = (east: number, north: number): LngLat => offsetM(ANCHOR, east, north);

/** A closed ring around a box given in metres from the anchor, counter-clockwise on the map. */
const box = (west: number, east: number, south: number, north: number): LngLat[] => [
  at(west, south),
  at(east, south),
  at(east, north),
  at(west, north),
  at(west, south),
];

const zone = (
  id: string,
  kind: Zone['kind'],
  polygon: LngLat[],
  heightM?: number | null,
): Zone => ({
  id,
  code: id.toUpperCase(),
  name: id,
  kind,
  polygon,
  center: polygon[0]!,
  ...(heightM === undefined ? {} : { heightM }),
});

describe('buildingBoxes', () => {
  it('is the footprint of a shell and the height it is drawn at', () => {
    // A zone of 0 … 60 m is inset by 8 m on every side: its shell runs 8 … 52 m.
    const boxes = buildingBoxes([zone('dc', 'building', box(0, 60, 0, 60), 24)], frame);

    const { bounds, heightM } = boxes.get('dc')!;
    expect(heightM).toBe(24);
    expect(bounds.minX).toBeCloseTo(8, 1);
    expect(bounds.maxX).toBeCloseTo(52, 1);
    // North is −z: 8 … 52 m north is −52 … −8.
    expect(bounds.minZ).toBeCloseTo(-52, 1);
    expect(bounds.maxZ).toBeCloseTo(-8, 1);
  });

  it('draws a building with no height at the default one', () => {
    const boxes = buildingBoxes([zone('dc', 'building', box(0, 60, 0, 60))], frame);

    expect(boxes.get('dc')!.heightM).toBe(DEFAULT_BUILDING_HEIGHT_M);
  });

  it('falls back to the zone’s own polygon for a building too small to have a shell', () => {
    // 10 m is under twice the 8 m inset: no shell, but the zone can be focused.
    const boxes = buildingBoxes([zone('kiosk', 'building', box(0, 10, 0, 10), 4)], frame);

    const { bounds, heightM } = boxes.get('kiosk')!;
    expect(heightM).toBe(4);
    expect(bounds.minX).toBeCloseTo(0, 1);
    expect(bounds.maxX).toBeCloseTo(10, 1);
  });

  it('has none for a zone that is not a building', () => {
    const boxes = buildingBoxes(
      [zone('lawn', 'outdoor', box(0, 60, 0, 60)), zone('plant', 'utility', box(70, 130, 0, 60))],
      frame,
    );

    expect(boxes.size).toBe(0);
  });

  it('has none for a building with no polygon', () => {
    expect(buildingBoxes([zone('ghost', 'building', [])], frame).size).toBe(0);
  });

  it('has a box for every building', () => {
    const boxes = buildingBoxes(
      [
        zone('a', 'building', box(0, 60, 0, 60), 12),
        zone('b', 'building', box(100, 160, 0, 60), 20),
      ],
      frame,
    );

    expect([...boxes.keys()].sort()).toEqual(['a', 'b']);
  });
});

describe('assetBoxes (V2-15.7)', () => {
  const placed = (
    code: string,
    pose: Partial<PlacedAsset['pose']>,
    size: PlacedAsset['size'],
  ): PlacedAsset => ({
    code,
    classCode: 'CLS',
    zoneId: 'dc',
    placement: 'outdoor',
    pose: { x: 0, y: 0, z: 0, rotationY: 0, ...pose },
    size,
  });

  it('is the footprint around the pose, the height it stands and the elevation of its base', () => {
    const boxes = assetBoxes([placed('CT-01', { x: 100, y: 24, z: -50 }, { x: 6, y: 8, z: 4 })]);

    expect(boxes.get('CT-01')).toEqual({
      bounds: { minX: 97, maxX: 103, minZ: -52, maxZ: -48 },
      heightM: 8,
      baseM: 24,
    });
  });

  it('swaps the extents for a quarter turn, whichever way it is turned', () => {
    for (const rotationY of [Math.PI / 2, -Math.PI / 2, (3 * Math.PI) / 2]) {
      const { bounds } = assetBoxes([placed('A', { rotationY }, { x: 6, y: 2, z: 2 })]).get('A')!;

      expect(bounds.maxX - bounds.minX).toBeCloseTo(2, 6);
      expect(bounds.maxZ - bounds.minZ).toBeCloseTo(6, 6);
    }
  });

  it('is the box turned half a turn, which is the heading of a north-facing model', () => {
    const { bounds } = assetBoxes([placed('A', { rotationY: Math.PI }, { x: 6, y: 2, z: 2 })]).get(
      'A',
    )!;

    expect(bounds.maxX - bounds.minX).toBeCloseTo(6, 6);
    expect(bounds.maxZ - bounds.minZ).toBeCloseTo(2, 6);
  });

  it('contains the whole footprint for a turn between', () => {
    const { bounds } = assetBoxes([
      placed('A', { rotationY: Math.PI / 4 }, { x: 4, y: 2, z: 4 }),
    ]).get('A')!;

    // A 4 × 4 square turned 45° spans 4·√2 on each axis.
    expect(bounds.maxX - bounds.minX).toBeCloseTo(4 * Math.SQRT2, 6);
    expect(bounds.maxZ - bounds.minZ).toBeCloseTo(4 * Math.SQRT2, 6);
  });

  it('has a box for every asset, by code, and none for an empty list', () => {
    const boxes = assetBoxes([
      placed('A', {}, { x: 1, y: 1, z: 1 }),
      placed('B', {}, { x: 1, y: 1, z: 1 }),
    ]);

    expect([...boxes.keys()]).toEqual(['A', 'B']);
    expect(assetBoxes([]).size).toBe(0);
  });
});

describe('levelKeyOf', () => {
  it('is the level, the building in focus and the asset isolated', () => {
    expect(
      levelKeyOf({ focusZoneId: 'dc', selectedAssetCode: 'CT-01', selectedPart: null }),
    ).toEqual({ level: 'asset', focusZoneId: 'dc', assetCode: 'CT-01' });
    expect(levelKeyOf({ focusZoneId: null, selectedAssetCode: null, selectedPart: null })).toEqual({
      level: 'campus',
      focusZoneId: null,
      assetCode: null,
    });
  });
});

describe('levelCameraStep', () => {
  const dc: FitBox = { bounds: { minX: 0, maxX: 40, minZ: 0, maxZ: 40 }, heightM: 24 };
  const lab: FitBox = { bounds: { minX: 100, maxX: 140, minZ: 0, maxZ: 40 }, heightM: 16 };
  const boxes = new Map([
    ['dc', dc],
    ['lab', lab],
  ]);
  const tower: FitBox = { bounds: { minX: 5, maxX: 11, minZ: 5, maxZ: 11 }, heightM: 8, baseM: 24 };
  const gen: FitBox = { bounds: { minX: 45, maxX: 50, minZ: 5, maxZ: 9 }, heightM: 3, baseM: 0 };
  const sensor: FitBox = { bounds: { minX: 130, maxX: 131, minZ: 5, maxZ: 6 }, heightM: 1 };
  const assets = new Map([
    ['CT-01', tower],
    ['GEN-01', gen],
    ['LKS-B3', sensor],
  ]);

  const campus: LevelKey = { level: 'campus', focusZoneId: null, assetCode: null };
  const building = (focusZoneId: string): LevelKey => ({
    level: 'building',
    focusZoneId,
    assetCode: null,
  });
  const asset = (focusZoneId: string | null, assetCode: string): LevelKey => ({
    level: 'asset',
    focusZoneId,
    assetCode,
  });
  const part = (focusZoneId: string | null, assetCode: string): LevelKey => ({
    level: 'part',
    focusZoneId,
    assetCode,
  });

  const step = (previous: LevelKey | null, next: LevelKey): CameraStep | null =>
    levelCameraStep(previous, next, boxes, assets);

  it('flies in to a building that is clicked', () => {
    expect(step(campus, building('dc'))).toEqual({ kind: 'fit', box: dc });
  });

  it('flies to another building when the focus moves to it', () => {
    expect(step(building('dc'), building('lab'))).toEqual({ kind: 'fit', box: lab });
  });

  it('flies home when the building is left', () => {
    expect(step(building('dc'), campus)).toEqual({ kind: 'home' });
  });

  it('flies back to the building when the asset is left, and home when it had no building', () => {
    expect(step(asset('dc', 'CT-01'), building('dc'))).toEqual({ kind: 'fit', box: dc });
    expect(step(asset(null, 'TR-01'), campus)).toEqual({ kind: 'home' });
  });

  it('flies home from the asset and the part when Home leaves everything at once', () => {
    expect(step(asset('dc', 'CT-01'), campus)).toEqual({ kind: 'home' });
    expect(step(part('dc', 'CT-01'), campus)).toEqual({ kind: 'home' });
  });

  describe('the asset (V2-15.7)', () => {
    it('flies to the asset that is selected, from the campus and from a building', () => {
      expect(step(campus, asset('dc', 'CT-01'))).toEqual({ kind: 'fit-asset', box: tower });
      expect(step(building('dc'), asset('dc', 'CT-01'))).toEqual({
        kind: 'fit-asset',
        box: tower,
      });
    });

    it('flies to the second asset when another one is selected: two quick selections end at the second', () => {
      expect(step(asset('dc', 'CT-01'), asset('dc', 'GEN-01'))).toEqual({
        kind: 'fit-asset',
        box: gen,
      });
    });

    it('flies once, to the asset, when the other asset is in another building', () => {
      expect(step(asset('dc', 'CT-01'), asset('lab', 'LKS-B3'))).toEqual({
        kind: 'fit-asset',
        box: sensor,
      });
    });

    it('flies to an asset in no building', () => {
      expect(step(campus, asset(null, 'GEN-01'))).toEqual({ kind: 'fit-asset', box: gen });
    });

    it('does not move for a part of the same asset, selected or left', () => {
      expect(step(asset('dc', 'CT-01'), part('dc', 'CT-01'))).toBeNull();
      expect(step(part('dc', 'CT-01'), asset('dc', 'CT-01'))).toBeNull();
    });

    it('does not fly to an asset the console has no box for', () => {
      expect(step(campus, asset('dc', 'GONE'))).toBeNull();
    });
  });

  it('does nothing when nothing changed, and for a first reading', () => {
    expect(step(building('dc'), building('dc'))).toBeNull();
    expect(step(campus, campus)).toBeNull();
    expect(step(asset('dc', 'CT-01'), asset('dc', 'CT-01'))).toBeNull();
    expect(step(null, building('dc'))).toBeNull();
    expect(step(null, campus)).toBeNull();
    expect(step(null, asset('dc', 'CT-01'))).toBeNull();
  });

  it('does not fly to a building the console does not hold', () => {
    expect(step(campus, building('gone'))).toBeNull();
  });
});

describe('startAssetBoxOf (V2-15.7)', () => {
  const tower: FitBox = { bounds: { minX: 5, maxX: 11, minZ: 5, maxZ: 11 }, heightM: 8, baseM: 24 };
  const assets = new Map([['CT-01', tower]]);

  it('is the isolated asset’s box at asset and part level', () => {
    expect(
      startAssetBoxOf(
        { focusZoneId: 'dc', selectedAssetCode: 'CT-01', selectedPart: null },
        assets,
      ),
    ).toBe(tower);
    expect(
      startAssetBoxOf(
        { focusZoneId: 'dc', selectedAssetCode: 'CT-01', selectedPart: 'Fan' },
        assets,
      ),
    ).toBe(tower);
  });

  it('is nothing at campus and building level, or for an asset the console does not hold', () => {
    expect(
      startAssetBoxOf({ focusZoneId: null, selectedAssetCode: null, selectedPart: null }, assets),
    ).toBeNull();
    expect(
      startAssetBoxOf({ focusZoneId: 'dc', selectedAssetCode: null, selectedPart: null }, assets),
    ).toBeNull();
    expect(
      startAssetBoxOf({ focusZoneId: 'dc', selectedAssetCode: 'GONE', selectedPart: null }, assets),
    ).toBeNull();
  });
});

describe('startBoxOf', () => {
  const dc: FitBox = { bounds: { minX: 0, maxX: 40, minZ: 0, maxZ: 40 }, heightM: 24 };
  const boxes = new Map([['dc', dc]]);

  it('is the building’s box at building level', () => {
    expect(
      startBoxOf({ focusZoneId: 'dc', selectedAssetCode: null, selectedPart: null }, boxes),
    ).toBe(dc);
  });

  it('is nothing at campus level, so the first view is the home view', () => {
    expect(
      startBoxOf({ focusZoneId: null, selectedAssetCode: null, selectedPart: null }, boxes),
    ).toBeNull();
  });

  it('is nothing at asset and part level (`startAssetBoxOf`) or for a building the console does not hold', () => {
    expect(
      startBoxOf({ focusZoneId: 'dc', selectedAssetCode: 'CT-01', selectedPart: null }, boxes),
    ).toBeNull();
    expect(
      startBoxOf({ focusZoneId: 'dc', selectedAssetCode: 'CT-01', selectedPart: 'Fan' }, boxes),
    ).toBeNull();
    expect(
      startBoxOf({ focusZoneId: 'gone', selectedAssetCode: null, selectedPart: null }, boxes),
    ).toBeNull();
  });
});
