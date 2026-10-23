import type { LngLat, Zone } from '@occ/contracts';
import { offsetM } from './map/geo';
import { PIN_BELOW_TIP_PX, PIN_SIZE_PX, pinHits, pinScenePosition } from './twinPin';
import { makeFrame } from './twinScene';

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

const zone = (id: string, kind: Zone['kind'], polygon: LngLat[], heightM?: number): Zone => ({
  id,
  code: id.toUpperCase(),
  name: id,
  kind,
  polygon,
  center: polygon[0]!,
  ...(heightM === undefined ? {} : { heightM }),
});

const DORM = zone('dorm', 'building', box(0, 40, 0, 20), 18);
const LAWN = zone('lawn', 'outdoor', box(60, 120, 0, 40));
const ZONES = [DORM, LAWN];

describe('pinScenePosition', () => {
  it('stands a pin inside a building’s footprint on its roof', () => {
    const [x, y, z] = pinScenePosition(at(20, 10), ZONES, frame, null);

    expect(y).toBe(18);
    expect(x).toBeCloseTo(20, 1);
    // `z` is minus north.
    expect(z).toBeCloseTo(-10, 1);
  });

  it('stands a pin on open ground, or in a zone that is not a building, at 0', () => {
    expect(pinScenePosition(at(80, 20), ZONES, frame, null)[1]).toBe(0);
    expect(pinScenePosition(at(200, 200), ZONES, frame, null)[1]).toBe(0);
  });

  it('stands a pin between a building’s zone edge and its footprint on the ground', () => {
    // The footprint is the zone inset; a point a hair inside the zone is outside the footprint.
    expect(pinScenePosition(at(0.2, 10), ZONES, frame, null)[1]).toBe(0);
  });

  it('stands a pin inside the building in focus on its floor: its roof is not drawn', () => {
    expect(pinScenePosition(at(20, 10), ZONES, frame, 'dorm')[1]).toBe(0);
  });

  it('keeps the roof of a building that is not the one in focus', () => {
    expect(pinScenePosition(at(20, 10), ZONES, frame, 'another')[1]).toBe(18);
  });

  it('uses the shell’s default height for a building with none', () => {
    const plain = zone('plain', 'building', box(0, 40, 0, 20));

    expect(pinScenePosition(at(20, 10), [plain], frame, null)[1]).toBeGreaterThan(0);
  });

  it('is on the ground with no zones', () => {
    expect(pinScenePosition(at(20, 10), [], frame, null)[1]).toBe(0);
  });
});

describe('pinHits', () => {
  const tip = { x: 300, y: 200 };

  it('holds the points on the sprite, standing on its tip', () => {
    expect(pinHits({ x: 300, y: 200 }, tip)).toBe(true);
    expect(pinHits({ x: 300, y: 200 - 20 }, tip)).toBe(true);
    expect(pinHits({ x: 300, y: 200 - (PIN_SIZE_PX.height - PIN_BELOW_TIP_PX) }, tip)).toBe(true);
  });

  it('includes the shadow under the tip and no more', () => {
    expect(pinHits({ x: 300, y: 200 + PIN_BELOW_TIP_PX }, tip)).toBe(true);
    expect(pinHits({ x: 300, y: 200 + PIN_BELOW_TIP_PX + 1 }, tip)).toBe(false);
  });

  it('stops above the sprite', () => {
    expect(pinHits({ x: 300, y: 200 - (PIN_SIZE_PX.height - PIN_BELOW_TIP_PX) - 1 }, tip)).toBe(
      false,
    );
  });

  it('is as wide as the sprite, centred on the tip', () => {
    const half = PIN_SIZE_PX.width / 2;

    expect(pinHits({ x: 300 + half, y: 190 }, tip)).toBe(true);
    expect(pinHits({ x: 300 - half, y: 190 }, tip)).toBe(true);
    expect(pinHits({ x: 300 + half + 1, y: 190 }, tip)).toBe(false);
    expect(pinHits({ x: 300 - half - 1, y: 190 }, tip)).toBe(false);
  });

  it('is at least the 24 px of WCAG 2.5.8 across', () => {
    expect(PIN_SIZE_PX.width).toBeGreaterThanOrEqual(24);
    expect(PIN_SIZE_PX.height).toBeGreaterThanOrEqual(24);
  });

  it('never hits a pin that is not on the screen', () => {
    expect(pinHits({ x: 300, y: 190 }, null)).toBe(false);
  });
});
