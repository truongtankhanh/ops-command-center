import {
  boxTable,
  buildingTable,
  CAMERA_HIT_SIZE_PX,
  cameraHits,
  choose,
  createPickStats,
  cursorOf,
  entryAt,
  isClick,
  type PickHit,
  type PickRef,
  type PickScope,
  scopeOf,
  type ScopeState,
  TIE_EPSILON_M,
} from './twinPicking';

const building = (id: string): PickRef => ({ kind: 'building', id });
const asset = (id: string): PickRef => ({ kind: 'asset', id });
const camera = (id: string): PickRef => ({ kind: 'camera', id });
const part = (id: string, assetCode: string): PickRef => ({ kind: 'part', id, assetCode });
const hit = (ref: PickRef, distance: number): PickHit => ({ ref, distance });

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
    layers: { cameras: true },
  };
  const kinds = (scope: PickScope) => [...scope.kinds].sort();

  it('allows buildings, assets and cameras at campus level', () => {
    const scope = scopeOf(base);

    expect(kinds(scope)).toEqual(['asset', 'building', 'camera']);
    expect(scope.assetCode).toBeNull();
  });

  it('leaves cameras out while the Cameras layer is off', () => {
    expect(kinds(scopeOf({ ...base, layers: { cameras: false } }))).toEqual(['asset', 'building']);
  });

  it('keeps every building pickable at building level, so a click moves the focus', () => {
    expect(kinds(scopeOf({ ...base, focusZoneId: 'BLD-DC' }))).toEqual([
      'asset',
      'building',
      'camera',
    ]);
  });

  it('allows only the isolated asset and its parts at asset level', () => {
    const scope = scopeOf({ ...base, focusZoneId: 'BLD-DC', selectedAssetCode: 'CT-01' });

    expect(kinds(scope)).toEqual(['asset', 'part']);
    expect(scope.assetCode).toBe('CT-01');
  });

  it('is the same at part level', () => {
    const scope = scopeOf({ ...base, selectedAssetCode: 'CT-01', selectedPart: 'FanBlade' });

    expect(kinds(scope)).toEqual(['asset', 'part']);
    expect(scope.assetCode).toBe('CT-01');
  });

  it('allows nothing while the report location is picked', () => {
    expect(kinds(scopeOf({ ...base, picking: true }))).toEqual([]);
    expect(kinds(scopeOf({ ...base, picking: true, selectedAssetCode: 'CT-01' }))).toEqual([]);
  });
});

describe('choose', () => {
  const campus: PickScope = {
    kinds: new Set(['building', 'asset', 'camera']),
    assetCode: null,
  };
  const isolated = (assetCode: string): PickScope => ({
    kinds: new Set(['asset', 'part']),
    assetCode,
  });

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
    expect(choose([hit(asset('CT-01'), 10)], { kinds: new Set(), assetCode: null })).toBeNull();
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
