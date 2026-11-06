import type { SitePlan, Zone } from '@occ/contracts';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  type InstancedMesh,
  MeshLambertMaterial,
  Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ROAD_WIDTH_M } from '../../lib/map/sitePlan';
import { GROUND_LAYERS } from '../../lib/twin-core/twinGround';
import type { PlacedAsset } from '../../lib/twin-core/twinPlacement';
import { flatZones, type Frame, type Local, siteLines } from '../../lib/twin-core/twinScene';
import type { TreeDensity } from './sliceFlags';
import { QUARTER } from './sliceQuarter';

/*
 * SPIKE (V3-11.5): the slice's trees, one `InstancedMesh` (one draw call) of a procedural tree (decision Q2 (a): no
 * file is fetched; the real tree, a glTF of V3-13.2, would add one request). Not a shadow caster (decision D4: the
 * settled casters are the shells and the equipment).
 *
 * Densities (V3-11.1): `1` is the frames' one tree a hectare, six in the quarter, placed by hand; `2` is ten times
 * that, the six plus 54 from a seeded generator, a headroom reading and not a look. Every position, hand-placed or not,
 * is kept clear of every zone that is not a lawn, of the roads and of every asset by `CLEAR_M`; one that is not clear
 * is dropped, and the count drawn is logged for V3-11.6.
 */

/** Trees per density. */
const COUNT: Record<TreeDensity, number> = { 0: 0, 1: 6, 2: 60 };

/** The tree's triangle cap (V3-13.1's placeholder). */
const MAX_TRIANGLES = 300;

/** How far a tree's trunk stays from a building or other zone, a road's edge and an asset, in metres. */
const CLEAR_M = 6;

/** Six positions by hand, [east, north] metres from the campus centre (`x` = east, `z` = −north in the scene). */
const HAND_PLACED: readonly [east: number, north: number][] = [
  [25, 20],
  [60, 10],
  [30, 70],
  [95, 120],
  [160, 110],
  [200, 130],
];

const TRUNK = '#5b4636';
const CROWN = '#2f5a3c';

function coloured(geometry: BufferGeometry, hex: string): BufferGeometry {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const count = geometry.getAttribute('position').count;
  const colours: number[] = [];
  for (let v = 0; v < count; v += 1) colours.push(r, g, b);
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
  return geometry;
}

/** A trunk and two stacked cones, about 8 m tall, merged into one geometry of at most `MAX_TRIANGLES`. */
function treeGeometry(): { geometry: BufferGeometry; triangles: number } {
  const trunk = coloured(
    new CylinderGeometry(0.25, 0.35, 2.6, 8, 1, true).translate(0, 1.3, 0),
    TRUNK,
  );
  const lower = coloured(new ConeGeometry(2.6, 4.2, 16, 3).translate(0, 4.1, 0), CROWN);
  const upper = coloured(new ConeGeometry(1.9, 3.4, 16, 3).translate(0, 6.3, 0), CROWN);
  const parts = [trunk, lower, upper];
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (geometry === null) throw new Error('[slice] the tree parts could not be merged');
  const triangles = (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
  if (triangles > MAX_TRIANGLES) {
    throw new Error(`[slice] the tree has ${triangles} triangles, over ${MAX_TRIANGLES}`);
  }
  return { geometry, triangles };
}

/** A small seeded PRNG (mulberry32), so every load places the same trees. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distanceToSegment([px, pz]: Local, [ax, az]: Local, [bx, bz]: Local): number {
  const dx = bx - ax;
  const dz = bz - az;
  const length2 = dx * dx + dz * dz;
  const t =
    length2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / length2));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function insideRing([px, pz]: Local, ring: readonly Local[]): boolean {
  let inside = false;
  ring.forEach(([ax, az], i) => {
    const [bx, bz] = ring[(i + 1) % ring.length]!;
    if (az > pz !== bz > pz && px < ((bx - ax) * (pz - az)) / (bz - az) + ax) inside = !inside;
  });
  return inside;
}

interface Obstacles {
  /** Rings of every zone a tree may not stand in or near: everything but a lawn. */
  zones: Local[][];
  /** Road centre lines, each a polyline. */
  roads: Local[][];
  assets: Local[];
}

function isClear(point: Local, { zones, roads, assets }: Obstacles): boolean {
  const [x, z] = point;
  if (x < QUARTER.minX + CLEAR_M || x > QUARTER.maxX - CLEAR_M) return false;
  if (z < QUARTER.minZ + CLEAR_M || z > QUARTER.maxZ - CLEAR_M) return false;
  for (const ring of zones) {
    if (insideRing(point, ring)) return false;
    if (ring.some((a, i) => distanceToSegment(point, a, ring[(i + 1) % ring.length]!) < CLEAR_M)) {
      return false;
    }
  }
  for (const line of roads) {
    for (let i = 0; i + 1 < line.length; i += 1) {
      if (distanceToSegment(point, line[i]!, line[i + 1]!) < ROAD_WIDTH_M / 2 + CLEAR_M)
        return false;
    }
  }
  return assets.every(([ax, az]) => Math.hypot(x - ax, z - az) >= CLEAR_M);
}

/** The trees' positions for `density`: the hand-placed ones that are clear, then seeded ones up to the count. */
function treePositions(density: TreeDensity, obstacles: Obstacles): Local[] {
  const wanted = COUNT[density];
  const placed = HAND_PLACED.map(([east, north]): Local => [east, -north])
    .filter((point) => isClear(point, obstacles))
    .slice(0, wanted);
  const random = seeded(0x51ce);
  for (let attempt = 0; placed.length < wanted && attempt < 5000; attempt += 1) {
    const point: Local = [
      QUARTER.minX + random() * (QUARTER.maxX - QUARTER.minX),
      QUARTER.minZ + random() * (QUARTER.maxZ - QUARTER.minZ),
    ];
    // Trees do not stand in each other either.
    if (
      isClear(point, obstacles) &&
      placed.every(([x, z]) => Math.hypot(point[0] - x, point[1] - z) >= CLEAR_M)
    ) {
      placed.push(point);
    }
  }
  return placed;
}

interface SliceTreesProps {
  density: TreeDensity;
  plan: SitePlan | undefined;
  zones: readonly Zone[];
  frame: Frame;
  assets: readonly PlacedAsset[];
}

export function SliceTrees({ density, plan, zones, frame, assets }: SliceTreesProps) {
  const mesh = useRef<InstancedMesh>(null);
  const tree = useMemo(() => treeGeometry(), []);
  const material = useMemo(
    () => new MeshLambertMaterial({ color: '#ffffff', vertexColors: true }),
    [],
  );
  const positions = useMemo(
    () =>
      treePositions(density, {
        zones: flatZones(zones, frame)
          .filter(({ kind }) => kind !== 'outdoor')
          .map(({ ring }) => ring),
        roads: siteLines(plan, zones, frame)
          .filter(({ part }) => part === 'road')
          .map(({ points }) => points),
        assets: assets.map(({ pose }): Local => [pose.x, pose.z]),
      }),
    [density, plan, zones, frame, assets],
  );

  useEffect(
    () => () => {
      tree.geometry.dispose();
      material.dispose();
    },
    [tree, material],
  );

  useEffect(() => {
    console.info(
      `[slice] trees drawn: ${positions.length} of ${COUNT[density]} (density ${density}), ${tree.triangles} triangles each`,
    );
  }, [positions, density, tree]);

  useLayoutEffect(() => {
    const instances = mesh.current;
    if (instances === null) return;
    const random = seeded(0x7ee5);
    const place = new Object3D();
    positions.forEach(([x, z], i) => {
      const scale = 0.8 + random() * 0.4;
      place.position.set(x, 0, z);
      place.rotation.set(0, random() * Math.PI * 2, 0);
      place.scale.setScalar(scale);
      place.updateMatrix();
      instances.setMatrixAt(i, place.matrix);
    });
    instances.count = positions.length;
    instances.instanceMatrix.needsUpdate = true;
    instances.computeBoundingSphere();
  }, [positions]);

  if (positions.length === 0) return null;
  return (
    <instancedMesh
      ref={mesh}
      // A new mesh when the count changes: an `InstancedMesh`'s buffer is sized once.
      key={positions.length}
      args={[tree.geometry, material, positions.length]}
      // With the shells, after the ground, which writes no depth (`Buildings`).
      renderOrder={GROUND_LAYERS.length}
    />
  );
}
