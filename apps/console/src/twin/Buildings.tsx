import type { Zone } from '@occ/contracts';
import { useEffect, useMemo, useRef } from 'react';
import { BufferGeometry, Float32BufferAttribute, type Mesh } from 'three';
import { buildShellGeometry } from '../lib/twinBuildings';
import { GROUND_LAYERS } from '../lib/twinGround';
import { buildingTable } from '../lib/twinPicking';
import { buildingShells, type Frame } from '../lib/twinScene';
import { twinColors } from '../styles/tokens';
import { usePicker } from './PickContext';

/** After the last ground layer; the faces and then their outline. */
const FACES_ORDER = GROUND_LAYERS.length;
const OUTLINE_ORDER = FACES_ORDER + 1;

interface BuildingsProps {
  zones: readonly Zone[];
  frame: Frame;
}

/**
 * The buildings (V2-12.7): every `building` zone extruded from the 2D map's footprint to its height
 * (ADR-0020, V2-12.1), as **one merged mesh** and **one merged `LineSegments`**: two draw calls for the
 * whole campus, however many buildings. Nothing is drawn for a site with no building.
 *
 * - The faces are one material, `--tw-top`, shaded by the two lights (`Lights`): the top face reads as
 *   the token and the walls get the other two tones. The outline is `--tw-edge`, unlit.
 * - The faces are pushed back a little (`polygonOffset`) so the outline wins on the borders instead of
 *   z-fighting with them. Unlike the ground, the shells write depth: they occlude what is behind.
 * - The mesh keeps the per-building ranges as `userData.ranges` (`lib/twinBuildings.ts`): the table
 *   that picking, the see-through look (V2-15.8) and the heat colouring (V2-17.3) read, so none of
 *   them needs a mesh per building. The faces are registered with the picker as they are (V2-15.3): a
 *   ray is cast at the mesh that is drawn, and a hit's triangle names its building through that table.
 * - The geometries are built once per data change and disposed when replaced or unmounted; R3F does not
 *   dispose a geometry it was handed as a prop.
 */
export function Buildings({ zones, frame }: BuildingsProps) {
  const picker = usePicker();
  const faces = useRef<Mesh>(null);
  const shell = useMemo(() => {
    const { positions, normals, indices, edges, ranges } = buildShellGeometry(
      buildingShells(zones, frame),
    );
    if (ranges.length === 0) return null;
    const faces = new BufferGeometry();
    faces.setAttribute('position', new Float32BufferAttribute(positions, 3));
    faces.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    faces.setIndex(indices);
    const outline = new BufferGeometry();
    outline.setAttribute('position', new Float32BufferAttribute(edges, 3));
    return { faces, outline, ranges };
  }, [zones, frame]);

  useEffect(
    () => () => {
      shell?.faces.dispose();
      shell?.outline.dispose();
    },
    [shell],
  );

  // The mesh is registered while it is the one drawn: a new shell registers again, and the old one goes.
  useEffect(() => {
    if (picker === null || shell === null || faces.current === null) return;
    return picker.addTable(faces.current, buildingTable(shell.ranges));
  }, [picker, shell]);

  if (shell === null) return null;
  return (
    <>
      <mesh
        ref={faces}
        geometry={shell.faces}
        renderOrder={FACES_ORDER}
        userData={{ ranges: shell.ranges }}
      >
        <meshLambertMaterial
          color={twinColors.idle.top}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      <lineSegments geometry={shell.outline} renderOrder={OUTLINE_ORDER}>
        <lineBasicMaterial color={twinColors.edge} />
      </lineSegments>
    </>
  );
}
