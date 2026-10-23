import type { SitePlan, Zone } from '@occ/contracts';
import { ROAD_WIDTH_M } from './map/sitePlan';
import {
  type Bounds,
  flatZones,
  type Frame,
  type Local,
  sceneBounds,
  type SiteLine,
  siteLines,
} from './twinScene';

/*
 * The 3D ground as plain buffers: the flat layer of the scene (V2-12.6) with no `three` and no WebGL,
 * so the logic that WebGL cannot test here (road ribbons, triangulation, the grid, which part lands in
 * which layer) is tested without it. `twin/Ground.tsx` only wraps these arrays in geometries.
 *
 * Positions are flat `[x, y, z, …]` in scene metres with `y = 0`; indices are triples into them.
 *
 * Every layer is coplanar at `y = 0`. A centimetre offset would z-fight at the 900 m view distance, so
 * the layers are ordered by `renderOrder` (`GROUND_LAYERS`) and the ground writes no depth: whatever
 * stands on it (V2-12.7's buildings) is drawn after and always wins (ADR-0020).
 */

/** The grid's spacing, in metres (frame 01). */
export const GRID_STEP_M = 50;

/** Triangles in the disc that rounds a road's join or end. */
const ROUND_SEGMENTS = 12;

/** A line or a ring of the ground: `SiteLine` has this shape, and so does a zone's outline. */
export interface Polyline {
  closed: boolean;
  points: readonly Local[];
}

/** A triangle mesh on the ground. */
export interface Mesh {
  positions: number[];
  indices: number[];
}

/** A mesh whose vertices carry a caller's tag (a zone's `kind`), so one geometry can have many colours. */
export interface TaggedMesh<Key> extends Mesh {
  /** One entry per vertex. */
  keys: Key[];
}

export type GroundLayerName =
  | 'boundaryFill'
  | 'grid'
  | 'boundaryLine'
  | 'roads'
  | 'zoneFills'
  | 'fieldLines'
  | 'parkingRows'
  | 'footprints'
  | 'zoneOutlines';

export interface GroundLayer {
  name: GroundLayerName;
  primitive: 'mesh' | 'lines';
  /** Dash and gap in metres, as `LineDashedMaterial` wants them. World units, so they scale with zoom. */
  dash?: { dashM: number; gapM: number };
}

/**
 * The layers back to front: the prototype's order, with the zone fills above the roads. The index is the
 * `renderOrder`. Nine layers are nine draw calls (brief § Model contract: at most 150 per frame for the
 * whole scene; this task's share is at most 12).
 */
export const GROUND_LAYERS: readonly GroundLayer[] = [
  { name: 'boundaryFill', primitive: 'mesh' },
  { name: 'grid', primitive: 'lines' },
  // The 2D map dashes in pixels; here the dash is in metres, tuned by eye at the overview (`unverified`).
  { name: 'boundaryLine', primitive: 'lines', dash: { dashM: 6, gapM: 4 } },
  { name: 'roads', primitive: 'mesh' },
  { name: 'zoneFills', primitive: 'mesh' },
  { name: 'fieldLines', primitive: 'lines' },
  { name: 'parkingRows', primitive: 'lines', dash: { dashM: 2, gapM: 3 } },
  { name: 'footprints', primitive: 'lines' },
  { name: 'zoneOutlines', primitive: 'lines' },
];

/**
 * The grid's lines: every multiple of `GRID_STEP_M` strictly inside `bounds`, running the box's whole
 * extent the other way, as segment pairs. Empty for no box.
 */
export function gridSegments(bounds: Bounds | null): number[] {
  if (bounds === null) return [];
  const segments: number[] = [];
  const firstInside = (min: number) => (Math.floor(min / GRID_STEP_M) + 1) * GRID_STEP_M;
  for (let x = firstInside(bounds.minX); x < bounds.maxX; x += GRID_STEP_M) {
    segments.push(x, 0, bounds.minZ, x, 0, bounds.maxZ);
  }
  for (let z = firstInside(bounds.minZ); z < bounds.maxZ; z += GRID_STEP_M) {
    segments.push(bounds.minX, 0, z, bounds.maxX, 0, z);
  }
  return segments;
}

/** Each pair of consecutive points of every line, plus the closing pair of a closed one. */
function pairsOf(lines: readonly Polyline[]): [Local, Local][] {
  return lines.flatMap(({ closed, points }) => {
    const pairs: [Local, Local][] = [];
    points.forEach((from, index) => {
      const to = points[index + 1] ?? (closed && points.length > 2 ? points[0] : undefined);
      if (to !== undefined) pairs.push([from, to]);
    });
    return pairs;
  });
}

/** The lines as segment pairs `[x1, 0, z1, x2, 0, z2, …]`, for `LineSegments`. */
export function segmentsOf(lines: readonly Polyline[]): number[] {
  return pairsOf(lines).flatMap(([[x1, z1], [x2, z2]]) => [x1, 0, z1, x2, 0, z2]);
}

/** The y component of the cross product of two ground vectors: positive when `b` turns from `a` towards +x. */
const upwards = (ax: number, az: number, bx: number, bz: number) => az * bx - ax * bz;

/**
 * Appends a triangle that faces up (+y), whichever way round the caller named its corners, so a whole
 * layer has one winding and a one-sided material would still show it.
 */
function addTriangle(mesh: Mesh, a: number, b: number, c: number): void {
  const at = (i: number) => [mesh.positions[3 * i] ?? 0, mesh.positions[3 * i + 2] ?? 0] as const;
  const [ax, az] = at(a);
  const [bx, bz] = at(b);
  const [cx, cz] = at(c);
  if (upwards(bx - ax, bz - az, cx - ax, cz - az) >= 0) mesh.indices.push(a, b, c);
  else mesh.indices.push(a, c, b);
}

/**
 * Roads as flat ribbons `widthM` wide. A WebGL line is one pixel whatever its length, so a 9 m road is a
 * mesh: one quad per segment, and at every vertex a disc of the same radius that rounds the join and
 * the end, as the 2D map's round cap and join do (`mapLayers.ts`).
 */
export function roadRibbon(lines: readonly Polyline[], widthM: number = ROAD_WIDTH_M): Mesh {
  const mesh: Mesh = { positions: [], indices: [] };
  const half = widthM / 2;
  const vertex = (x: number, z: number) => mesh.positions.push(x, 0, z) / 3 - 1;

  for (const [[x1, z1], [x2, z2]] of pairsOf(lines)) {
    const length = Math.hypot(x2 - x1, z2 - z1);
    if (length === 0) continue;
    // The unit normal, scaled to half the width.
    const nx = (-(z2 - z1) / length) * half;
    const nz = ((x2 - x1) / length) * half;
    const a = vertex(x1 + nx, z1 + nz);
    const b = vertex(x1 - nx, z1 - nz);
    const c = vertex(x2 - nx, z2 - nz);
    const d = vertex(x2 + nx, z2 + nz);
    addTriangle(mesh, a, b, c);
    addTriangle(mesh, a, c, d);
  }

  for (const { points } of lines) {
    for (const [x, z] of points) {
      const centre = vertex(x, z);
      const rim = Array.from({ length: ROUND_SEGMENTS }, (_, k) => {
        const angle = (2 * Math.PI * k) / ROUND_SEGMENTS;
        return vertex(x + half * Math.cos(angle), z + half * Math.sin(angle));
      });
      rim.forEach((current, k) => addTriangle(mesh, centre, current, rim[(k + 1) % rim.length]!));
    }
  }
  return mesh;
}

/** Twice the signed area of a ring, positive when it turns in the `upwards` sense (from +z towards +x). */
function twiceArea(ring: readonly Local[]): number {
  return ring.reduce((sum, [x, z], i) => {
    const [nextX, nextZ] = ring[(i + 1) % ring.length]!;
    return sum + (nextX * z - x * nextZ);
  }, 0);
}

/**
 * The triangles of one simple polygon by ear clipping: the rings are rectangles today but a zone can
 * be any polygon. Returns indices into `ring`. A vertex that is no ear (a collinear run, or a ring that
 * crosses itself) is clipped anyway when no ear is left, so the loop always ends.
 */
function earClip(ring: readonly Local[]): [number, number, number][] {
  // Work counter-clockwise in the `upwards` sense, whichever way round the ring came.
  const order = ring.map((_, i) => i);
  if (twiceArea(ring) < 0) order.reverse();

  const point = (i: number) => ring[i]!;
  const turn = (a: number, b: number, c: number) => {
    const [ax, az] = point(a);
    const [bx, bz] = point(b);
    const [cx, cz] = point(c);
    return upwards(bx - ax, bz - az, cx - bx, cz - bz);
  };
  const inside = (p: number, a: number, b: number, c: number) =>
    turn(a, b, p) >= 0 && turn(b, c, p) >= 0 && turn(c, a, p) >= 0;
  const same = (i: number, j: number) => point(i)[0] === point(j)[0] && point(i)[1] === point(j)[1];

  const triangles: [number, number, number][] = [];
  while (order.length > 3) {
    const count = order.length;
    let clip = order.findIndex((current, k) => {
      const previous = order[(k + count - 1) % count]!;
      const next = order[(k + 1) % count]!;
      if (turn(previous, current, next) <= 0) return false;
      return !order.some(
        (other) =>
          other !== previous &&
          other !== current &&
          other !== next &&
          !same(other, previous) &&
          !same(other, current) &&
          !same(other, next) &&
          inside(other, previous, current, next),
      );
    });
    if (clip < 0) clip = 0;
    triangles.push([order[(clip + count - 1) % count]!, order[clip]!, order[(clip + 1) % count]!]);
    order.splice(clip, 1);
  }
  if (order.length === 3) triangles.push([order[0]!, order[1]!, order[2]!]);
  return triangles;
}

/**
 * The fill triangles of every ring, as one mesh. `keys[v]` is the tag of the ring that vertex `v`
 * belongs to. A ring with fewer than three points has no area and is skipped.
 */
export function fillTriangles<Key>(
  rings: readonly { ring: readonly Local[]; key: Key }[],
): TaggedMesh<Key> {
  const mesh: TaggedMesh<Key> = { positions: [], indices: [], keys: [] };
  for (const { ring, key } of rings) {
    if (ring.length < 3) continue;
    const base = mesh.keys.length;
    for (const [x, z] of ring) {
      mesh.positions.push(x, 0, z);
      mesh.keys.push(key);
    }
    for (const [a, b, c] of earClip(ring)) addTriangle(mesh, base + a, base + b, base + c);
  }
  return mesh;
}

/** Every layer of the ground as buffers (see `GROUND_LAYERS` for the order they are drawn in). */
export interface GroundData {
  boundaryFill: Mesh;
  /** Segment pairs, as `segmentsOf`. */
  grid: number[];
  boundaryLine: number[];
  roads: Mesh;
  zoneFills: TaggedMesh<Zone['kind']>;
  fieldLines: number[];
  parkingRows: number[];
  footprints: number[];
  zoneOutlines: number[];
}

/**
 * The ground for a site: the served plan's boundary, roads and fields, the footprint outlines and
 * parking rows the 2D map derives from the zones, and the zones themselves. With no plan (a 404, as
 * the 2D map tolerates) there is no boundary, road or field, and the zones still draw. With no
 * zones and no plan there is nothing to draw. A plan part this build does not know is left out.
 */
export function buildGround(
  plan: SitePlan | undefined,
  zones: readonly Zone[],
  frame: Frame,
): GroundData {
  const lines = siteLines(plan, zones, frame);
  const of = (part: SiteLine['part']) => lines.filter((line) => line.part === part);
  const boundary = of('boundary');
  const flat = flatZones(zones, frame);
  return {
    boundaryFill: fillTriangles(
      boundary.filter((line) => line.closed).map(({ points }) => ({ ring: points, key: null })),
    ),
    grid: gridSegments(sceneBounds(plan, zones, frame)),
    boundaryLine: segmentsOf(boundary),
    roads: roadRibbon(of('road')),
    zoneFills: fillTriangles(flat.map(({ ring, kind }) => ({ ring, key: kind }))),
    fieldLines: segmentsOf(of('field')),
    parkingRows: segmentsOf(of('parking-row')),
    footprints: segmentsOf(of('footprint')),
    zoneOutlines: segmentsOf(flat.map(({ ring }) => ({ closed: true, points: ring }))),
  };
}
