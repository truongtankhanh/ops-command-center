import type { LngLat, Zone } from '@occ/contracts';
import { offsetM } from './geo';
import type { FitBox } from './twinCamera';
import {
  buildingBoxes,
  type CameraStep,
  type LevelKey,
  levelCameraStep,
  levelKeyOf,
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

describe('levelKeyOf', () => {
  it('is the level and the building in focus', () => {
    expect(
      levelKeyOf({ focusZoneId: 'dc', selectedAssetCode: 'CT-01', selectedPart: null }),
    ).toEqual({ level: 'asset', focusZoneId: 'dc' });
    expect(levelKeyOf({ focusZoneId: null, selectedAssetCode: null, selectedPart: null })).toEqual({
      level: 'campus',
      focusZoneId: null,
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

  const campus: LevelKey = { level: 'campus', focusZoneId: null };
  const building = (focusZoneId: string): LevelKey => ({ level: 'building', focusZoneId });
  const asset = (focusZoneId: string | null): LevelKey => ({ level: 'asset', focusZoneId });
  const part = (focusZoneId: string | null): LevelKey => ({ level: 'part', focusZoneId });

  const step = (previous: LevelKey | null, next: LevelKey): CameraStep | null =>
    levelCameraStep(previous, next, boxes);

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
    expect(step(asset('dc'), building('dc'))).toEqual({ kind: 'fit', box: dc });
    expect(step(asset(null), campus)).toEqual({ kind: 'home' });
  });

  it('flies home from the asset and the part when Home leaves everything at once', () => {
    expect(step(asset('dc'), campus)).toEqual({ kind: 'home' });
    expect(step(part('dc'), campus)).toEqual({ kind: 'home' });
  });

  it('does not fly for the asset or the part: V2-15.7 fits the asset', () => {
    expect(step(campus, asset(null))).toBeNull();
    expect(step(building('dc'), asset('dc'))).toBeNull();
    expect(step(asset('dc'), part('dc'))).toBeNull();
    expect(step(part('dc'), asset('dc'))).toBeNull();
    expect(step(asset('dc'), asset('lab'))).toBeNull();
  });

  it('does nothing when nothing changed, and for a first reading', () => {
    expect(step(building('dc'), building('dc'))).toBeNull();
    expect(step(campus, campus)).toBeNull();
    expect(step(null, building('dc'))).toBeNull();
    expect(step(null, campus)).toBeNull();
  });

  it('does not fly to a building the console does not hold', () => {
    expect(step(campus, building('gone'))).toBeNull();
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

  it('is nothing at asset and part level (V2-15.7) or for a building the console does not hold', () => {
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
