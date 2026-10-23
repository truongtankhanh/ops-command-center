import { buildShellGeometry, type ShellGeometry } from './twinBuildings';
import { type Local, type Shell } from './twinScene';

/** A footprint ring in scene metres (x east, z = −north), counter-clockwise on the map. */
const RECTANGLE: Local[] = [
  [0, 0],
  [10, 0],
  [10, -5],
  [0, -5],
];
// An L of 75 m²: a 10 × 5 bar and a 5 × 5 arm, concave at (5, −5).
const ELL: Local[] = [
  [0, 0],
  [10, 0],
  [10, -5],
  [5, -5],
  [5, -10],
  [0, -10],
];
const TRIANGLE: Local[] = [
  [0, 0],
  [6, 0],
  [0, -4],
];

const shell = (zoneId: string, ring: Local[], heightM: number): Shell => ({
  zoneId,
  ring,
  heightM,
});

type Vec = [number, number, number];

/** The corners of triangle `t`, its geometric normal (not unit) and the normal stored on its first vertex. */
function triangle({ positions, normals, indices }: ShellGeometry, t: number) {
  const ids = [indices[3 * t]!, indices[3 * t + 1]!, indices[3 * t + 2]!];
  const [a, b, c] = ids.map((i): Vec => [
    positions[3 * i]!,
    positions[3 * i + 1]!,
    positions[3 * i + 2]!,
  ]);
  const u = [b![0] - a![0], b![1] - a![1], b![2] - a![2]];
  const v = [c![0] - a![0], c![1] - a![1], c![2] - a![2]];
  const cross: Vec = [
    u[1]! * v[2]! - u[2]! * v[1]!,
    u[2]! * v[0]! - u[0]! * v[2]!,
    u[0]! * v[1]! - u[1]! * v[0]!,
  ];
  const stored: Vec = [normals[3 * ids[0]!]!, normals[3 * ids[0]! + 1]!, normals[3 * ids[0]! + 2]!];
  return { corners: [a!, b!, c!], cross, stored };
}

const area = (cross: Vec) => Math.hypot(...cross) / 2;
const dot = (p: Vec, q: Vec) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];

/** Triangles `first … first + count − 1` of the geometry. */
const range = (geometry: ShellGeometry, first: number, count: number) =>
  Array.from({ length: count }, (_, k) => triangle(geometry, first + k));

describe('buildShellGeometry', () => {
  describe('a rectangle', () => {
    const geometry = buildShellGeometry([shell('hall', RECTANGLE, 6)]);
    const [only] = geometry.ranges;
    // The first 2n triangles are the walls, the rest the roof.
    const walls = range(geometry, 0, 8);
    const roof = range(geometry, 8, 2);

    it('has 5n vertices, 3n − 2 triangles and 3n edge segments', () => {
      expect(geometry.positions).toHaveLength(5 * 4 * 3);
      expect(geometry.normals).toHaveLength(5 * 4 * 3);
      expect(geometry.indices).toHaveLength((3 * 4 - 2) * 3);
      expect(geometry.edges).toHaveLength(3 * 4 * 6);
    });

    it('keeps its range, from the first vertex, triangle and segment', () => {
      expect(only).toEqual({
        zoneId: 'hall',
        firstVertex: 0,
        vertexCount: 20,
        firstTriangle: 0,
        triangleCount: 10,
        firstSegment: 0,
        segmentCount: 12,
      });
    });

    it('has walls as tall as the building and as long as its perimeter', () => {
      const wallArea = walls.reduce((sum, { cross }) => sum + area(cross), 0);

      expect(wallArea).toBeCloseTo(30 * 6, 9);
      for (const { corners } of walls) {
        for (const [, y] of corners) expect([0, 6]).toContain(y);
      }
    });

    it('faces every wall away from the building, whichever way the stored normal is read', () => {
      const centre: Vec = [5, 0, -2.5];
      for (const { corners, cross, stored } of walls) {
        // The geometric normal (winding) is the stored one, and unit.
        expect(Math.hypot(...stored)).toBeCloseTo(1, 9);
        expect(dot(cross, stored) / Math.hypot(...cross)).toBeCloseTo(1, 9);
        // And it points away from the middle of the footprint.
        const middle: Vec = [
          (corners[0]![0] + corners[1]![0] + corners[2]![0]) / 3 - centre[0],
          0,
          (corners[0]![2] + corners[1]![2] + corners[2]![2]) / 3 - centre[2],
        ];
        expect(dot(stored, middle)).toBeGreaterThan(0);
        expect(stored[1]).toBe(0);
      }
    });

    it('gives the south wall +z, the east wall +x, the north wall −z and the west wall −x', () => {
      // The ring runs south-west, south-east, north-east, north-west: south, east, north, west.
      expect(walls.map(({ stored }) => stored).filter((_, t) => t % 2 === 0)).toEqual([
        [0, 0, 1],
        [1, 0, 0],
        [0, 0, -1],
        [-1, 0, 0],
      ]);
    });

    it('covers the footprint with a roof at the height, facing up', () => {
      const roofArea = roof.reduce((sum, { cross }) => sum + area(cross), 0);

      expect(roofArea).toBeCloseTo(50, 9);
      for (const { corners, cross, stored } of roof) {
        expect(stored).toEqual([0, 1, 0]);
        expect(cross[1]).toBeGreaterThan(0);
        for (const [, y] of corners) expect(y).toBe(6);
      }
    });

    it('shares no vertex between a wall and the roof, so every face is flat-shaded', () => {
      const wallVertices = new Set(geometry.indices.slice(0, 8 * 3));
      const roofVertices = geometry.indices.slice(8 * 3);

      expect(roofVertices.every((index) => !wallVertices.has(index))).toBe(true);
    });

    it('has the bottom ring, the top ring and a vertical line at each corner as edges', () => {
      const segments = Array.from({ length: 12 }, (_, s) => {
        const e = geometry.edges.slice(6 * s, 6 * s + 6);
        return { from: e.slice(0, 3), to: e.slice(3) };
      });

      const horizontal = segments.filter(({ from, to }) => from[1] === to[1]);
      const vertical = segments.filter(({ from, to }) => from[0] === to[0] && from[2] === to[2]);
      expect(horizontal).toHaveLength(8);
      expect(vertical).toHaveLength(4);
      expect(horizontal.filter(({ from }) => from[1] === 0)).toHaveLength(4);
      expect(horizontal.filter(({ from }) => from[1] === 6)).toHaveLength(4);
      for (const { from, to } of vertical) expect([from[1], to[1]].sort()).toEqual([0, 6]);
    });
  });

  it('does not mind a ring that runs clockwise: the walls still face outward', () => {
    const clockwise = buildShellGeometry([shell('hall', [...RECTANGLE].reverse(), 6)]);
    const counter = buildShellGeometry([shell('hall', RECTANGLE, 6)]);

    expect(clockwise).toEqual(counter);
  });

  it.each([
    ['a triangle', TRIANGLE, 3, 12],
    ['an L-shape', ELL, 6, 75],
  ])('extrudes %s', (_name, ring, corners, footprintArea) => {
    const geometry = buildShellGeometry([shell('x', ring, 4)]);
    const [only] = geometry.ranges;

    expect(only).toMatchObject({
      vertexCount: 5 * corners,
      triangleCount: 3 * corners - 2,
      segmentCount: 3 * corners,
    });
    const triangles = range(geometry, 0, only!.triangleCount);
    const roofArea = triangles.slice(2 * corners).reduce((sum, { cross }) => sum + area(cross), 0);
    expect(roofArea).toBeCloseTo(footprintArea, 9);
    for (const { cross, stored } of triangles.slice(2 * corners)) {
      expect(stored).toEqual([0, 1, 0]);
      expect(cross[1]).toBeGreaterThan(0);
    }
    for (const { cross, stored } of triangles.slice(0, 2 * corners)) {
      expect(dot(cross, stored)).toBeGreaterThan(0);
    }
  });

  describe('several buildings', () => {
    const geometry = buildShellGeometry([
      shell('first', RECTANGLE, 6),
      shell('second', ELL, 14),
      shell('third', TRIANGLE, 3),
    ]);

    it('lists one range per building, in order, tiling the buffers with no gap', () => {
      expect(geometry.ranges.map(({ zoneId }) => zoneId)).toEqual(['first', 'second', 'third']);
      let vertex = 0;
      let triangleAt = 0;
      let segment = 0;
      for (const range of geometry.ranges) {
        expect(range.firstVertex).toBe(vertex);
        expect(range.firstTriangle).toBe(triangleAt);
        expect(range.firstSegment).toBe(segment);
        vertex += range.vertexCount;
        triangleAt += range.triangleCount;
        segment += range.segmentCount;
      }
      expect(vertex * 3).toBe(geometry.positions.length);
      expect(triangleAt * 3).toBe(geometry.indices.length);
      expect(segment * 6).toBe(geometry.edges.length);
    });

    it('keeps the indices of a building inside its own vertices', () => {
      for (const r of geometry.ranges) {
        const own = geometry.indices.slice(
          3 * r.firstTriangle,
          3 * (r.firstTriangle + r.triangleCount),
        );
        expect(Math.min(...own)).toBeGreaterThanOrEqual(r.firstVertex);
        expect(Math.max(...own)).toBeLessThan(r.firstVertex + r.vertexCount);
      }
    });

    it('draws each building at its own height', () => {
      const topOf = (r: (typeof geometry.ranges)[number]) => {
        const ys = geometry.positions
          .filter((_, i) => i % 3 === 1)
          .slice(r.firstVertex, r.firstVertex + r.vertexCount);
        return Math.max(...ys);
      };

      expect(geometry.ranges.map(topOf)).toEqual([6, 14, 3]);
    });

    it('has every index in range', () => {
      expect(geometry.indices.every((i) => i >= 0 && i < geometry.positions.length / 3)).toBe(true);
    });
  });

  it('is empty without buildings', () => {
    expect(buildShellGeometry([])).toEqual({
      positions: [],
      normals: [],
      indices: [],
      edges: [],
      ranges: [],
    });
  });

  it('leaves out a ring with no area, without a range', () => {
    const geometry = buildShellGeometry([
      shell(
        'line',
        [
          [0, 0],
          [5, 0],
        ],
        6,
      ),
      shell('hall', RECTANGLE, 6),
    ]);

    expect(geometry.ranges.map(({ zoneId }) => zoneId)).toEqual(['hall']);
    expect(geometry.ranges[0]!.firstVertex).toBe(0);
  });
});
