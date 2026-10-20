import type { LngLat, Zone } from '@occ/contracts';
import { useConsole } from '../store';
import { resetStore } from '../test-utils';
import { placePinAt } from './reportPin';

const square = (west: number, south: number, size: number): LngLat[] => [
  [west, south],
  [west + size, south],
  [west + size, south + size],
  [west, south + size],
  [west, south],
];

const zone = (id: string, polygon: LngLat[]): Zone => ({
  id,
  code: id.toUpperCase(),
  name: id,
  kind: 'building',
  polygon,
  center: polygon[0]!,
});

const DORM_B = zone('dorm-b', square(108.44, 11.95, 0.001));
const LAKE = zone('lake', square(108.442, 11.95, 0.001));
const ZONES = [DORM_B, LAKE];

const state = () => useConsole.getState();

describe('placePinAt', () => {
  beforeEach(() => resetStore(useConsole));

  it('places the pin inside a zone, selects that zone and says so', () => {
    const placed = placePinAt([108.4405, 11.9505], ZONES);

    expect(placed).toBe(true);
    expect(state()).toMatchObject({
      reportPosition: [108.4405, 11.9505],
      reportZoneId: 'dorm-b',
      pinMissed: false,
    });
  });

  it('moves the pin to another zone and takes that zone', () => {
    placePinAt([108.4405, 11.9505], ZONES);

    placePinAt([108.4425, 11.9505], ZONES);

    expect(state()).toMatchObject({ reportPosition: [108.4425, 11.9505], reportZoneId: 'lake' });
  });

  it('reports a miss outside every zone and keeps the pin where it was', () => {
    placePinAt([108.4405, 11.9505], ZONES);

    const placed = placePinAt([108.5, 11.8], ZONES);

    expect(placed).toBe(false);
    expect(state()).toMatchObject({
      reportPosition: [108.4405, 11.9505],
      reportZoneId: 'dorm-b',
      pinMissed: true,
    });
  });

  it('clears an earlier miss when the next click lands in a zone', () => {
    placePinAt([108.5, 11.8], ZONES);
    expect(state().pinMissed).toBe(true);

    placePinAt([108.4405, 11.9505], ZONES);

    expect(state().pinMissed).toBe(false);
  });

  it('is a miss while the zones are not known', () => {
    expect(placePinAt([108.4405, 11.9505], undefined)).toBe(false);
    expect(state()).toMatchObject({ reportPosition: null, pinMissed: true });
  });

  it('counts a point on a zone’s edge as inside, as the API does', () => {
    expect(placePinAt([108.44, 11.9505], ZONES)).toBe(true);
    expect(state().reportZoneId).toBe('dorm-b');
  });
});
