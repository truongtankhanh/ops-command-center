import type { Camera } from '@occ/contracts';
import { type CameraFilter, countCameras, filterCameras } from './cameraFilter';

const cam = (code: string, online: boolean): Camera => ({
  id: code,
  code,
  name: code,
  zoneId: 'zone-a',
  position: [0, 0],
  online,
  fieldOfView: null,
});

const FILTERS: CameraFilter[] = ['all', 'live', 'offline'];

// Offline cameras are in the middle and the codes are not sorted, so an order that is kept can be told from one that is made.
const mixed = [
  cam('C3', true),
  cam('C1', false),
  cam('C4', true),
  cam('C2', false),
  cam('C5', true),
];

describe('countCameras', () => {
  it('counts every camera, those online and the others', () => {
    expect(countCameras(mixed)).toEqual({ all: 5, live: 3, offline: 2 });
  });

  it('counts a list with every camera online', () => {
    expect(countCameras([cam('C1', true), cam('C2', true)])).toEqual({
      all: 2,
      live: 2,
      offline: 0,
    });
  });

  it('counts a list with every camera offline', () => {
    expect(countCameras([cam('C1', false)])).toEqual({ all: 1, live: 0, offline: 1 });
  });

  it('counts nothing for an empty list', () => {
    expect(countCameras([])).toEqual({ all: 0, live: 0, offline: 0 });
  });

  it('always has live and offline add up to all', () => {
    for (const list of [mixed, [], [cam('C1', true)], [cam('C1', false)]]) {
      const { all, live, offline } = countCameras(list);
      expect(live + offline).toBe(all);
    }
  });
});

describe('filterCameras', () => {
  const codes = (list: Camera[]) => list.map((camera) => camera.code);

  it('lists every camera under All, in the order it came in', () => {
    expect(codes(filterCameras(mixed, 'all'))).toEqual(['C3', 'C1', 'C4', 'C2', 'C5']);
  });

  it('lists the cameras that are online under Live, in the order it came in', () => {
    expect(codes(filterCameras(mixed, 'live'))).toEqual(['C3', 'C4', 'C5']);
  });

  it('lists the cameras that are not under Offline, in the order it came in', () => {
    expect(codes(filterCameras(mixed, 'offline'))).toEqual(['C1', 'C2']);
  });

  it('lists nothing for an empty list, whatever the filter', () => {
    for (const filter of FILTERS) expect(filterCameras([], filter)).toEqual([]);
  });

  it('lists nothing when no camera has the state asked for', () => {
    expect(filterCameras([cam('C1', true)], 'offline')).toEqual([]);
    expect(filterCameras([cam('C1', false)], 'live')).toEqual([]);
  });

  it('hands back a copy under All, so a caller that sorts it does not reorder the list it was given', () => {
    const given = [...mixed];

    const all = filterCameras(given, 'all');
    all.sort((a, b) => a.code.localeCompare(b.code));

    expect(codes(given)).toEqual(['C3', 'C1', 'C4', 'C2', 'C5']);
  });

  it.each(FILTERS)('agrees with countCameras under %s', (filter) => {
    for (const list of [mixed, [], [cam('C1', true)], [cam('C1', false)]]) {
      expect(filterCameras(list, filter)).toHaveLength(countCameras(list)[filter]);
    }
  });
});
