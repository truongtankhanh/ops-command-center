import type { LngLat, SitePlan, Zone } from '@occ/contracts';
import { offsetM } from './geo';
import { ROAD_WIDTH_M } from './sitePlan';
import {
  buildGround,
  fillTriangles,
  GRID_STEP_M,
  GROUND_LAYERS,
  gridSegments,
  type Mesh,
  roadRibbon,
  segmentsOf,
} from './twinGround';
import { type Bounds, type Local, makeFrame } from './twinScene';

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

const plan = (features: SitePlan['features']): SitePlan => ({
  id: 's1',
  code: 'LANGBIANG',
  name: 'Langbiang Tech Campus',
  center: ANCHOR,
  features,
});

/** Triangles, their total area and how many face up (+y), and whether every index is in range. */
function inspect({ positions, indices }: Mesh) {
  let area = 0;
  let facingUp = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i]!, indices[i + 1]!, indices[i + 2]!];
    const [ax, az] = [positions[3 * a]!, positions[3 * a + 2]!];
    const [bx, bz] = [positions[3 * b]!, positions[3 * b + 2]!];
    const [cx, cz] = [positions[3 * c]!, positions[3 * c + 2]!];
    const cross = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    area += Math.abs(cross) / 2;
    if (cross >= 0) facingUp += 1;
  }
  return {
    triangles: indices.length / 3,
    area,
    facingUp,
    inRange: indices.every((index) => index >= 0 && index < positions.length / 3),
    flat: positions.every((value, i) => i % 3 !== 1 || value === 0),
  };
}

/** The x and z extent of a flat position list. */
function extentOf(positions: readonly number[]): Bounds {
  const xs = positions.filter((_, i) => i % 3 === 0);
  const zs = positions.filter((_, i) => i % 3 === 2);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

/** Even-odd test of a point in a ring. */
function contains(ring: readonly Local[], [x, z]: Local): boolean {
  let inside = false;
  ring.forEach(([x1, z1], i) => {
    const [x2, z2] = ring[(i + 1) % ring.length]!;
    if (z1 > z !== z2 > z && x < ((x2 - x1) * (z - z1)) / (z2 - z1) + x1) inside = !inside;
  });
  return inside;
}

describe('gridSegments', () => {
  it('draws every multiple of 50 m inside the campus box of TwinScene, nothing on its edge', () => {
    const segments = gridSegments({ minX: -282, maxX: 228, minZ: -247, maxZ: 277 });

    const vertical: number[] = [];
    const horizontal: number[] = [];
    for (let i = 0; i < segments.length; i += 6) {
      // A line along z has the same x at both ends.
      if (segments[i] === segments[i + 3]) vertical.push(segments[i]!);
      else horizontal.push(segments[i + 2]!);
    }
    expect(GRID_STEP_M).toBe(50);
    expect(vertical).toEqual([-250, -200, -150, -100, -50, 0, 50, 100, 150, 200]);
    expect(horizontal).toEqual([-200, -150, -100, -50, 0, 50, 100, 150, 200, 250]);
  });

  it('runs each line across the whole box, on the ground', () => {
    const segments = gridSegments({ minX: -60, maxX: 120, minZ: -10, maxZ: 30 });

    // x = −50, 0, 50, 100 span z −10 … 30; z = 0 spans x −60 … 120.
    expect(segments.slice(0, 6)).toEqual([-50, 0, -10, -50, 0, 30]);
    expect(segments.slice(-6)).toEqual([-60, 0, 0, 120, 0, 0]);
    expect(segments).toHaveLength(5 * 6);
  });

  it('leaves out a line that lies exactly on the edge of the box', () => {
    const segments = gridSegments({ minX: -50, maxX: 50, minZ: 10, maxZ: 20 });

    expect(segments.filter((_, i) => i % 6 === 0)).toEqual([0]);
  });

  it('is empty without a box, or when no multiple of 50 m falls inside it', () => {
    expect(gridSegments(null)).toEqual([]);
    expect(gridSegments({ minX: 10, maxX: 40, minZ: 10, maxZ: 40 })).toEqual([]);
  });
});

describe('segmentsOf', () => {
  it('turns a polyline into one pair per step, on the ground', () => {
    const segments = segmentsOf([
      {
        closed: false,
        points: [
          [0, 0],
          [10, 0],
          [10, 5],
        ],
      },
    ]);

    expect(segments).toEqual([0, 0, 0, 10, 0, 0, 10, 0, 0, 10, 0, 5]);
  });

  it('closes a ring with a pair back to its first point', () => {
    const segments = segmentsOf([
      {
        closed: true,
        points: [
          [0, 0],
          [4, 0],
          [4, 3],
          [0, 3],
        ],
      },
    ]);

    expect(segments).toHaveLength(4 * 6);
    expect(segments.slice(-6)).toEqual([0, 0, 3, 0, 0, 0]);
  });

  it('has nothing to draw for a single point, and draws a closed pair only once', () => {
    expect(segmentsOf([{ closed: false, points: [[1, 1]] }])).toEqual([]);
    expect(
      segmentsOf([
        {
          closed: true,
          points: [
            [0, 0],
            [1, 0],
          ],
        },
      ]),
    ).toHaveLength(6);
  });

  it('joins several lines into one list', () => {
    const line = {
      closed: false,
      points: [
        [0, 0],
        [1, 0],
      ] as Local[],
    };

    expect(segmentsOf([line, line, line])).toHaveLength(3 * 6);
  });
});

describe('roadRibbon', () => {
  const straight = {
    closed: false,
    points: [
      [0, 0],
      [100, 0],
    ] as Local[],
  };

  it('is 9 m wide by default, as the 2D map draws it', () => {
    const { positions } = roadRibbon([straight]);

    expect(ROAD_WIDTH_M).toBe(9);
    // The first quad's four corners are the segment's ends offset by half the width.
    const corners = [0, 1, 2, 3].map((i) => [positions[3 * i], positions[3 * i + 2]]);
    expect(corners.map(([x]) => x).sort((a, b) => a! - b!)).toEqual([0, 0, 100, 100]);
    expect(corners.map(([, z]) => Math.abs(z!))).toEqual([4.5, 4.5, 4.5, 4.5]);
  });

  it('takes another width', () => {
    const { positions } = roadRibbon([straight], 4);

    expect(Math.abs(positions[2]!)).toBe(2);
  });

  it('covers the ribbon and a round end disc of half a width at each end', () => {
    const mesh = roadRibbon([straight]);
    const { area } = inspect(mesh);

    // 100 × 9 of ribbon plus two 12-gons of radius 4.5; the areas are summed per triangle, so the part of
    // a disc that overlaps the ribbon counts too.
    const disc = (12 / 2) * 4.5 * 4.5 * Math.sin((2 * Math.PI) / 12);
    expect(area).toBeCloseTo(900 + 2 * disc, 6);
    const extent = extentOf(mesh.positions);
    expect(extent.minX).toBeCloseTo(-4.5, 6);
    expect(extent.maxX).toBeCloseTo(104.5, 6);
  });

  it('is flat, with every triangle facing up and every index in range', () => {
    const mesh = roadRibbon([
      {
        closed: false,
        points: [
          [0, 0],
          [50, 0],
          [50, 80],
          [-20, 60],
        ],
      },
    ]);
    const { triangles, facingUp, inRange, flat } = inspect(mesh);

    expect(triangles).toBeGreaterThan(0);
    expect(facingUp).toBe(triangles);
    expect(inRange).toBe(true);
    expect(flat).toBe(true);
  });

  it('skips a segment of no length but still rounds the point', () => {
    const mesh = roadRibbon([
      {
        closed: false,
        points: [
          [5, 5],
          [5, 5],
        ],
      },
    ]);

    // Two discs of 13 vertices, 12 triangles each; no quad.
    expect(mesh.positions).toHaveLength(2 * 13 * 3);
    expect(inspect(mesh).triangles).toBe(24);
  });

  it('is empty without lines', () => {
    expect(roadRibbon([])).toEqual({ positions: [], indices: [] });
  });
});

describe('fillTriangles', () => {
  const rectangle: Local[] = [
    [0, 0],
    [10, 0],
    [10, 5],
    [0, 5],
  ];
  // An L: a 10 × 5 bar and a 5 × 5 arm, 75 m² in all, concave at (5, 5).
  const ell: Local[] = [
    [0, 0],
    [10, 0],
    [10, 5],
    [5, 5],
    [5, 10],
    [0, 10],
  ];

  it('splits a rectangle into two triangles that cover it', () => {
    const mesh = fillTriangles([{ ring: rectangle, key: 'a' }]);
    const { triangles, area, facingUp, inRange, flat } = inspect(mesh);

    expect(triangles).toBe(2);
    expect(area).toBeCloseTo(50, 9);
    expect(facingUp).toBe(2);
    expect(inRange).toBe(true);
    expect(flat).toBe(true);
    expect(mesh.keys).toEqual(['a', 'a', 'a', 'a']);
  });

  it('does not mind which way round the ring runs', () => {
    const { triangles, area, facingUp } = inspect(
      fillTriangles([{ ring: [...rectangle].reverse(), key: 'a' }]),
    );

    expect(triangles).toBe(2);
    expect(area).toBeCloseTo(50, 9);
    expect(facingUp).toBe(2);
  });

  it.each([
    ['as given', ell],
    ['reversed', [...ell].reverse()],
  ])('fills a concave ring only where it has area (%s)', (_name, ring) => {
    const mesh = fillTriangles([{ ring, key: 'a' }]);
    const { triangles, area, facingUp } = inspect(mesh);

    expect(triangles).toBe(4);
    expect(area).toBeCloseTo(75, 9);
    expect(facingUp).toBe(4);
    // No triangle reaches into the notch of the L.
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const corners = [0, 1, 2].map((k): Local => {
        const v = mesh.indices[i + k]!;
        return [mesh.positions[3 * v]!, mesh.positions[3 * v + 2]!];
      });
      const centre: Local = [
        (corners[0]![0] + corners[1]![0] + corners[2]![0]) / 3,
        (corners[0]![1] + corners[1]![1] + corners[2]![1]) / 3,
      ];
      expect(contains(ell, centre)).toBe(true);
    }
  });

  it('fills a triangle with one triangle', () => {
    const { triangles, area } = inspect(
      fillTriangles([
        {
          ring: [
            [0, 0],
            [6, 0],
            [0, 4],
          ],
          key: 'a',
        },
      ]),
    );

    expect(triangles).toBe(1);
    expect(area).toBeCloseTo(12, 9);
  });

  it('keeps the rings apart: the key follows the vertex and the indices follow the ring', () => {
    const mesh = fillTriangles([
      { ring: rectangle, key: 'building' },
      { ring: rectangle.map(([x, z]): Local => [x + 20, z]), key: 'parking' },
    ]);

    expect(mesh.keys).toEqual([...Array(4).fill('building'), ...Array(4).fill('parking')]);
    const second = mesh.indices.slice(6);
    expect(second.every((index) => index >= 4)).toBe(true);
    expect(mesh.indices.slice(0, 6).every((index) => index < 4)).toBe(true);
    expect(inspect(mesh).area).toBeCloseTo(100, 9);
  });

  it('skips a ring without area and does not hang on a degenerate one', () => {
    const mesh = fillTriangles([
      {
        ring: [
          [0, 0],
          [1, 1],
        ],
        key: 'gone',
      },
      { ring: rectangle, key: 'a' },
    ]);
    expect(mesh.keys).toEqual(['a', 'a', 'a', 'a']);

    const collinear: Local[] = [
      [0, 0],
      [5, 0],
      [10, 0],
      [20, 0],
    ];
    const degenerate = fillTriangles([{ ring: collinear, key: 'flat' }]);
    expect(inspect(degenerate).area).toBe(0);
  });

  it('is empty without rings', () => {
    expect(fillTriangles([])).toEqual({ positions: [], indices: [], keys: [] });
  });
});

describe('GROUND_LAYERS', () => {
  const names = GROUND_LAYERS.map(({ name }) => name);

  it('has nine layers, so the ground costs at most the nine draw calls it is budgeted for', () => {
    expect(GROUND_LAYERS).toHaveLength(9);
    expect(new Set(names).size).toBe(9);
    expect(GROUND_LAYERS.length).toBeLessThanOrEqual(12);
  });

  it('draws back to front: fill, grid, boundary, roads, zone fills, then the thin lines', () => {
    const order = (name: (typeof names)[number]) => names.indexOf(name);

    expect(order('boundaryFill')).toBe(0);
    expect(order('grid')).toBeLessThan(order('roads'));
    expect(order('boundaryLine')).toBeLessThan(order('roads'));
    expect(order('roads')).toBeLessThan(order('zoneFills'));
    for (const line of ['fieldLines', 'parkingRows', 'footprints', 'zoneOutlines'] as const) {
      expect(order(line)).toBeGreaterThan(order('zoneFills'));
    }
    expect(names.at(-1)).toBe('zoneOutlines');
  });

  it('dashes the boundary and the parking rows, in metres, and nothing else', () => {
    expect(GROUND_LAYERS.filter(({ dash }) => dash !== undefined).map(({ name }) => name)).toEqual([
      'boundaryLine',
      'parkingRows',
    ]);
    for (const { dash } of GROUND_LAYERS) {
      if (dash) {
        expect(dash.dashM).toBeGreaterThan(0);
        expect(dash.gapM).toBeGreaterThan(0);
      }
    }
  });

  it('draws the fills and the roads as meshes and the rest as lines', () => {
    const meshes = GROUND_LAYERS.filter(({ primitive }) => primitive === 'mesh').map(
      ({ name }) => name,
    );

    expect(meshes).toEqual(['boundaryFill', 'roads', 'zoneFills']);
  });
});

describe('buildGround', () => {
  // Edges chosen off the multiples of 50 m, so float noise cannot move a grid line in or out.
  const SITE = plan([
    { part: 'boundary', geometry: { type: 'Polygon', coordinates: [box(-120, 120, -90, 90)] } },
    { part: 'road', geometry: { type: 'LineString', coordinates: [at(0, -90), at(0, 90)] } },
    {
      part: 'field',
      geometry: { type: 'LineString', coordinates: [at(-100, -20), at(-60, -20)] },
    },
  ]);
  const ZONES = [
    zone('hall', 'building', box(0, 60, 0, 60), 12),
    zone('lot', 'parking', box(100, 190, -35, 35)),
  ];

  it('puts each part of the plan in its layer', () => {
    const ground = buildGround(SITE, ZONES, frame);

    // The boundary is a 240 × 180 m rectangle: two triangles, and four dashed sides.
    const fill = inspect(ground.boundaryFill);
    expect(fill.triangles).toBe(2);
    expect(fill.area).toBeCloseTo(240 * 180, 0);
    expect(ground.boundaryLine).toHaveLength(4 * 6);
    // The road is a 9 m ribbon with round ends along x = 0.
    const road = extentOf(ground.roads.positions);
    expect(road.minX).toBeCloseTo(-4.5, 1);
    expect(road.maxX).toBeCloseTo(4.5, 1);
    expect(road.minZ).toBeCloseTo(-94.5, 1);
    expect(road.maxZ).toBeCloseTo(94.5, 1);
    expect(ground.fieldLines).toHaveLength(6);
    // One building footprint, four sides; parking rows are single segments.
    expect(ground.footprints).toHaveLength(4 * 6);
    expect(ground.parkingRows.length).toBeGreaterThan(0);
    expect(ground.parkingRows.length % 6).toBe(0);
  });

  it('fills and outlines every zone, tagged with its kind', () => {
    const ground = buildGround(SITE, ZONES, frame);

    expect(inspect(ground.zoneFills).triangles).toBe(4);
    expect(ground.zoneFills.keys).toEqual([
      ...Array(4).fill('building'),
      ...Array(4).fill('parking'),
    ]);
    expect(ground.zoneOutlines).toHaveLength(8 * 6);
  });

  it('draws a grid over the box around the boundary and the zones', () => {
    const { grid } = buildGround(SITE, ZONES, frame);

    // x −120 … 190: −100, −50, 0, 50, 100, 150; z −90 … 90: −50, 0, 50.
    expect(grid).toHaveLength((6 + 3) * 6);
  });

  it('draws only the zones when the plan is not served, as the 2D map does', () => {
    const ground = buildGround(undefined, ZONES, frame);

    expect(ground.boundaryFill.positions).toEqual([]);
    expect(ground.boundaryLine).toEqual([]);
    expect(ground.roads.positions).toEqual([]);
    expect(ground.fieldLines).toEqual([]);
    expect(inspect(ground.zoneFills).triangles).toBe(4);
    expect(ground.footprints).toHaveLength(4 * 6);
    expect(ground.grid.length).toBeGreaterThan(0);
  });

  it('is empty with no plan and no zones', () => {
    const ground = buildGround(undefined, [], frame);

    expect(ground.grid).toEqual([]);
    expect(ground.zoneFills.positions).toEqual([]);
    expect(ground.zoneOutlines).toEqual([]);
    expect(ground.boundaryFill.positions).toEqual([]);
  });

  it('leaves out a part of the plan this build does not know', () => {
    const odd = plan([
      ...SITE.features,
      {
        part: 'helipad',
        geometry: { type: 'LineString', coordinates: [at(0, 0), at(10, 10)] },
      } as unknown as SitePlan['features'][number],
    ]);

    const ground = buildGround(odd, ZONES, frame);
    const known = buildGround(SITE, ZONES, frame);

    expect(ground).toEqual(known);
  });

  it('keeps every layer flat, facing up, with its indices in range', () => {
    const ground = buildGround(SITE, ZONES, frame);

    for (const mesh of [ground.boundaryFill, ground.roads, ground.zoneFills]) {
      const { triangles, facingUp, inRange, flat } = inspect(mesh);
      expect(facingUp).toBe(triangles);
      expect(inRange).toBe(true);
      expect(flat).toBe(true);
    }
  });
});
