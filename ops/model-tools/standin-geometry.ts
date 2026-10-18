/*
 * The two shapes the stand-in models are made of: a box and a cylinder (V2-13.3). Placeholders, not art:
 * frames 03 and 08 give the proportions only.
 *
 * Pure: no gltf-transform, no file system, no clock and no random number, so the same call always gives the
 * same numbers and the generated files keep the same bytes. Counter-clockwise triangles seen from outside,
 * a normal per vertex, +Y up, 1 unit = 1 m, every mesh centred on its own origin until `translate` moves it.
 *
 * Not a workspace member and not linted; `pnpm models:typecheck` checks it.
 */

export type Vec3 = readonly [number, number, number];

export interface Mesh {
  positions: number[];
  normals: number[];
  indices: number[];
}

/** Positions and normals are rounded to this many decimals, so a last-bit difference in `Math.cos` cannot change a file's hash. */
const DECIMALS = 1e6;
const round = (value: number): number => Math.round(value * DECIMALS) / DECIMALS || 0;

/** Each face: its normal, then the two edge directions `u` and `v` with `u × v = normal` (so the corners wind outward). */
const FACES: readonly (readonly [Vec3, Vec3, Vec3])[] = [
  [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  [
    [-1, 0, 0],
    [0, 0, 1],
    [0, 1, 0],
  ],
  [
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 0],
  ],
  [
    [0, -1, 0],
    [1, 0, 0],
    [0, 0, 1],
  ],
  [
    [0, 0, 1],
    [1, 0, 0],
    [0, 1, 0],
  ],
  [
    [0, 0, -1],
    [0, 1, 0],
    [1, 0, 0],
  ],
];
const CORNERS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/** A box of `[width, height, depth]`: 24 vertices (flat normals), 12 triangles. */
export function box([width, height, depth]: Vec3): Mesh {
  const half = [width / 2, height / 2, depth / 2] as const;
  const mesh: Mesh = { positions: [], normals: [], indices: [] };
  for (const [normal, u, v] of FACES) {
    const first = mesh.positions.length / 3;
    for (const [su, sv] of CORNERS) {
      for (let axis = 0; axis < 3; axis++) {
        const component = (normal[axis] ?? 0) + su * (u[axis] ?? 0) + sv * (v[axis] ?? 0);
        mesh.positions.push(round(component * half[axis]!));
      }
      mesh.normals.push(...normal);
    }
    mesh.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  return mesh;
}

interface CylinderOptions {
  radius: number;
  height: number;
  /** Sides around the axis: 4 × `segments` triangles in all (two for each side, one for each cap segment). */
  segments: number;
  /** The direction of the axis; `y` unless said. */
  axis?: 'x' | 'y' | 'z';
}

/** A capped cylinder: smooth normals on the side, flat on the caps. */
export function cylinder({ radius, height, segments, axis = 'y' }: CylinderOptions): Mesh {
  const mesh: Mesh = { positions: [], normals: [], indices: [] };
  const low = -height / 2;
  const high = height / 2;
  const ring = (i: number) => {
    const angle = (2 * Math.PI * i) / segments;
    return [Math.cos(angle), Math.sin(angle)] as const;
  };

  // The side: vertex 2i is the bottom of segment i, 2i + 1 its top.
  for (let i = 0; i < segments; i++) {
    const [c, s] = ring(i);
    mesh.positions.push(radius * c, low, radius * s, radius * c, high, radius * s);
    mesh.normals.push(c, 0, s, c, 0, s);
  }
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    mesh.indices.push(2 * i, 2 * i + 1, 2 * j, 2 * j, 2 * i + 1, 2 * j + 1);
  }

  // The caps, with their own vertices for a flat normal: the top is counter-clockwise seen from above.
  for (const [y, ny] of [
    [high, 1],
    [low, -1],
  ] as const) {
    const centre = mesh.positions.length / 3;
    mesh.positions.push(0, y, 0);
    mesh.normals.push(0, ny, 0);
    for (let i = 0; i < segments; i++) {
      const [c, s] = ring(i);
      mesh.positions.push(radius * c, y, radius * s);
      mesh.normals.push(0, ny, 0);
    }
    for (let i = 0; i < segments; i++) {
      const here = centre + 1 + i;
      const next = centre + 1 + ((i + 1) % segments);
      mesh.indices.push(...(ny > 0 ? [centre, next, here] : [centre, here, next]));
    }
  }

  return finish(axis === 'y' ? mesh : turnAxis(mesh, axis));
}

/** Points the +Y axis along +X or +Z by a rotation, which keeps the winding. */
function turnAxis(mesh: Mesh, axis: 'x' | 'z'): Mesh {
  const turn = (x: number, y: number, z: number): [number, number, number] =>
    axis === 'x' ? [y, -x, z] : [x, -z, y];
  const rotate = (values: number[]) => {
    const out: number[] = [];
    for (let i = 0; i < values.length; i += 3) {
      out.push(...turn(values[i]!, values[i + 1]!, values[i + 2]!));
    }
    return out;
  };
  return {
    positions: rotate(mesh.positions),
    normals: rotate(mesh.normals),
    indices: mesh.indices,
  };
}

function finish(mesh: Mesh): Mesh {
  return { ...mesh, positions: mesh.positions.map(round), normals: mesh.normals.map(round) };
}

/** The mesh moved by `by`; normals stay as they are. */
export function translate(mesh: Mesh, by: Vec3): Mesh {
  return {
    ...mesh,
    positions: mesh.positions.map((value, i) => round(value + by[i % 3]!)),
  };
}

/** Several meshes as one, in the order given. */
export function merge(meshes: readonly Mesh[]): Mesh {
  const out: Mesh = { positions: [], normals: [], indices: [] };
  for (const mesh of meshes) {
    const offset = out.positions.length / 3;
    out.positions.push(...mesh.positions);
    out.normals.push(...mesh.normals);
    out.indices.push(...mesh.indices.map((index) => index + offset));
  }
  return out;
}
