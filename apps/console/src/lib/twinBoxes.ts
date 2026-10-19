import type { PlacedAsset } from './twinPlacement';

/*
 * The assets' neutral boxes as plain buffers (V2-14.6): every box merged into one triangle mesh and one
 * list of edge segments, with no `three` and no WebGL, so what WebGL cannot test here (the winding and
 * normals, the turn by heading, the ranges) is tested without it (ADR-0020 § Testing). `twin/AssetBoxes.tsx`
 * only wraps these arrays in geometries, as `Buildings` does with `twinBuildings.ts`.
 *
 * Positions are flat `[x, y, z, …]` in scene metres (x east, y up, z = −north); indices are triples. A box
 * is six flat faces of its own four vertices each, so `24` vertices and `12` triangles, and `12` edge
 * segments (the bottom ring, the top ring and a line at each corner). Faces share no vertex, so each is
 * flat-shaded by its normal, as the shells are.
 */

/** Where one box's data sits in the merged buffers. Every range is contiguous, in the boxes' order. */
export interface BoxRange {
  code: string;
  firstVertex: number;
  vertexCount: number;
  firstTriangle: number;
  triangleCount: number;
  /** In segments: segment `s` is the six numbers from `edges[6 * s]`. */
  firstSegment: number;
  segmentCount: number;
}

export interface BoxGeometry {
  positions: number[];
  normals: number[];
  indices: number[];
  /** Segment pairs `[x1, y1, z1, x2, y2, z2, …]`. */
  edges: number[];
  /**
   * One entry per box, in the input's order: what a later task needs to find a box's vertices (to colour it
   * by state: V2-14.9), its triangles (to name what a ray hit: V2-15.3) and its edges.
   */
  ranges: BoxRange[];
}

/** A corner of the unit box: `x` and `z` in −1 … 1 (times half the size), `y` in 0 … 1 (times the height). */
type Corner = readonly [x: -1 | 1, y: 0 | 1, z: -1 | 1];

/**
 * The six faces, each as its outward normal in the box's own axes and its corners counter-clockwise seen
 * from outside (so the front side faces out): the cross product of the first two edges is the normal.
 */
const FACES: readonly { normal: readonly [number, number, number]; corners: readonly Corner[] }[] =
  [
    {
      normal: [0, 1, 0],
      corners: [
        [-1, 1, -1],
        [-1, 1, 1],
        [1, 1, 1],
        [1, 1, -1],
      ],
    },
    {
      normal: [0, -1, 0],
      corners: [
        [-1, 0, -1],
        [1, 0, -1],
        [1, 0, 1],
        [-1, 0, 1],
      ],
    },
    {
      normal: [0, 0, 1],
      corners: [
        [-1, 0, 1],
        [1, 0, 1],
        [1, 1, 1],
        [-1, 1, 1],
      ],
    },
    {
      normal: [0, 0, -1],
      corners: [
        [1, 0, -1],
        [-1, 0, -1],
        [-1, 1, -1],
        [1, 1, -1],
      ],
    },
    {
      normal: [1, 0, 0],
      corners: [
        [1, 0, 1],
        [1, 0, -1],
        [1, 1, -1],
        [1, 1, 1],
      ],
    },
    {
      normal: [-1, 0, 0],
      corners: [
        [-1, 0, -1],
        [-1, 0, 1],
        [-1, 1, 1],
        [-1, 1, -1],
      ],
    },
  ];

/** The twelve edges as pairs of corners: the bottom ring, the top ring, then a line at each corner. */
const EDGES: readonly (readonly [Corner, Corner])[] = [
  [
    [-1, 0, -1],
    [1, 0, -1],
  ],
  [
    [1, 0, -1],
    [1, 0, 1],
  ],
  [
    [1, 0, 1],
    [-1, 0, 1],
  ],
  [
    [-1, 0, 1],
    [-1, 0, -1],
  ],
  [
    [-1, 1, -1],
    [1, 1, -1],
  ],
  [
    [1, 1, -1],
    [1, 1, 1],
  ],
  [
    [1, 1, 1],
    [-1, 1, 1],
  ],
  [
    [-1, 1, 1],
    [-1, 1, -1],
  ],
  [
    [-1, 0, -1],
    [-1, 1, -1],
  ],
  [
    [1, 0, -1],
    [1, 1, -1],
  ],
  [
    [1, 0, 1],
    [1, 1, 1],
  ],
  [
    [-1, 0, 1],
    [-1, 1, 1],
  ],
];

/**
 * Merges `placed` into one set of buffers, in the order given. A box stands on `pose.y`, is centred on
 * `pose.x`, `pose.z` and is turned about the vertical axis by `pose.rotationY` the way three.js turns an
 * object: a rotation θ sends +z to `(sin θ, cos θ)`. Nothing is skipped; an empty input gives empty buffers.
 */
export function buildBoxGeometry(placed: readonly PlacedAsset[]): BoxGeometry {
  const geometry: BoxGeometry = { positions: [], normals: [], indices: [], edges: [], ranges: [] };
  const { positions, normals, indices, edges } = geometry;

  for (const { code, pose, size } of placed) {
    const cos = Math.cos(pose.rotationY);
    const sin = Math.sin(pose.rotationY);
    const point = ([cx, cy, cz]: Corner): [number, number, number] => {
      const lx = (cx * size.x) / 2;
      const lz = (cz * size.z) / 2;
      return [pose.x + lx * cos + lz * sin, pose.y + cy * size.y, pose.z - lx * sin + lz * cos];
    };

    const firstVertex = positions.length / 3;
    const firstTriangle = indices.length / 3;
    const firstSegment = edges.length / 6;

    for (const { normal, corners } of FACES) {
      const base = positions.length / 3;
      const [nx, ny, nz] = normal;
      // A normal turns like a direction, with no translation.
      const turned: [number, number, number] = [nx * cos + nz * sin, ny, -nx * sin + nz * cos];
      for (const corner of corners) {
        positions.push(...point(corner));
        normals.push(...turned);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    for (const [from, to] of EDGES) edges.push(...point(from), ...point(to));

    geometry.ranges.push({
      code,
      firstVertex,
      vertexCount: positions.length / 3 - firstVertex,
      firstTriangle,
      triangleCount: indices.length / 3 - firstTriangle,
      firstSegment,
      segmentCount: edges.length / 6 - firstSegment,
    });
  }
  return geometry;
}
