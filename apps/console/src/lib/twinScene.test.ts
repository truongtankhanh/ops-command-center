import type { LngLat, SitePlan, Zone } from '@occ/contracts';
import { offsetM } from './geo';
import { siteFeatures } from './sitePlan';
import {
  type Bounds,
  buildingShells,
  DEFAULT_BUILDING_HEIGHT_M,
  flatZones,
  interimView,
  type Local,
  makeFrame,
  PAN_MARGIN_M,
  panBounds,
  sceneBounds,
  sceneFrame,
  signedAreaM2,
  siteLines,
} from './twinScene';

const ANCHOR: LngLat = [108.4415, 11.953];
const frame = makeFrame(ANCHOR);

/** A point `east` / `north` metres from the anchor, as the seed builds its zones. */
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

const plan = (features: SitePlan['features']): SitePlan => ({
  id: 's1',
  code: 'LANGBIANG',
  name: 'Langbiang Tech Campus',
  center: ANCHOR,
  features,
});

const BOUNDARY = box(-100, 100, -100, 100);
const SITE = plan([
  { part: 'boundary', geometry: { type: 'Polygon', coordinates: [BOUNDARY] } },
  { part: 'road', geometry: { type: 'LineString', coordinates: [at(0, -100), at(0, 100)] } },
]);

/** The extent of a ring in metres. */
function extentOf(ring: readonly Local[]): Bounds {
  const xs = ring.map(([x]) => x);
  const zs = ring.map(([, z]) => z);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

/** Within 5 cm: the seed rounds its corners to 1e-7° (about 1 cm). */
function expectExtent(ring: readonly Local[], expected: Bounds) {
  const extent = extentOf(ring);
  expect(extent.minX).toBeCloseTo(expected.minX, 1);
  expect(extent.maxX).toBeCloseTo(expected.maxX, 1);
  expect(extent.minZ).toBeCloseTo(expected.minZ, 1);
  expect(extent.maxZ).toBeCloseTo(expected.maxZ, 1);
}

describe('makeFrame', () => {
  it('puts the centre exactly at the origin', () => {
    expect(frame.toLocal(ANCHOR)).toEqual([0, 0]);
    expect(frame.fromLocal(0, 0)).toEqual(ANCHOR);
  });

  it('reads east as +x and north as −z, in metres', () => {
    const [x, z] = frame.toLocal(at(250, 100));

    expect(x).toBeCloseTo(250, 2);
    expect(z).toBeCloseTo(-100, 2);
    expect(frame.toLocal(at(-30, -40))[0]).toBeCloseTo(-30, 2);
    expect(frame.toLocal(at(-30, -40))[1]).toBeCloseTo(40, 2);
  });

  it('is the exact inverse of itself over the campus', () => {
    for (const east of [-300, -120, 0, 75, 300]) {
      for (const north of [-300, -40, 0, 210, 300]) {
        const point = at(east, north);
        const back = frame.fromLocal(...frame.toLocal(point));

        // 1e-8° is about a millimetre: well inside the 1 cm the scene needs.
        expect(back[0]).toBeCloseTo(point[0], 8);
        expect(back[1]).toBeCloseTo(point[1], 8);
      }
    }
  });
});

describe('signedAreaM2', () => {
  const square: Local[] = [
    [-1, 1],
    [1, 1],
    [1, -1],
    [-1, -1],
  ];

  it('is positive for a ring that runs counter-clockwise on the map, negative the other way', () => {
    expect(signedAreaM2(square)).toBe(4);
    expect(signedAreaM2([...square].reverse())).toBe(-4);
  });
});

describe('buildingShells', () => {
  // The Innovation Hub and the Data Center as the seed and TwinScene.dc.html have them.
  const HUB = zone('hub', 'building', box(-165, -75, 30, 90), 24);
  const DATA_CENTER = zone('dc', 'building', box(145, 205, 17, 63), 14);

  it('extrudes the 2D footprint of a building to its height, in metres', () => {
    const [hub, dataCenter] = buildingShells([HUB, DATA_CENTER], frame);

    expect(hub?.zoneId).toBe('hub');
    expect(hub?.heightM).toBe(24);
    // TwinScene.dc.html: InnovationHub x −157…−83, y −82…−38; DataCenter x 153…197, y −55…−25.
    expectExtent(hub!.ring, { minX: -157, maxX: -83, minZ: -82, maxZ: -38 });
    expectExtent(dataCenter!.ring, { minX: 153, maxX: 197, minZ: -55, maxZ: -25 });
  });

  it('is the footprint the 2D map draws, corner for corner', () => {
    const footprint = siteFeatures(undefined, [HUB]).features[0]!.geometry;
    const corners = footprint.type === 'Polygon' ? footprint.coordinates[0]!.slice(0, 4) : [];
    const [shell] = buildingShells([HUB], frame);

    expect(shell!.ring).toHaveLength(4);
    corners.forEach(([lng, lat], index) => {
      const [x, z] = frame.toLocal([lng!, lat!]);
      expect(shell!.ring[index]![0]).toBeCloseTo(x, 6);
      expect(shell!.ring[index]![1]).toBeCloseTo(z, 6);
    });
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['zero', 0],
    ['negative', -3],
    ['not a number', Number.NaN],
  ])('draws a building with a %s height at the default height', (_name, heightM) => {
    const [shell] = buildingShells([zone('b', 'building', box(0, 60, 0, 60), heightM)], frame);

    expect(shell?.heightM).toBe(DEFAULT_BUILDING_HEIGHT_M);
  });

  it('has no shell for a zone that is not a building', () => {
    const zones = [
      zone('u', 'utility', box(0, 60, 0, 60), 9),
      zone('p', 'parking', box(100, 190, 0, 70)),
      zone('g', 'gate', box(-30, 30, 239, 261)),
    ];

    expect(buildingShells(zones, frame)).toEqual([]);
  });

  it('has no shell for a building too small to inset, as the map has no footprint for it', () => {
    const tiny = zone('tiny', 'building', box(-7, 7, 0, 40), 6);

    expect(buildingShells([tiny], frame)).toEqual([]);
    expect(flatZones([tiny], frame)).toHaveLength(1);
  });

  it('keeps the zones order, and turns every ring counter-clockwise on the map without a repeated point', () => {
    const clockwise = [...box(0, 60, 0, 60)].reverse();
    const shells = buildingShells(
      [zone('first', 'building', clockwise, 10), zone('second', 'building', box(100, 160, 0, 60))],
      frame,
    );

    expect(shells.map((shell) => shell.zoneId)).toEqual(['first', 'second']);
    for (const shell of shells) {
      expect(shell.ring).toHaveLength(4);
      expect(signedAreaM2(shell.ring)).toBeGreaterThan(0);
    }
  });
});

describe('flatZones', () => {
  it('fills every zone whatever its kind, buildings too, in order, as open counter-clockwise rings', () => {
    const zones = [
      zone('b', 'building', [...box(0, 60, 0, 60)].reverse(), 12),
      zone('p', 'parking', box(100, 190, 0, 70)),
      zone('w', 'water', box(-150, -40, 165, 228)),
    ];

    const flat = flatZones(zones, frame);

    expect(flat.map(({ zoneId, kind }) => [zoneId, kind])).toEqual([
      ['b', 'building'],
      ['p', 'parking'],
      ['w', 'water'],
    ]);
    for (const { ring } of flat) {
      expect(ring).toHaveLength(4);
      expect(signedAreaM2(ring)).toBeGreaterThan(0);
    }
    expectExtent(flat[0]!.ring, { minX: 0, maxX: 60, minZ: -60, maxZ: 0 });
  });
});

describe('siteLines', () => {
  const zones = [
    zone('b', 'building', box(0, 60, 0, 60), 12),
    zone('p', 'parking', box(100, 190, -35, 35)),
  ];

  it('lists the served plan first, then the footprints and the parking rows', () => {
    const lines = siteLines(SITE, zones, frame);

    expect(lines.slice(0, 3).map(({ part, closed }) => [part, closed])).toEqual([
      ['boundary', true],
      ['road', false],
      ['footprint', true],
    ]);
    const rows = lines.slice(3);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.part).toBe('parking-row');
      expect(row.closed).toBe(false);
      expect(row.points).toHaveLength(2);
    }
  });

  it('draws only what the zones give without a site plan', () => {
    expect(siteLines(undefined, zones, frame).map(({ part }) => part)[0]).toBe('footprint');
    expect(siteLines(undefined, [], frame)).toEqual([]);
  });

  it('puts the boundary in metres, open and counter-clockwise on the map', () => {
    const [boundary] = siteLines(SITE, [], frame);

    expect(boundary?.points).toHaveLength(4);
    expect(signedAreaM2(boundary!.points)).toBeGreaterThan(0);
    expectExtent(boundary!.points, { minX: -100, maxX: 100, minZ: -100, maxZ: 100 });
  });
});

describe('sceneBounds and panBounds', () => {
  it('covers the boundary and a zone that reaches beyond it', () => {
    const outside = zone('far', 'outdoor', box(150, 190, -10, 10));

    const bounds = sceneBounds(SITE, [outside], frame)!;

    expect(bounds.minX).toBeCloseTo(-100, 1);
    expect(bounds.maxX).toBeCloseTo(190, 1);
    expect(bounds.minZ).toBeCloseTo(-100, 1);
    expect(bounds.maxZ).toBeCloseTo(100, 1);
  });

  it('has nothing to frame without a plan or zones', () => {
    expect(sceneBounds(undefined, [], frame)).toBeNull();
  });

  it('grows the bounds by 40 m on every side, and leaves its argument alone', () => {
    const bounds: Bounds = { minX: -282, maxX: 228, minZ: -247, maxZ: 277 };

    expect(PAN_MARGIN_M).toBe(40);
    // TwinScene.dc.html: the site [−282…228] × [−247…277] pans within [−322…268] × [−287…317].
    expect(panBounds(bounds)).toEqual({ minX: -322, maxX: 268, minZ: -287, maxZ: 317 });
    expect(bounds).toEqual({ minX: -282, maxX: 228, minZ: -247, maxZ: 277 });
  });
});

describe('sceneFrame', () => {
  it('is centred on the site plan when one is served', () => {
    const served = sceneFrame(SITE, [zone('far', 'outdoor', box(150, 190, -10, 10))])!;

    expect(served.toLocal(ANCHOR)).toEqual([0, 0]);
  });

  it('is centred on the plan even when there are no zones', () => {
    expect(sceneFrame(SITE, [])!.toLocal(ANCHOR)).toEqual([0, 0]);
  });

  it('falls back to the middle of the zones when the plan is not served', () => {
    const zones = [
      zone('a', 'building', box(-40, 20, -20, 10)),
      zone('b', 'parking', box(40, 60, 20, 40)),
    ];

    const fallback = sceneFrame(undefined, zones)!;

    // The box around both zones runs −40 … 60 east and −20 … 40 north: its middle is (10, 10).
    const [lng, lat] = fallback.fromLocal(0, 0);
    expect(lng).toBeCloseTo(at(10, 10)[0], 7);
    expect(lat).toBeCloseTo(at(10, 10)[1], 7);
  });

  it('keeps a zone the same size whichever way the origin was chosen', () => {
    const zones = [zone('a', 'building', box(0, 60, 0, 60), 12)];
    const [withPlan] = flatZones(zones, sceneFrame(SITE, zones)!);
    const [withoutPlan] = flatZones(zones, sceneFrame(undefined, zones)!);

    // Only the origin differs: the ring has the same size. Not to the last digit: each frame takes the cosine of
    // its own centre's latitude, and the two centres are a few metres apart (here 3.6 mm² in 3,600 m²).
    expect(signedAreaM2(withPlan!.ring)).toBeCloseTo(signedAreaM2(withoutPlan!.ring), 1);
  });

  it('has no frame without a plan or zones', () => {
    expect(sceneFrame(undefined, [])).toBeNull();
  });
});

describe('interimView', () => {
  // TwinScene.dc.html's campus box.
  const CAMPUS: Bounds = { minX: -282, maxX: 228, minZ: -247, maxZ: 277 };
  const radius = Math.hypot(510, 524) / 2;

  const distanceOf = ({ position, target }: ReturnType<typeof interimView>) =>
    Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]);

  it('looks at the middle of the box, on the ground', () => {
    expect(interimView(CAMPUS).target).toEqual([-27, 0, 15]);
  });

  it('stands above the ground, south-west of the target, 55° from vertical', () => {
    const view = interimView(CAMPUS);

    expect(view.position[1]).toBeGreaterThan(0);
    expect(view.position[0]).toBeLessThan(view.target[0]);
    expect(view.position[2]).toBeGreaterThan(view.target[2]);
    // West and south are equally far: south-west.
    expect(view.target[0] - view.position[0]).toBeCloseTo(view.position[2] - view.target[2], 6);
    expect(Math.acos(view.position[1] / distanceOf(view)) * (180 / Math.PI)).toBeCloseTo(55, 6);
  });

  it('is far enough for the whole box to fit the vertical field of view', () => {
    const view = interimView(CAMPUS);

    expect(distanceOf(view)).toBeCloseTo(radius / Math.sin((view.fov * Math.PI) / 360), 6);
  });

  it('keeps the far plane beyond the farthest ground point', () => {
    const view = interimView(CAMPUS);

    expect(view.far).toBeGreaterThanOrEqual(1500);
    expect(view.far).toBeGreaterThan(distanceOf(view) + radius);
    expect(view.near).toBeGreaterThan(0);
    expect(view.near).toBeLessThan(view.far);
  });

  it('stands farther from a larger box', () => {
    const small: Bounds = { minX: 0, maxX: 200, minZ: 0, maxZ: 200 };

    expect(distanceOf(interimView(CAMPUS))).toBeGreaterThan(distanceOf(interimView(small)));
  });

  it('keeps a usable distance for a box with no size', () => {
    const point: Bounds = { minX: 5, maxX: 5, minZ: 5, maxZ: 5 };

    expect(distanceOf(interimView(point))).toBeCloseTo(60, 6);
  });
});
