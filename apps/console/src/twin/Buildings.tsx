import type { Zone } from '@occ/contracts';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferGeometry, Float32BufferAttribute, type Mesh } from 'three';
import { buildShellGeometry } from '../lib/twinBuildings';
import { GROUND_LAYERS } from '../lib/twinGround';
import { hoveredShellZone } from '../lib/twinHover';
import type { PlacedAsset } from '../lib/twinPlacement';
import { buildingTable } from '../lib/twinPicking';
import { buildingShells, type Frame } from '../lib/twinScene';
import { twinColors } from '../styles/tokens';
import { usePicker } from './PickContext';
import { createShellColours, paintShell } from './shellLooks';
import { useHoverRef } from './useHoverRef';

/** After the last ground layer; the faces and then their outline. */
const FACES_ORDER = GROUND_LAYERS.length;
const OUTLINE_ORDER = FACES_ORDER + 1;

interface BuildingsProps {
  zones: readonly Zone[];
  frame: Frame;
  /** Every asset, placed: the building of a hovered `inside` asset takes the hover tint (V2-15.5). */
  assets: readonly PlacedAsset[];
}

/**
 * The buildings (V2-12.7): every `building` zone extruded from the 2D map's footprint to its height
 * (ADR-0020, V2-12.1), as **one merged mesh** and **one merged `LineSegments`**: two draw calls for the
 * whole campus, however many buildings. Nothing is drawn for a site with no building.
 *
 * - The faces are one white material with a colour per vertex (V2-15.5), `--tw-top` for every building, shaded by
 *   the two lights (`Lights`): the top face reads as the token and the walls get the other two tones. The
 *   vertex colours are what the hover tint writes to (`shellLooks.ts`): the building of a hovered `inside`
 *   asset, which is not drawn at campus level, takes `--tw-hover-top` while the asset is hovered. The outline
 *   is `--tw-edge`, unlit.
 * - The faces are pushed back a little (`polygonOffset`) so the outline wins on the borders instead of
 *   z-fighting with them. Unlike the ground, the shells write depth: they occlude what is behind.
 * - The mesh keeps the per-building ranges as `userData.ranges` (`lib/twinBuildings.ts`): the table
 *   that picking, the see-through look (V2-15.8) and the heat colouring (V2-17.3) read, so none of
 *   them needs a mesh per building. The faces are registered with the picker as they are (V2-15.3): a
 *   ray is cast at the mesh that is drawn, and a hit's triangle names its building through that table.
 * - The geometries are built once per data change and disposed when replaced or unmounted; R3F does not
 *   dispose a geometry it was handed as a prop.
 */
export function Buildings({ zones, frame, assets }: BuildingsProps) {
  const picker = usePicker();
  const hover = useHoverRef();
  // The tint last painted, and into which shell: a rebuilt shell starts idle.
  const painted = useRef<{ shell: object | null; zone: string | null }>({
    shell: null,
    zone: null,
  });
  const faces = useRef<Mesh>(null);
  const shell = useMemo(() => {
    const { positions, normals, indices, edges, ranges } = buildShellGeometry(
      buildingShells(zones, frame),
    );
    if (ranges.length === 0) return null;
    const colours = createShellColours(positions.length / 3);
    const faces = new BufferGeometry();
    faces.setAttribute('position', new Float32BufferAttribute(positions, 3));
    faces.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    faces.setAttribute('color', colours);
    faces.setIndex(indices);
    const outline = new BufferGeometry();
    outline.setAttribute('position', new Float32BufferAttribute(edges, 3));
    return { faces, outline, ranges, colours };
  }, [zones, frame]);

  useEffect(
    () => () => {
      shell?.faces.dispose();
      shell?.outline.dispose();
    },
    [shell],
  );

  // The hover tint (V2-15.5): follows the hovered asset's building, repainting only when the zone changes.
  useFrame(() => {
    if (shell === null) return;
    const last = painted.current;
    if (last.shell !== shell) {
      last.shell = shell;
      last.zone = null;
    }
    const zone = hoveredShellZone(hover.current.asset, assets);
    if (zone === last.zone) return;
    paintShell(shell.colours, shell.ranges, zone, last.zone);
    last.zone = zone;
  });

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
          color="#ffffff"
          vertexColors
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
