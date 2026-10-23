import type { SitePlan, Zone } from '@occ/contracts';
import { useEffect, useMemo } from 'react';
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute } from 'three';
import {
  buildGround,
  GROUND_LAYERS,
  type GroundData,
  type GroundLayerName,
  type Mesh,
  type TaggedMesh,
} from '../lib/twin-core/twinGround';
import type { Frame } from '../lib/twin-core/twinScene';
import { mapColors, twinColors } from '../styles/tokens';

/** One colour per layer; the zone fills carry theirs per vertex instead. */
const LAYER_COLORS: Partial<Record<GroundLayerName, string>> = {
  boundaryFill: twinColors.ground,
  grid: twinColors.grid,
  boundaryLine: mapColors.site.boundaryLine,
  roads: twinColors.road,
  fieldLines: mapColors.site.fieldLine,
  parkingRows: mapColors.site.parkingLine,
  // A footprint's outline is the building's idle edge; the building itself covers it from V2-12.7.
  footprints: twinColors.edge,
  zoneOutlines: mapColors.zoneOutline,
};

type Geometries = Partial<Record<GroundLayerName, BufferGeometry>>;

function meshGeometry({ positions, indices }: Mesh, vertexColors?: number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  if (vertexColors) geometry.setAttribute('color', new Float32BufferAttribute(vertexColors, 3));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * Segment pairs as a geometry. A dashed material needs the distance along each line at every
 * vertex, which is what `LineSegments.computeLineDistances` writes: 0 at a segment's start and its
 * length at its end, so every segment starts a fresh dash.
 */
function lineGeometry(segments: number[], dashed: boolean): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(segments, 3));
  if (dashed) {
    const distances: number[] = [];
    for (let i = 0; i + 5 < segments.length; i += 6) {
      const length = Math.hypot(
        segments[i + 3]! - segments[i]!,
        segments[i + 4]! - segments[i + 1]!,
        segments[i + 5]! - segments[i + 2]!,
      );
      distances.push(0, length);
    }
    geometry.setAttribute('lineDistance', new Float32BufferAttribute(distances, 1));
  }
  return geometry;
}

/**
 * The zone fills' colour per vertex, in the working colour space: `Color` converts the token's sRGB
 * hex, whereas writing the bytes / 255 into the attribute would read as linear and come out too
 * light. A kind this build does not know takes the outdoor fill, as the 2D map does.
 */
function zoneColors({ keys }: TaggedMesh<Zone['kind']>): number[] {
  const fills: Record<string, string> = mapColors.zoneFill;
  const byKind = new Map<string, number[]>();
  return keys.flatMap((kind) => {
    let rgb = byKind.get(kind);
    if (rgb === undefined) {
      rgb = new Color(fills[kind] ?? mapColors.zoneFill.outdoor).toArray();
      byKind.set(kind, rgb);
    }
    return rgb;
  });
}

function groundGeometries(ground: GroundData): Geometries {
  const geometries: Geometries = {};
  for (const { name, primitive, dash } of GROUND_LAYERS) {
    const data = ground[name];
    const empty = Array.isArray(data) ? data.length === 0 : data.positions.length === 0;
    if (empty) continue;
    if (Array.isArray(data)) geometries[name] = lineGeometry(data, dash !== undefined);
    else if (primitive === 'mesh') {
      geometries[name] = meshGeometry(
        data,
        name === 'zoneFills' ? zoneColors(ground.zoneFills) : undefined,
      );
    }
  }
  return geometries;
}

interface GroundProps {
  plan: SitePlan | undefined;
  zones: readonly Zone[];
  frame: Frame;
}

/**
 * The campus ground (V2-12.6): the site boundary, a 50 m grid, roads, zone fills, field markings,
 * parking rows and the outlines, in the 2D map's colours and order. Nine layers are nine draw calls.
 *
 * - The layers are coplanar at `y = 0`, ordered by `renderOrder` and writing no depth, so there is no
 *   z-fighting and whatever stands on the ground (V2-12.7) is drawn over it (`lib/twin-core/twinGround.ts`).
 * - Unlit basic materials: the ground reads as its token, whatever the lights do.
 * - The geometries are built once per data change and disposed when replaced or unmounted; R3F does
 *   not dispose a geometry it was handed as a prop.
 */
export function Ground({ plan, zones, frame }: GroundProps) {
  const geometries = useMemo(
    () => groundGeometries(buildGround(plan, zones, frame)),
    [plan, zones, frame],
  );
  useEffect(
    () => () => {
      for (const geometry of Object.values(geometries)) geometry.dispose();
    },
    [geometries],
  );

  return (
    <>
      {GROUND_LAYERS.map(({ name, primitive, dash }, renderOrder) => {
        const geometry = geometries[name];
        if (geometry === undefined) return null;
        const color = LAYER_COLORS[name];
        if (primitive === 'mesh') {
          return (
            <mesh key={name} geometry={geometry} renderOrder={renderOrder}>
              <meshBasicMaterial
                color={color}
                vertexColors={name === 'zoneFills'}
                side={DoubleSide}
                depthWrite={false}
              />
            </mesh>
          );
        }
        return (
          <lineSegments key={name} geometry={geometry} renderOrder={renderOrder}>
            {dash ? (
              <lineDashedMaterial
                color={color}
                dashSize={dash.dashM}
                gapSize={dash.gapM}
                depthWrite={false}
              />
            ) : (
              <lineBasicMaterial color={color} depthWrite={false} />
            )}
          </lineSegments>
        );
      })}
    </>
  );
}
