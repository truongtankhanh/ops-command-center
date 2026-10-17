import { fillTriangles } from './twinGround';
import { type Shell, signedAreaM2 } from './twinScene';

/*
 * The buildings' shells as plain buffers: every building extruded from its footprint, merged into one
 * triangle mesh and one list of edge segments, with no `three` and no WebGL, so what WebGL cannot test
 * here (the walls' winding and normals, the roofs, the ranges) is tested without it (ADR-0020).
 * `twin/Buildings.tsx` only wraps these arrays in geometries. V2-15.3's pick proxy reads the same
 * positions and indices, so it needs no second extrusion.
 *
 * Positions are flat `[x, y, z, …]` in scene metres (x east, y up, z = −north); indices are triples.
 * A building of an `n`-gon footprint is:
 *
 * - `n` walls, a quad per edge (4 vertices, 2 triangles, the wall's outward normal), and
 * - a roof of its own `n` vertices at the building's height, normal +y, `n − 2` triangles,
 *
 * so `5n` vertices and `3n − 2` triangles, and `3n` edge segments (the bottom ring, the top ring and a
 * vertical line at each corner). Walls and roof share no vertex, so every face is flat-shaded by its
 * normal rather than smoothed across a corner.
 */

/** Where one building's data sits in the merged buffers. Every range is contiguous, in shell order. */
export interface ShellRange {
  zoneId: string;
  firstVertex: number;
  vertexCount: number;
  firstTriangle: number;
  triangleCount: number;
  /** In segments: segment `s` is the six numbers from `edges[6 * s]`. */
  firstSegment: number;
  segmentCount: number;
}

export interface ShellGeometry {
  positions: number[];
  normals: number[];
  indices: number[];
  /** Segment pairs `[x1, y1, z1, x2, y2, z2, …]`. */
  edges: number[];
  /**
   * One entry per building, in the shells' order: what a later task needs to find a building's vertices
   * (to colour or fade it: V2-15.8, V2-17.3), its triangles (to name what a ray hit: V2-15.3) and its edges.
   */
  ranges: ShellRange[];
}

/**
 * Extrudes `shells`. A ring is expected counter-clockwise on the map, as `buildingShells` returns it; a
 * clockwise one is reversed so the walls still face outward. A ring with fewer than three points has no
 * area and is left out, with no range.
 */
export function buildShellGeometry(shells: readonly Shell[]): ShellGeometry {
  const geometry: ShellGeometry = {
    positions: [],
    normals: [],
    indices: [],
    edges: [],
    ranges: [],
  };
  const { positions, normals, indices, edges } = geometry;

  for (const { zoneId, ring: given, heightM } of shells) {
    if (given.length < 3) continue;
    const ring = signedAreaM2(given) < 0 ? [...given].reverse() : given;
    const firstVertex = positions.length / 3;
    const firstTriangle = indices.length / 3;
    const firstSegment = edges.length / 6;

    ring.forEach(([ax, az], i) => {
      const [bx, bz] = ring[(i + 1) % ring.length]!;
      // Walking a counter-clockwise ring, the outside is on the right: for an edge `(dx, dz)` that is
      // `(−dz, dx)`. A south wall (along +x on the map's south edge) faces +z, south. Written as
      // `(az − bz)` rather than `−(bz − az)` so a wall along an axis gets +0, not −0.
      const length = Math.hypot(bx - ax, bz - az) || 1;
      const [nx, nz] = [(az - bz) / length, (bx - ax) / length];
      const base = positions.length / 3;
      positions.push(ax, 0, az, bx, 0, bz, bx, heightM, bz, ax, heightM, az);
      for (let corner = 0; corner < 4; corner += 1) normals.push(nx, 0, nz);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);

      edges.push(
        ax,
        0,
        az,
        bx,
        0,
        bz,
        ax,
        heightM,
        az,
        bx,
        heightM,
        bz,
        ax,
        0,
        az,
        ax,
        heightM,
        az,
      );
    });

    // The roof: the footprint triangulated (any simple ring), lifted from the ground to the top.
    const roof = fillTriangles([{ ring, key: null }]);
    const roofBase = positions.length / 3;
    for (let v = 0; v < roof.positions.length; v += 3) {
      positions.push(roof.positions[v]!, heightM, roof.positions[v + 2]!);
      normals.push(0, 1, 0);
    }
    for (const index of roof.indices) indices.push(roofBase + index);

    geometry.ranges.push({
      zoneId,
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
