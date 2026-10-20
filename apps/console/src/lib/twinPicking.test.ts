import {
  BEACON_HIT_PAD_PX,
  BEACON_TIE_PX,
  beaconHits,
  boxTable,
  buildingTable,
  CAMERA_HIT_SIZE_PX,
  cameraHits,
  choose,
  createPickStats,
  cursorOf,
  entryAt,
  isClick,
  nearestSurface,
  type PickHit,
  type PickRef,
  type PickScope,
  type ProjectedBeacon,
  scopeOf,
  type ScopeState,
  type SurfaceHit,
  TIE_EPSILON_M,
} from './twinPicking';

const building = (id: string): PickRef => ({ kind: 'building', id });
const asset = (id: string): PickRef => ({ kind: 'asset', id });
const camera = (id: string): PickRef => ({ kind: 'camera', id });
const beacon = (id: string): PickRef => ({ kind: 'beacon', id });
const part = (id: string, assetCode: string): PickRef => ({ kind: 'part', id, assetCode });
const hit = (ref: PickRef, distance: number): PickHit => ({ ref, distance });
const beaconHit = (id: string, distance: number, rank: number): PickHit => ({
  ref: beacon(id),
  distance,
  rank,
});

describe('entryAt', () => {
  const table = buildingTable([range('A', 0, 12), range('B', 12, 20), range('C', 32, 12)]);

  function range(zoneId: string, firstTriangle: number, triangleCount: number) {
    return {
      zoneId,
      firstVertex: 0,
      vertexCount: 0,
      firstTriangle,
      triangleCount,
      firstSegment: 0,
      segmentCount: 0,
    };
  }

  it('names the range the triangle is in, at its first, middle and last triangle', () => {
    expect(entryAt(table, 0)).toEqual(building('A'));
    expect(entryAt(table, 11)).toEqual(building('A'));
    expect(entryAt(table, 12)).toEqual(building('B'));
    expect(entryAt(table, 25)).toEqual(building('B'));
    expect(entryAt(table, 31)).toEqual(building('B'));
    expect(entryAt(table, 32)).toEqual(building('C'));
    expect(entryAt(table, 43)).toEqual(building('C'));
  });

  it('is undefined beyond every range and for an empty table', () => {
    expect(entryAt(table, 44)).toBeUndefined();
    expect(entryAt(table, -1)).toBeUndefined();
    expect(entryAt([], 0)).toBeUndefined();
  });

  it('is undefined in a gap between two ranges', () => {
    const gapped = buildingTable([range('A', 0, 10), range('B', 20, 10)]);

    expect(entryAt(gapped, 15)).toBeUndefined();
  });

  it('builds a box table from the boxes, one asset per range', () => {
    const boxes = boxTable([
      {
        code: 'CT-01',
        firstVertex: 0,
        vertexCount: 24,
        firstTriangle: 0,
        triangleCount: 12,
        firstSegment: 0,
        segmentCount: 12,
      },
      {
        code: 'CT-02',
        firstVertex: 24,
        vertexCount: 24,
        firstTriangle: 12,
        triangleCount: 12,
        firstSegment: 12,
        segmentCount: 12,
      },
    ]);

    expect(entryAt(boxes, 5)).toEqual(asset('CT-01'));
    expect(entryAt(boxes, 12)).toEqual(asset('CT-02'));
  });
});

describe('scopeOf', () => {
  const base: ScopeState = {
    focusZoneId: null,
    selectedAssetCode: null,
    selectedPart: null,
    picking: false,
    layers: { cameras: true, incidents: true },
  };
  const kinds = (scope: PickScope) => [...scope.kinds].sort();

  it('allows buildings, assets, cameras and beacons at campus level', () => {
    const scope = scopeOf(base);

    expect(kinds(scope)).toEqual(['asset', 'beacon', 'building', 'camera']);
    expect(scope.assetCode).toBeNull();
  });

  it('leaves cameras out while the Cameras layer is off', () => {
    expect(kinds(scopeOf({ ...base, layers: { cameras: false, incidents: true } }))).toEqual([
      'asset',
      'beacon',
      'building',
    ]);
  });

  it('leaves beacons out while the Incidents layer is off (V2-16.4)', () => {
    expect(kinds(scopeOf({ ...base, layers: { cameras: true, incidents: false } }))).toEqual([
      'asset',
      'building',
      'camera',
    ]);
    expect(
      kinds(
        scopeOf({
          ...base,
          focusZoneId: 'BLD-DC',
          layers: { cameras: true, incidents: false },
        }),
      ),
    ).toEqual(['asset', 'building', 'camera']);
  });

  it('keeps every building pickable at building level, so a click moves the focus', () => {
    expect(kinds(scopeOf({ ...base, focusZoneId: 'BLD-DC' }))).toEqual([
      'asset',
      'beacon',
      'building',
      'camera',
    ]);
  });

  it('allows only the isolated asset and its parts at asset level', () => {
    const scope = scopeOf({ ...base, focusZoneId: 'BLD-DC', selectedAssetCode: 'CT-01' });

    expect(kinds(scope)).toEqual(['asset', 'part']);
    expect(scope.assetCode).toBe('CT-01');
  });

  it('has no beacon at asset or part level, whatever the Incidents layer says (V2-16.1)', () => {
    const isolated = { ...base, selectedAssetCode: 'CT-01' };

    expect(scopeOf(isolated).kinds.has('beacon')).toBe(false);
    expect(scopeOf({ ...isolated, selectedPart: 'FanBlade' }).kinds.has('beacon')).toBe(false);
  });

  it('is the same at part level', () => {
    const scope = scopeOf({ ...base, selectedAssetCode: 'CT-01', selectedPart: 'FanBlade' });

    expect(kinds(scope)).toEqual(['asset', 'part']);
    expect(scope.assetCode).toBe('CT-01');
  });

  // V2-16.7: the 2D map hits nothing but the ground while picking; in 3D the ground is a place, and so are the roofs.
  it('allows only the shells and the ground while the report location is picked', () => {
    expect(kinds(scopeOf({ ...base, picking: true }))).toEqual(['building', 'ground']);
    expect(scopeOf({ ...base, picking: true }).assetCode).toBeNull();
  });

  it('allows no asset, part, camera or beacon while picking, whatever the layers and the selection', () => {
    const picking = scopeOf({
      ...base,
      picking: true,
      selectedAssetCode: 'CT-01',
      selectedPart: 'FanBlade',
      layers: { cameras: true, incidents: true },
    });

    for (const kind of ['asset', 'part', 'camera', 'beacon'] as const) {
      expect(picking.kinds.has(kind)).toBe(false);
    }
  });

  describe('the building in focus (V2-15.8)', () => {
    it('is not a target at building level: its walls are see-through', () => {
      expect(scopeOf({ ...base, focusZoneId: 'BLD-DC' }).excludedBuildingId).toBe('BLD-DC');
    });

    it('excludes nothing at campus level', () => {
      expect(scopeOf(base).excludedBuildingId).toBeNull();
    });

    it('excludes nothing at asset and part level, where only the isolated asset is a target anyway', () => {
      expect(
        scopeOf({ ...base, focusZoneId: 'BLD-DC', selectedAssetCode: 'CT-01' }).excludedBuildingId,
      ).toBeNull();
      expect(
        scopeOf({
          ...base,
          focusZoneId: 'BLD-DC',
          selectedAssetCode: 'CT-01',
          selectedPart: 'FanBlade',
        }).excludedBuildingId,
      ).toBeNull();
    });

    it('is still not a target while a location is picked: a click through it lands on its floor (V2-16.7)', () => {
      expect(scopeOf({ ...base, focusZoneId: 'BLD-DC', picking: true }).excludedBuildingId).toBe(
        'BLD-DC',
      );
    });

    it('excludes nothing while a location is picked at campus level', () => {
      expect(scopeOf({ ...base, picking: true }).excludedBuildingId).toBeNull();
    });
  });
});

describe('nearestSurface (V2-16.7)', () => {
  const picking: PickScope = {
    kinds: new Set(['building', 'ground']),
    assetCode: null,
    excludedBuildingId: null,
  };
  const roof = (distance: number, point: [number, number, number], id = 'BLD-DC'): SurfaceHit => ({
    distance,
    point,
    buildingId: id,
  });
  const floor = (distance: number, point: [number, number, number]): SurfaceHit => ({
    distance,
    point,
    buildingId: null,
  });

  it('is the point of the nearest hit: a roof above the ground behind it', () => {
    expect(nearestSurface([floor(120, [5, 0, 5]), roof(100, [5, 18, 5])], picking)).toEqual([
      5, 18, 5,
    ]);
  });

  it('is the ground where no roof is in the way', () => {
    expect(nearestSurface([floor(120, [40, 0, -10])], picking)).toEqual([40, 0, -10]);
  });

  it('takes a wall as it takes a roof: the nearest crossing', () => {
    expect(
      nearestSurface([roof(90, [0, 6, 3]), roof(95, [0, 18, 3]), floor(130, [0, 0, 3])], picking),
    ).toEqual([0, 6, 3]);
  });

  it('does not depend on the order of the hits', () => {
    const hits = [floor(120, [5, 0, 5]), roof(100, [5, 18, 5]), roof(110, [5, 4, 5], 'OTHER')];

    expect(nearestSurface([...hits].reverse(), picking)).toEqual(nearestSurface(hits, picking));
  });

  it('skips the building the scope does not target and lands on what is behind it', () => {
    const inFocus: PickScope = { ...picking, excludedBuildingId: 'BLD-DC' };

    expect(nearestSurface([roof(100, [5, 18, 5]), floor(112, [5, 0, 5])], inFocus)).toEqual([
      5, 0, 5,
    ]);
  });

  it('still stops at another building while one is in focus', () => {
    const inFocus: PickScope = { ...picking, excludedBuildingId: 'BLD-DC' };

    expect(
      nearestSurface(
        [roof(90, [5, 12, 5], 'BLD-LAB'), roof(100, [5, 18, 5]), floor(112, [5, 0, 5])],
        inFocus,
      ),
    ).toEqual([5, 12, 5]);
  });

  it('is null when nothing is hit, and a copy of the point when something is', () => {
    expect(nearestSurface([], picking)).toBeNull();
    const point: [number, number, number] = [1, 2, 3];

    const found = nearestSurface([floor(10, point)], picking);

    expect(found).toEqual(point);
    expect(found).not.toBe(point);
  });
});

describe('choose', () => {
  const campus: PickScope = {
    kinds: new Set(['building', 'asset', 'camera']),
    assetCode: null,
    excludedBuildingId: null,
  };
  const isolated = (assetCode: string): PickScope => ({
    kinds: new Set(['asset', 'part']),
    assetCode,
    excludedBuildingId: null,
  });
  const inFocus = (excludedBuildingId: string): PickScope => ({ ...campus, excludedBuildingId });

  it('is null for nothing under the pointer', () => {
    expect(choose([], campus)).toBeNull();
  });

  it('is the only hit', () => {
    expect(choose([hit(building('BLD-DC'), 80)], campus)).toEqual(building('BLD-DC'));
  });

  it('takes the nearer of two ray hits, whatever their kind', () => {
    expect(choose([hit(asset('CT-01'), 60), hit(building('BLD-DC'), 40)], campus)).toEqual(
      building('BLD-DC'),
    );
    expect(choose([hit(building('BLD-DC'), 80), hit(asset('CT-01'), 60)], campus)).toEqual(
      asset('CT-01'),
    );
  });

  it('lets the kind decide between hits inside the tolerance', () => {
    const near = TIE_EPSILON_M / 2;

    expect(choose([hit(building('BLD-DC'), 50), hit(asset('CT-01'), 50 + near)], campus)).toEqual(
      asset('CT-01'),
    );
  });

  it('does not let the kind decide between hits beyond the tolerance', () => {
    const apart = TIE_EPSILON_M * 2;

    expect(choose([hit(building('BLD-DC'), 50), hit(asset('CT-01'), 50 + apart)], campus)).toEqual(
      building('BLD-DC'),
    );
  });

  it('is a part while its asset is isolated', () => {
    expect(
      choose([hit(part('FanBlade', 'CT-01'), 12), hit(asset('CT-01'), 12)], isolated('CT-01')),
    ).toEqual(part('FanBlade', 'CT-01'));
  });

  it('reads a part as its asset at campus level', () => {
    expect(choose([hit(part('FanBlade', 'CT-01'), 60)], campus)).toEqual(asset('CT-01'));
  });

  it('drops a part of an asset that is not the isolated one, and the asset with it', () => {
    expect(choose([hit(part('FanBlade', 'CT-02'), 12)], isolated('CT-01'))).toBeNull();
  });

  it('ignores every kind outside the scope, and everything but the isolated asset', () => {
    expect(choose([hit(building('BLD-DC'), 10)], isolated('CT-01'))).toBeNull();
    expect(choose([hit(asset('CT-02'), 10)], isolated('CT-01'))).toBeNull();
    expect(choose([hit(asset('CT-01'), 10)], isolated('CT-01'))).toEqual(asset('CT-01'));
    expect(choose([hit(camera('cam-1'), 5)], isolated('CT-01'))).toBeNull();
    expect(
      choose([hit(asset('CT-01'), 10)], {
        kinds: new Set(),
        assetCode: null,
        excludedBuildingId: null,
      }),
    ).toBeNull();
  });

  it('puts an asset before a camera and a camera before a building under the same pixel', () => {
    expect(choose([hit(camera('cam-1'), 4), hit(asset('CT-01'), 60)], campus)).toEqual(
      asset('CT-01'),
    );
    expect(choose([hit(camera('cam-1'), 4), hit(building('BLD-DC'), 60)], campus)).toEqual(
      camera('cam-1'),
    );
  });

  it('compares a camera with a ray hit by kind and not by distance', () => {
    // The camera's distance is pixels and the building's metres: they must never be compared.
    expect(choose([hit(camera('cam-1'), 900), hit(building('BLD-DC'), 1)], campus)).toEqual(
      camera('cam-1'),
    );
  });

  it('takes the camera nearest the pointer among several', () => {
    expect(choose([hit(camera('far'), 9), hit(camera('near'), 3)], campus)).toEqual(camera('near'));
  });

  describe('beacons (V2-16.4)', () => {
    const withBeacons: PickScope = { ...campus, kinds: new Set([...campus.kinds, 'beacon']) };

    it('wins over a part, an asset, a camera and a building under the same pixel', () => {
      const under = [
        hit(part('FanBlade', 'CT-01'), 1),
        hit(asset('CT-01'), 1),
        hit(camera('cam-1'), 2),
        hit(building('BLD-DC'), 1),
      ];

      expect(choose([beaconHit('inc-1', 9, 1), ...under], withBeacons)).toEqual(beacon('inc-1'));
      expect(choose([...under, beaconHit('inc-1', 900, 1)], withBeacons)).toEqual(beacon('inc-1'));
    });

    it('takes the beacon nearest the pointer among several', () => {
      expect(choose([beaconHit('far', 9, 8), beaconHit('near', 3, 1)], withBeacons)).toEqual(
        beacon('near'),
      );
    });

    it('breaks a tie within the tolerance for the beacon painted on top', () => {
      expect(
        choose([beaconHit('low', 3, 1), beaconHit('critical', 3 + BEACON_TIE_PX, 7)], withBeacons),
      ).toEqual(beacon('critical'));
      expect(choose([beaconHit('critical', 3, 7), beaconHit('low', 3, 1)], withBeacons)).toEqual(
        beacon('critical'),
      );
    });

    it('does not break a tie for the rank beyond the tolerance: the nearer wins', () => {
      expect(
        choose(
          [beaconHit('low', 3, 1), beaconHit('critical', 3 + BEACON_TIE_PX + 0.5, 7)],
          withBeacons,
        ),
      ).toEqual(beacon('low'));
    });

    it('takes the nearer of two beacons of one rank inside the tolerance', () => {
      expect(choose([beaconHit('b', 3.5, 4), beaconHit('a', 3, 4)], withBeacons)).toEqual(
        beacon('a'),
      );
    });

    it('is dropped when the scope has no beacon, and when an asset is isolated', () => {
      expect(choose([beaconHit('inc-1', 2, 1), hit(asset('CT-01'), 1)], campus)).toEqual(
        asset('CT-01'),
      );
      expect(choose([beaconHit('inc-1', 2, 1)], isolated('CT-01'))).toBeNull();
    });

    it('is the only target when nothing else is under the pointer', () => {
      expect(choose([beaconHit('inc-1', 2, 1)], withBeacons)).toEqual(beacon('inc-1'));
    });
  });

  describe('with a building in focus (V2-15.8)', () => {
    it('goes through its see-through wall to the asset behind it', () => {
      expect(
        choose([hit(building('BLD-DC'), 40), hit(asset('UPS-01'), 55)], inFocus('BLD-DC')),
      ).toEqual(asset('UPS-01'));
    });

    it('hits nothing where only its wall is under the pointer', () => {
      expect(choose([hit(building('BLD-DC'), 40)], inFocus('BLD-DC'))).toBeNull();
    });

    it('still hits another building, so a click on a faded one moves the focus', () => {
      expect(choose([hit(building('BLD-LAB'), 40)], inFocus('BLD-DC'))).toEqual(
        building('BLD-LAB'),
      );
    });

    it('still hits a faded asset of another building', () => {
      expect(choose([hit(asset('AHU-H1'), 40)], inFocus('BLD-DC'))).toEqual(asset('AHU-H1'));
    });

    it('does not let a wall behind the asset change anything', () => {
      expect(
        choose([hit(asset('UPS-01'), 40), hit(building('BLD-DC'), 55)], inFocus('BLD-DC')),
      ).toEqual(asset('UPS-01'));
    });
  });
});

describe('cameraHits', () => {
  const markers = [
    { id: 'cam-1', x: 100, y: 200 },
    { id: 'cam-2', x: 300, y: 200 },
  ];

  it('hits the marker whose target holds the point', () => {
    const [found, ...rest] = cameraHits({ x: 100, y: 190 }, markers);

    expect(rest).toEqual([]);
    expect(found?.ref).toEqual(camera('cam-1'));
    expect(found?.distance).toBeCloseTo(10);
  });

  it('stands the target on the anchor, from the foot up to the minimum size', () => {
    const top = 200 - CAMERA_HIT_SIZE_PX;

    expect(cameraHits({ x: 100, y: 200 }, markers)).toHaveLength(1);
    expect(cameraHits({ x: 100, y: top }, markers)).toHaveLength(1);
    expect(cameraHits({ x: 100, y: top - 1 }, markers)).toEqual([]);
    expect(cameraHits({ x: 100, y: 201 }, markers)).toEqual([]);
  });

  it('is centred on the anchor and as wide as the minimum size', () => {
    const half = CAMERA_HIT_SIZE_PX / 2;

    expect(cameraHits({ x: 100 - half, y: 190 }, markers)).toHaveLength(1);
    expect(cameraHits({ x: 100 + half, y: 190 }, markers)).toHaveLength(1);
    expect(cameraHits({ x: 100 + half + 1, y: 190 }, markers)).toEqual([]);
  });

  it('is empty away from every marker and for no marker', () => {
    expect(cameraHits({ x: 0, y: 0 }, markers)).toEqual([]);
    expect(cameraHits({ x: 100, y: 190 }, [])).toEqual([]);
  });

  it('hits two overlapping markers, each with its own distance', () => {
    const overlapping = [
      { id: 'a', x: 100, y: 200 },
      { id: 'b', x: 106, y: 200 },
    ];

    const hits = cameraHits({ x: 104, y: 195 }, overlapping);

    expect(hits.map((found) => found.ref)).toEqual([camera('a'), camera('b')]);
    expect(hits[1]!.distance).toBeLessThan(hits[0]!.distance);
  });
});

describe('beaconHits', () => {
  const disc = (id: string, x: number, y: number, radius = 10, rank = 1): ProjectedBeacon => ({
    id,
    x,
    y,
    radius,
    rank,
  });

  it('hits the beacon whose disc, grown by the pad, holds the point', () => {
    const [found, ...rest] = beaconHits({ x: 100, y: 190 }, [disc('inc-1', 100, 200)]);

    expect(rest).toEqual([]);
    expect(found?.ref).toEqual(beacon('inc-1'));
    expect(found?.distance).toBeCloseTo(10);
  });

  it('reaches radius + the pad from the centre in every direction, and no further', () => {
    const reach = 10 + BEACON_HIT_PAD_PX;
    const beacons = [disc('inc-1', 100, 200)];

    expect(beaconHits({ x: 100 + reach, y: 200 }, beacons)).toHaveLength(1);
    expect(beaconHits({ x: 100 - reach, y: 200 }, beacons)).toHaveLength(1);
    expect(beaconHits({ x: 100, y: 200 - reach }, beacons)).toHaveLength(1);
    expect(beaconHits({ x: 100, y: 200 + reach }, beacons)).toHaveLength(1);
    expect(beaconHits({ x: 100 + reach + 0.5, y: 200 }, beacons)).toEqual([]);
    // A diagonal point at the same Chebyshev distance is outside the circle.
    expect(beaconHits({ x: 100 + reach, y: 200 + reach }, beacons)).toEqual([]);
  });

  it('is a target of at least 24 px across, for the smallest disc', () => {
    expect(2 * (10 + BEACON_HIT_PAD_PX)).toBeGreaterThanOrEqual(24);
  });

  it('uses the radius of each disc', () => {
    const beacons = [disc('small', 100, 200, 10), disc('big', 300, 200, 12)];

    expect(beaconHits({ x: 100 + 14, y: 200 }, beacons).map(({ ref }) => ref)).toEqual([
      beacon('small'),
    ]);
    expect(beaconHits({ x: 300 + 16, y: 200 }, beacons).map(({ ref }) => ref)).toEqual([
      beacon('big'),
    ]);
    expect(beaconHits({ x: 300 + 17, y: 200 }, beacons)).toEqual([]);
  });

  it('does not hit at the foot of the stem: the target is on the disc, whose centre the caller gives', () => {
    // The caller passes the disc's centre; a point 28 px below it (the foot) is far outside.
    expect(beaconHits({ x: 100, y: 228 }, [disc('inc-1', 100, 200)])).toEqual([]);
  });

  it('carries each hit’s distance and rank, and hits overlapping discs both', () => {
    const hits = beaconHits({ x: 104, y: 200 }, [
      disc('a', 100, 200, 10, 3),
      disc('b', 106, 200, 10, 5),
    ]);

    expect(hits.map(({ ref, rank }) => [ref, rank])).toEqual([
      [beacon('a'), 3],
      [beacon('b'), 5],
    ]);
    expect(hits[1]!.distance).toBeLessThan(hits[0]!.distance);
  });

  it('is empty away from every beacon and for no beacon', () => {
    expect(beaconHits({ x: 0, y: 0 }, [disc('inc-1', 100, 200)])).toEqual([]);
    expect(beaconHits({ x: 100, y: 200 }, [])).toEqual([]);
  });
});

describe('createPickStats', () => {
  it('reports the count, the mean and the maximum once the window has passed, then starts again', () => {
    const report = vi.fn();
    const stats = createPickStats(report);

    stats.record(0.2, 0);
    stats.record(0.6, 400);
    expect(report).not.toHaveBeenCalled();
    stats.record(0.4, 1000);

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenLastCalledWith({ count: 3, meanMs: expect.closeTo(0.4), maxMs: 0.6 });

    stats.record(0.1, 1200);
    stats.record(0.3, 2200);
    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenLastCalledWith({ count: 2, meanMs: expect.closeTo(0.2), maxMs: 0.3 });
  });

  it('measures a window from its first pick, not from when it was made', () => {
    const report = vi.fn();
    const stats = createPickStats(report, 500);

    stats.record(1, 10_000);
    stats.record(1, 10_400);
    expect(report).not.toHaveBeenCalled();
    stats.record(1, 10_500);

    expect(report).toHaveBeenCalledTimes(1);
  });
});

describe('isClick', () => {
  const down = { x: 100, y: 100 };

  it('is a click when the press has not moved, or moved 2 px', () => {
    expect(isClick(down, { x: 100, y: 100 })).toBe(true);
    expect(isClick(down, { x: 102, y: 100 })).toBe(true);
    expect(isClick(down, { x: 100, y: 98 })).toBe(true);
  });

  it('is a click at exactly the slop, and along a diagonal inside it', () => {
    expect(isClick(down, { x: 103, y: 100 })).toBe(true);
    expect(isClick(down, { x: 102, y: 102 })).toBe(true);
  });

  it('is a drag at 4 px, and along a diagonal outside the slop', () => {
    expect(isClick(down, { x: 104, y: 100 })).toBe(false);
    expect(isClick(down, { x: 97, y: 97 })).toBe(false);
  });
});

describe('cursorOf', () => {
  const idle = { picking: false, dragging: false, overTarget: false };

  it('is grab over nothing, pointer over a target, grabbing while dragging, crosshair while picking', () => {
    expect(cursorOf(idle)).toBe('grab');
    expect(cursorOf({ ...idle, overTarget: true })).toBe('pointer');
    expect(cursorOf({ ...idle, dragging: true })).toBe('grabbing');
    expect(cursorOf({ ...idle, picking: true })).toBe('crosshair');
  });

  it('puts picking before dragging, and dragging before a target', () => {
    expect(cursorOf({ picking: true, dragging: true, overTarget: true })).toBe('crosshair');
    expect(cursorOf({ picking: false, dragging: true, overTarget: true })).toBe('grabbing');
  });
});
