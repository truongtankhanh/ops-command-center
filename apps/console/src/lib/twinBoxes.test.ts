import { buildBoxGeometry, edgeIndices } from './twinBoxes';
import type { PlacedAsset } from './twinPlacement';

const box = (
  code: string,
  pose: Partial<PlacedAsset['pose']> = {},
  size: Partial<PlacedAsset['size']> = {},
): PlacedAsset => ({
  code,
  classCode: 'ups',
  zoneId: 'Z',
  placement: 'outdoor',
  pose: { x: 0, y: 0, z: 0, rotationY: 0, ...pose },
  size: { x: 4, y: 2, z: 6, ...size },
});

/** The extent of a flat `[x, y, z, …]` list along one axis. */
function extent(values: readonly number[], axis: 0 | 1 | 2): [number, number] {
  const along = values.filter((_, i) => i % 3 === axis);
  return [Math.min(...along), Math.max(...along)];
}

describe('buildBoxGeometry', () => {
  it('gives empty buffers for no box', () => {
    expect(buildBoxGeometry([])).toEqual({
      positions: [],
      normals: [],
      indices: [],
      edges: [],
      lineDistances: [],
      ranges: [],
    });
  });

  it('builds six faces of four vertices, 12 triangles and 12 edges for one box', () => {
    const { positions, normals, indices, edges, ranges } = buildBoxGeometry([box('A')]);

    expect(positions).toHaveLength(24 * 3);
    expect(normals).toHaveLength(24 * 3);
    expect(indices).toHaveLength(12 * 3);
    expect(edges).toHaveLength(12 * 6);
    expect(ranges).toEqual([
      {
        code: 'A',
        firstVertex: 0,
        vertexCount: 24,
        firstTriangle: 0,
        triangleCount: 12,
        firstSegment: 0,
        segmentCount: 12,
      },
    ]);
    expect(Math.max(...indices)).toBe(23);
  });

  it('centres the box on its x and z and stands it on its y', () => {
    const { positions } = buildBoxGeometry([box('A', { x: 100, y: 14, z: -50 })]);

    expect(extent(positions, 0)).toEqual([98, 102]);
    expect(extent(positions, 1)).toEqual([14, 16]);
    expect(extent(positions, 2)).toEqual([-53, -47]);
  });

  it('turns the box about the vertical axis, a rotation θ sending +z to (sin θ, cos θ)', () => {
    // The box is 4 wide (x) and 6 deep (z): a quarter turn lays its depth along x.
    const quarter = buildBoxGeometry([box('A', { rotationY: Math.PI / 2 })]).positions;
    const [minX, maxX] = extent(quarter, 0);
    const [minZ, maxZ] = extent(quarter, 2);
    expect(maxX - minX).toBeCloseTo(6, 9);
    expect(maxZ - minZ).toBeCloseTo(4, 9);

    // A half turn leaves a box where it is.
    const half = buildBoxGeometry([box('A', { rotationY: Math.PI })]).positions;
    expect(extent(half, 0)[0]).toBeCloseTo(-2, 9);
    expect(extent(half, 2)[1]).toBeCloseTo(3, 9);
  });

  it.each([0, 0.7, Math.PI / 2, Math.PI, 4])(
    'gives every triangle an outward normal, turned by %d rad',
    (rotationY) => {
      const centre = { x: 10, y: 5, z: -3 };
      const { positions, normals, indices } = buildBoxGeometry([
        box('A', { ...centre, y: 5 - 1, rotationY }),
      ]);
      const at = (i: number) => [positions[3 * i]!, positions[3 * i + 1]!, positions[3 * i + 2]!];

      for (let t = 0; t < indices.length; t += 3) {
        const [a, b, c] = [at(indices[t]!), at(indices[t + 1]!), at(indices[t + 2]!)] as [
          number[],
          number[],
          number[],
        ];
        const e1 = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
        const e2 = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
        // The winding's normal, which three.js uses to tell the front side from the back.
        const winding = [
          e1[1]! * e2[2]! - e1[2]! * e2[1]!,
          e1[2]! * e2[0]! - e1[0]! * e2[2]!,
          e1[0]! * e2[1]! - e1[1]! * e2[0]!,
        ];
        const stored = [
          normals[3 * indices[t]!]!,
          normals[3 * indices[t]! + 1]!,
          normals[3 * indices[t]! + 2]!,
        ];
        const outward = [a[0]! - centre.x, a[1]! - centre.y, a[2]! - centre.z];
        const dot = (u: number[], v: number[]) => u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!;

        expect(dot(winding, stored)).toBeGreaterThan(0);
        expect(dot(stored, outward)).toBeGreaterThan(0);
        expect(Math.hypot(...stored)).toBeCloseTo(1, 9);
      }
    },
  );

  it('draws the 12 edges of the box: four along each of its three sides', () => {
    const { edges } = buildBoxGeometry([box('A')]);
    const lengths = new Map<number, number>();
    for (let s = 0; s < edges.length; s += 6) {
      const length = Math.hypot(
        edges[s + 3]! - edges[s]!,
        edges[s + 4]! - edges[s + 1]!,
        edges[s + 5]! - edges[s + 2]!,
      );
      const key = Math.round(length * 1000) / 1000;
      lengths.set(key, (lengths.get(key) ?? 0) + 1);
    }
    expect([...lengths.entries()].sort()).toEqual([
      [2, 4],
      [4, 4],
      [6, 4],
    ]);
  });

  it('keeps the boxes in order, one contiguous range each', () => {
    const { positions, indices, edges, ranges } = buildBoxGeometry([
      box('A'),
      box('B', { x: 20 }),
      box('C', { x: 40 }),
    ]);

    expect(ranges.map((r) => r.code)).toEqual(['A', 'B', 'C']);
    expect(ranges.map((r) => r.firstVertex)).toEqual([0, 24, 48]);
    expect(ranges.map((r) => r.firstTriangle)).toEqual([0, 12, 24]);
    expect(ranges.map((r) => r.firstSegment)).toEqual([0, 12, 24]);
    expect(positions).toHaveLength(72 * 3);
    expect(indices).toHaveLength(36 * 3);
    expect(edges).toHaveLength(36 * 6);

    // The second box's vertices are its own: they are around x = 20.
    const second = positions.slice(3 * 24, 3 * 48);
    expect(extent(second, 0)).toEqual([18, 22]);
    // Its triangles index its own vertices.
    const own = indices.slice(3 * 12, 3 * 24);
    expect(Math.min(...own)).toBe(24);
    expect(Math.max(...own)).toBe(47);
  });
});

describe('lineDistances', () => {
  it('has two numbers per segment: 0, then the segment’s length', () => {
    const { edges, lineDistances } = buildBoxGeometry([box('A')]);

    expect(lineDistances).toHaveLength(edges.length / 3);
    for (let segment = 0; segment < edges.length / 6; segment += 1) {
      expect(lineDistances[2 * segment]).toBe(0);
    }
  });

  it('gives the three edge lengths of the box, four of each', () => {
    const { lineDistances } = buildBoxGeometry([box('A')]);
    const lengths = new Map<number, number>();
    for (let i = 1; i < lineDistances.length; i += 2) {
      const key = Math.round(lineDistances[i]! * 1000) / 1000;
      lengths.set(key, (lengths.get(key) ?? 0) + 1);
    }

    expect([...lengths.entries()].sort()).toEqual([
      [2, 4],
      [4, 4],
      [6, 4],
    ]);
  });

  it('is turned with the box: a quarter turn keeps the lengths', () => {
    const { lineDistances } = buildBoxGeometry([box('A', { rotationY: Math.PI / 2 })]);

    expect(
      [
        ...new Set(lineDistances.filter((d) => d > 0).map((d) => Math.round(d * 1000) / 1000)),
      ].sort(),
    ).toEqual([2, 4, 6]);
  });

  it('keeps the boxes in order, 24 numbers a box', () => {
    const { lineDistances } = buildBoxGeometry([box('A'), box('B', { x: 20 })]);

    expect(lineDistances).toHaveLength(48);
  });
});

describe('edgeIndices', () => {
  const ranges = buildBoxGeometry([box('A'), box('B', { x: 20 }), box('C', { x: 40 })]).ranges;

  /** Every segment of the three boxes, as vertex pairs. */
  const all = Array.from({ length: 36 }, (_, segment) => [2 * segment, 2 * segment + 1]).flat();

  it('puts every segment in the solid layer when nothing is dashed', () => {
    const { solid, dashed } = edgeIndices(ranges, new Set());

    expect(solid).toEqual(all);
    expect(dashed).toEqual([]);
  });

  it('moves exactly the segments of a dashed asset, once each, and keeps the order', () => {
    const { solid, dashed } = edgeIndices(ranges, new Set(['B']));

    // B is segments 12 – 23.
    expect(dashed).toEqual(
      Array.from({ length: 12 }, (_, i) => [2 * (12 + i), 2 * (12 + i) + 1]).flat(),
    );
    expect(solid).toEqual([...all.slice(0, 24), ...all.slice(48)]);
  });

  it('covers every segment exactly once between the two layers, whatever is dashed', () => {
    for (const dashedCodes of [new Set(['A']), new Set(['A', 'C']), new Set(['A', 'B', 'C'])]) {
      const { solid, dashed } = edgeIndices(ranges, dashedCodes);

      expect([...solid, ...dashed].sort((a, b) => a - b)).toEqual(all);
    }
  });

  it('ignores a code that is not a box, and gives nothing for no box', () => {
    expect(edgeIndices(ranges, new Set(['Z'])).dashed).toEqual([]);
    expect(edgeIndices([], new Set(['A']))).toEqual({ solid: [], dashed: [] });
  });
});
