import type { Zone } from '@occ/contracts';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { BufferGeometry, Float32BufferAttribute, type Mesh } from 'three';
import { buildShellGeometry } from '../lib/twinBuildings';
import { GROUND_LAYERS } from '../lib/twinGround';
import type { HeatScene } from '../lib/twinHeat';
import { hoveredShellZone } from '../lib/twinHover';
import { groupsForLooks, type Span } from '../lib/twinGroups';
import { type HeatFade, presenceOf } from '../lib/twinLevel';
import { GHOST_OPACITY, XRAY_OPACITY } from '../lib/twinMaterials';
import type { PlacedAsset } from '../lib/twinPlacement';
import { buildingTable } from '../lib/twinPicking';
import { buildingShells, type Frame } from '../lib/twinScene';
import { twinColors } from '../styles/tokens';
import { usePicker } from './PickContext';
import { applyGroups } from './applyGroups';
import { createShellColours, paintHeat, paintShell } from './shellLooks';
import { useHoverRef } from './useHoverRef';
import { useSceneFocus } from './useSceneFocus';

/** After the last ground layer; the faces and then their outline. */
const FACES_ORDER = GROUND_LAYERS.length;
const OUTLINE_ORDER = FACES_ORDER + 1;

interface BuildingsProps {
  zones: readonly Zone[];
  frame: Frame;
  /** Every asset, placed: the building of a hovered `inside` asset takes the hover tint (V2-15.5). */
  assets: readonly PlacedAsset[];
  /** The heat overlay (V2-17.3), or `null` while it is not shown: the shells' colours, and which ones fade. */
  heat: HeatScene | null;
}

/** No asset is lifted out of anything for a building: the overlay's lifted codes are the equipment's. */
const NO_CODES: ReadonlySet<string> = new Set();

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
 * - With a building in focus or an asset isolated (V2-15.7, V2-15.8) the buildings are not all drawn as they are: the
 *   faces and the outline each have **three** materials (as they are, faded to `--tw-ghost-opacity`, see-through)
 *   and the geometry's **groups** say which building is drawn with which, by the ranges above. The building in
 *   focus is see-through (`Xray`: the idle face at `--tw-xray-opacity`, its outline `--tw-hub`, frames 12 and 15) so
 *   the equipment inside shows, at building, asset and part level; every other building is faded. Nothing is
 *   rebuilt and the picking table does not move (so a focus rebuilds no geometry); the faded and see-through groups
 *   are transparent and write no depth, so they never hide what is inside or behind them. `lib/twinLevel.ts`
 *   (`presenceOf`) is the rule. The look is a material per group, not a colour: the colour attribute is the building's
 *   own colour, under the hover tint.
 * - With the heat overlay shown (V2-17.3, `heat`) the attribute holds each building's ramp colour (`paintHeat`) and a
 *   building with no reading is faded at campus level, by the same groups: no new mesh, material or geometry, only the
 *   attribute written and the group list re-applied when the overlay changes (it is one object while nothing in it
 *   does, `useHeatScene`). At building level the see-through shell's outline takes the building's ramp colour in place
 *   of `--tw-hub`. With `null` the shells are as they were.
 * - The geometries are built once per data change and disposed when replaced or unmounted; R3F does not
 *   dispose a geometry it was handed as a prop.
 */
export function Buildings({ zones, frame, assets, heat }: BuildingsProps) {
  const picker = usePicker();
  const hover = useHoverRef();
  const focus = useSceneFocus();
  const invalidate = useThree((state) => state.invalidate);
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
    // The runs of each building in the two buffers: triangles are three indices, a segment two vertices.
    const faceSpans: Span[] = ranges.map((r) => ({
      start: r.firstTriangle * 3,
      count: r.triangleCount * 3,
    }));
    const outlineSpans: Span[] = ranges.map((r) => ({
      start: r.firstSegment * 2,
      count: r.segmentCount * 2,
    }));
    const faceTotal = indices.length;
    const outlineTotal = edges.length / 3;
    // Born with everything as it is: the groups follow the focus in the effect below, without a rebuild.
    applyGroups(faces, groupsForLooks(faceSpans, [], faceTotal));
    applyGroups(outline, groupsForLooks(outlineSpans, [], outlineTotal));
    return { faces, outline, ranges, colours, faceSpans, outlineSpans, faceTotal, outlineTotal };
  }, [zones, frame]);

  useEffect(
    () => () => {
      shell?.faces.dispose();
      shell?.outline.dispose();
    },
    [shell],
  );

  // What the heat overlay changes about how the buildings are drawn (V2-17.3): the ones with no reading fade at campus
  // level. `null` while the overlay is not shown. One object while the overlay's key is equal, so the groups below are
  // re-applied for a change of the picture and not once a second.
  const fade = useMemo<HeatFade | null>(
    () => (heat === null ? null : { silent: heat.silent, lifted: NO_CODES }),
    [heat],
  );

  // The look of each building (V2-15.7, V2-15.8, V2-17.3): see-through for the one in focus, faded for the others, as it
  // is with nothing in focus, and with the overlay shown the ones with no reading faded too. A layout effect, so a shell
  // born while a building is already in focus has its groups before its first frame.
  useLayoutEffect(() => {
    if (shell === null) return;
    const looks = shell.ranges.map(({ zoneId }) =>
      presenceOf({ kind: 'building', zoneId }, focus, fade),
    );
    applyGroups(shell.faces, groupsForLooks(shell.faceSpans, looks, shell.faceTotal));
    applyGroups(shell.outline, groupsForLooks(shell.outlineSpans, looks, shell.outlineTotal));
    invalidate();
  }, [shell, focus, fade, invalidate]);

  // Each building's own colour (V2-17.3): its ramp colour while the overlay is shown, idle otherwise. Written to the
  // attribute only, when the overlay changes or a shell is born (a rebuilt shell starts idle); the building under the
  // hover tint keeps the tint. Asks for a frame, because a sleeping on-demand canvas draws nothing by itself.
  useLayoutEffect(() => {
    if (shell === null) return;
    const hovered = painted.current.shell === shell ? painted.current.zone : null;
    paintHeat(shell.colours, shell.ranges, heat?.colours ?? null, hovered);
    invalidate();
  }, [shell, heat, invalidate]);

  // The hover tint (V2-15.5): follows the hovered asset's building, repainting only when the zone changes. An `inside`
  // asset that is not drawn lights its building: at campus level, with another building in focus, and (V2-15.9) in
  // the focused building with the `Inside` layer off, where the shell is opaque.
  useFrame(() => {
    if (shell === null) return;
    const last = painted.current;
    if (last.shell !== shell) {
      last.shell = shell;
      last.zone = null;
    }
    const zone = hoveredShellZone(hover.current.asset, assets, focus);
    if (zone === last.zone) return;
    paintShell(shell.colours, shell.ranges, zone, last.zone, heat?.colours ?? null);
    last.zone = zone;
  });

  // The mesh is registered while it is the one drawn: a new shell registers again, and the old one goes.
  useEffect(() => {
    if (picker === null || shell === null || faces.current === null) return;
    return picker.addTable(faces.current, buildingTable(shell.ranges));
  }, [picker, shell]);

  if (shell === null) return null;
  const focused = focus?.zoneId ?? null;
  const edgeColour = (focused === null ? undefined : heat?.colours.get(focused)) ?? twinColors.hub;
  return (
    <>
      <mesh
        ref={faces}
        geometry={shell.faces}
        renderOrder={FACES_ORDER}
        userData={{ ranges: shell.ranges }}
      >
        {/* Group 0 is a building as it is, 1 one faded, 2 the one in focus, see-through (`applyGroups`). */}
        <meshLambertMaterial
          attach="material-0"
          color="#ffffff"
          vertexColors
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
        <meshLambertMaterial
          attach="material-1"
          color="#ffffff"
          vertexColors
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
          transparent
          opacity={GHOST_OPACITY}
          depthWrite={false}
        />
        <meshLambertMaterial
          attach="material-2"
          color="#ffffff"
          vertexColors
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
          transparent
          opacity={XRAY_OPACITY}
          depthWrite={false}
        />
      </mesh>
      <lineSegments geometry={shell.outline} renderOrder={OUTLINE_ORDER}>
        <lineBasicMaterial attach="material-0" color={twinColors.edge} />
        <lineBasicMaterial
          attach="material-1"
          color={twinColors.edge}
          transparent
          opacity={GHOST_OPACITY}
          depthWrite={false}
        />
        {/* The see-through building keeps a clear outline: it is what shows where its walls are (frame 12). With the
            overlay shown it carries the building's ramp colour (V2-17.3, ADR-0020 "Settled in V2-17.1"). */}
        <lineBasicMaterial attach="material-2" color={edgeColour} />
      </lineSegments>
    </>
  );
}
