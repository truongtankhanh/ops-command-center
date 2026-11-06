import type { SitePlan, Zone } from '@occ/contracts';
import { useEffect, useMemo } from 'react';
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from 'three';
import {
  buildGround,
  fillTriangles,
  GROUND_LAYERS,
  type Mesh,
} from '../../lib/twin-core/twinGround';
import type { Frame } from '../../lib/twin-core/twinScene';
import { mapColors, twinColors } from '../../styles/tokens';
import { useSliceFlags } from './sliceFlags';
import {
  clipMeshToBox,
  type GroundMaterial,
  planarUvs,
  QUARTER,
  quarterZoneRings,
} from './sliceQuarter';
import { useSliceTextureSet } from './SliceScope';

/*
 * SPIKE (V3-11.5): the quarter's ground with V3-13.1's materials, one mesh (one draw call) per material, drawn **over**
 * today's flat layers (decision D2): the flat fill under the quarter is still drawn, a slight over-statement of the
 * cost that the learned list records. Each mesh sits just above the flat layer it covers, so the grid, the boundary
 * line, the field lines and every outline keep drawing on top of it as they do on `main`.
 *
 * Lit (`MeshLambertMaterial`, decision Q3) so that it can receive the shadow. With the lights of `Lights.tsx` a face
 * looking up gets 0.60 + 0.53 × 0.75 ≈ 1.00 of its colour, so an untextured lit ground still reads as its token.
 */

/** One texture repeat, in metres. Paving is 8 × 8 slabs and concrete 2 × 2 panels per repeat (`slice-textures.ts`). */
const TILE_M: Record<GroundMaterial, number> = {
  ground: 16,
  asphalt: 8,
  lawn: 6,
  paving: 8,
  concrete: 8,
};

/** The flat layer each material covers, by name: its mesh is drawn just after it (`renderOrder` + 0.5). */
const COVERS: Record<GroundMaterial, (typeof GROUND_LAYERS)[number]['name']> = {
  ground: 'boundaryFill',
  asphalt: 'roads',
  lawn: 'zoneFills',
  paving: 'zoneFills',
  concrete: 'zoneFills',
};

/** The token colour of each material: the colour the flat layer under it draws. */
const COLOUR: Record<GroundMaterial, string> = {
  ground: twinColors.ground,
  asphalt: twinColors.road,
  lawn: mapColors.zoneFill.outdoor,
  paving: mapColors.zoneFill.building,
  concrete: mapColors.zoneFill.utility,
};

const orderOf = (material: GroundMaterial): number =>
  GROUND_LAYERS.findIndex(({ name }) => name === COVERS[material]) + 0.5;

function groundGeometry({ positions, indices }: Mesh, tileM: number): BufferGeometry | null {
  if (indices.length === 0) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const up: number[] = [];
  for (let v = 0; v < positions.length / 3; v += 1) up.push(0, 1, 0);
  geometry.setAttribute('normal', new Float32BufferAttribute(up, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(planarUvs(positions, tileM), 2));
  geometry.setIndex(indices);
  return geometry;
}

interface SliceGroundProps {
  plan: SitePlan | undefined;
  zones: readonly Zone[];
  frame: Frame;
}

export function SliceGround({ plan, zones, frame }: SliceGroundProps) {
  const { shadow } = useSliceFlags();
  const textures = useSliceTextureSet();
  const geometries = useMemo(() => {
    const ground = buildGround(plan, zones, frame);
    const rings = quarterZoneRings(zones, frame);
    const meshes: Record<GroundMaterial, Mesh> = {
      ground: clipMeshToBox(ground.boundaryFill, QUARTER),
      asphalt: clipMeshToBox(ground.roads, QUARTER),
      lawn: fillTriangles((rings.get('lawn') ?? []).map((ring) => ({ ring, key: null }))),
      paving: fillTriangles((rings.get('paving') ?? []).map((ring) => ({ ring, key: null }))),
      concrete: fillTriangles((rings.get('concrete') ?? []).map((ring) => ({ ring, key: null }))),
    };
    const built: [GroundMaterial, BufferGeometry][] = [];
    for (const [material, mesh] of Object.entries(meshes) as [GroundMaterial, Mesh][]) {
      const geometry = groundGeometry(mesh, TILE_M[material]);
      if (geometry) built.push([material, geometry]);
    }
    return built;
  }, [plan, zones, frame]);

  useEffect(
    () => () => {
      for (const [, geometry] of geometries) geometry.dispose();
    },
    [geometries],
  );

  return (
    <>
      {geometries.map(([material, geometry]) => (
        <mesh
          key={material}
          geometry={geometry}
          renderOrder={orderOf(material)}
          receiveShadow={shadow}
        >
          {/* `key` on the map: a material compiled without a map does not pick one up later without a rebuild. */}
          <meshLambertMaterial
            key={textures[material] ? 'mapped' : 'flat'}
            color={COLOUR[material]}
            map={textures[material] ?? null}
            side={DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}
    </>
  );
}
