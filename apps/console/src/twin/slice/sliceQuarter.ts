import type { Zone } from '@occ/contracts';
import type { Mesh } from '../../lib/twin-core/twinGround';
import { type Bounds, flatZones, type Frame, type Local } from '../../lib/twin-core/twinScene';

/*
 * SPIKE (V3-11.5): the slice's quarter of the campus, as plain data (no `three`).
 *
 * The box is "Settled in V3-11.1": east 0 – 228 m, north 0 – 247 m of the site plan's centre, which the seed sets to
 * `CAMPUS_CENTER`, so scene metres are the seed's metres. Scene axes are `x` east and `z` = −north, hence the sign.
 * It holds the Library, the Data Center, the Science Lab, the Utility Plant, two sides of the loop road and the
 * north-east part of the Central Lawn.
 */
export const QUARTER: Bounds = { minX: 0, maxX: 228, minZ: -247, maxZ: 0 };

/** The ground materials of the quarter (V3-13.1's list, the kinds that occur in the box). */
export type GroundMaterial = 'ground' | 'asphalt' | 'lawn' | 'paving' | 'concrete';

export const GROUND_MATERIALS: readonly GroundMaterial[] = [
  'ground',
  'asphalt',
  'lawn',
  'paving',
  'concrete',
];

/** V3-13.1's material per zone kind, for the kinds in the quarter; a kind not listed is left flat. */
const MATERIAL_BY_KIND: Partial<Record<Zone['kind'], GroundMaterial>> = {
  outdoor: 'lawn',
  building: 'paving',
  utility: 'concrete',
};

export const materialOfKind = (kind: Zone['kind']): GroundMaterial | undefined =>
  MATERIAL_BY_KIND[kind];

/**
 * A ring clipped to an axis-aligned box (Sutherland–Hodgman, one edge of the box at a time). Exact for a convex
 * ring; the demo's zones are rectangles and rounded rectangles, so that is all the slice needs. An empty result
 * means the ring is outside the box.
 */
export function clipRingToBox(ring: readonly Local[], box: Bounds): Local[] {
  type Edge = { inside: (p: Local) => boolean; cut: (a: Local, b: Local) => Local };
  const along = (a: Local, b: Local, t: number): Local => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ];
  const edges: Edge[] = [
    {
      inside: ([x]) => x >= box.minX,
      cut: (a, b) => along(a, b, (box.minX - a[0]) / (b[0] - a[0])),
    },
    {
      inside: ([x]) => x <= box.maxX,
      cut: (a, b) => along(a, b, (box.maxX - a[0]) / (b[0] - a[0])),
    },
    {
      inside: ([, z]) => z >= box.minZ,
      cut: (a, b) => along(a, b, (box.minZ - a[1]) / (b[1] - a[1])),
    },
    {
      inside: ([, z]) => z <= box.maxZ,
      cut: (a, b) => along(a, b, (box.maxZ - a[1]) / (b[1] - a[1])),
    },
  ];
  let points: Local[] = [...ring];
  for (const { inside, cut } of edges) {
    if (points.length === 0) break;
    const kept: Local[] = [];
    points.forEach((current, i) => {
      const previous = points[(i + points.length - 1) % points.length]!;
      if (inside(current)) {
        if (!inside(previous)) kept.push(cut(previous, current));
        kept.push(current);
      } else if (inside(previous)) {
        kept.push(cut(previous, current));
      }
    });
    points = kept;
  }
  return points.length >= 3 ? points : [];
}

/**
 * A ground mesh (`y = 0`) clipped to `box`: every triangle is clipped as a ring and fanned again. The vertices are
 * not shared between triangles; the slice's meshes are small enough for that not to matter.
 */
export function clipMeshToBox({ positions, indices }: Mesh, box: Bounds): Mesh {
  const out: Mesh = { positions: [], indices: [] };
  const at = (index: number): Local => [positions[index * 3]!, positions[index * 3 + 2]!];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const clipped = clipRingToBox([at(indices[t]!), at(indices[t + 1]!), at(indices[t + 2]!)], box);
    if (clipped.length === 0) continue;
    const base = out.positions.length / 3;
    for (const [x, z] of clipped) out.positions.push(x, 0, z);
    for (let k = 1; k + 1 < clipped.length; k += 1) out.indices.push(base, base + k, base + k + 1);
  }
  return out;
}

/** The quarter's zone rings (clipped to the box) by ground material. */
export function quarterZoneRings(
  zones: readonly Zone[],
  frame: Frame,
): Map<GroundMaterial, Local[][]> {
  const rings = new Map<GroundMaterial, Local[][]>();
  // `flatZones` gives each ring open and counter-clockwise, as the ground's own fills use it.
  for (const { kind, ring } of flatZones(zones, frame)) {
    const material = materialOfKind(kind);
    if (material === undefined) continue;
    const clipped = clipRingToBox(ring, QUARTER);
    if (clipped.length === 0) continue;
    rings.set(material, [...(rings.get(material) ?? []), clipped]);
  }
  return rings;
}

/**
 * Planar UVs for a ground mesh, in world metres (V3-13.1: no UV attribute is stored on the real ground; the spike
 * writes one because three's stock material reads it). One texture repeat every `tileM` metres; `v` grows to the
 * north so the texture is not mirrored.
 */
export function planarUvs(positions: readonly number[], tileM: number): number[] {
  const uvs: number[] = [];
  for (let v = 0; v + 2 < positions.length; v += 3) {
    uvs.push(positions[v]! / tileM, -positions[v + 2]! / tileM);
  }
  return uvs;
}
