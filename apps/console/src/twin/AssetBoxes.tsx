import { useThree } from '@react-three/fiber';
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { Mesh } from 'three';
import { GROUND_LAYERS } from '../lib/twinGround';
import { groupsForLooks } from '../lib/twinGroups';
import type { HoverState } from '../lib/twinHover';
import type { Presence } from '../lib/twinLevel';
import { EDGE_DASH_M, EDGE_GAP_M, GHOST_OPACITY } from '../lib/twinMaterials';
import type { PlacedAsset } from '../lib/twinPlacement';
import { boxTable } from '../lib/twinPicking';
import type { TwinFeed } from '../realtime/twinFeed';
import { applyGroups } from './applyGroups';
import { usePicker } from './PickContext';
import { type BoxLayers, createBoxLayers, useBoxLooks } from './useAssetLooks';

/**
 * After the ground (0 – 8), the buildings (9, 10) and the markers (11), so nothing here moves `Markers`'s
 * slot. The boxes write depth like the shells, so what is behind one stays behind it whatever the order. A
 * transparent see-through shell (renderOrder 9, 10) is drawn before the faded boxes (12) and after every opaque
 * thing, so the opaque boxes inside a focused building show through its walls.
 */
const FACES_ORDER = GROUND_LAYERS.length + 3;
const OUTLINE_ORDER = FACES_ORDER + 1;

/** The run of each box in the faces' index: a triangle is three indices. */
const spansOf = ({ ranges }: BoxLayers) =>
  ranges.map((range) => ({ start: range.firstTriangle * 3, count: range.triangleCount * 3 }));

/** How many indices the faces draw. */
const faceTotalOf = ({ faces }: BoxLayers): number => faces.index?.count ?? 0;

interface AssetBoxesProps {
  /**
   * Every asset that is drawn as a box (`Equipment`: the ones with no model), `inside` ones included. The geometry is
   * built from all of them once and never for a change of focus; which are drawn is `presences`' answer (V2-15.8).
   */
  assets: readonly PlacedAsset[];
  /** The telemetry feed whose flags the boxes' looks follow (V2-14.9); `null` while there is no client. */
  feed: TwinFeed | null;
  /** The hover the canvas keeps from the store (`useHoverRef`): a hovered box takes the hover look (V2-15.5). */
  hover: RefObject<HoverState>;
  /**
   * How each asset is drawn at this level (`presenceMap`, V2-15.8): `drawn` as it is, `faded` at `--tw-ghost-opacity`,
   * `hidden` not at all (an `inside` box of a building that is not in focus). A code the map does not name is drawn.
   */
  presences: ReadonlyMap<string, Presence>;
}

/**
 * The equipment (V2-14.6, frame 15): every asset as a neutral box of its class's footprint, standing where
 * `placeAssets` put it, as **one merged mesh** of faces and **two** merged line layers (a solid one and a dashed one
 * that is empty until a box is stale). Which boxes the level shows is `presences`' (V2-15.8), applied as groups of the
 * faces and as the outline index lists, so a focus costs one draw call per group (`lib/twinGroups.ts`) and rebuilds
 * nothing. Models replace the boxes class by class from V2-14.7. Nothing is drawn for a site with no asset.
 *
 * - The colours are per vertex (V2-14.9): the faces' material is white and Lambert, shaded by the two lights
 *   (`Lights`), so a vertex colour is the colour of the face; the outline is unlit. `useBoxLooks` rewrites the
 *   colours of one asset's range when its look changes (stale grey, the severity tint, the severity edge, the hover).
 * - The two line layers share their vertices, colours and line distances and have their own index: the
 *   segments of a stale asset are in the dashed layer, all the others in the solid one (`edgeIndices`).
 * - The faces are pushed back a little (`polygonOffset`) so the outline wins on the borders instead of
 *   z-fighting with them, as on the shells.
 * - The mesh keeps the per-box ranges as `userData.ranges` (`lib/twinBoxes.ts`): the table that the looks and
 *   picking read, so neither needs a mesh per asset. The faces are registered with the picker as they are
 *   (V2-15.3), so only the boxes that are drawn can be hit, and a hit's triangle names its asset through it.
 * - The faces mesh has two materials (as they are, faded) and the geometry's **groups** say which box is drawn with
 *   which, by the ranges above (V2-15.7): the isolated asset's neighbours, and at building level the equipment of
 *   the other buildings, are faded to `--tw-ghost-opacity`, and a box that is `hidden` is in no group, so it is not
 *   drawn and, as `three-mesh-bvh` only tests the triangles inside a group, not picked (V2-15.8). Nothing is rebuilt
 *   and the picking table does not move; the faded faces are transparent and write no depth. A faded or hidden box
 *   draws no outline (`useBoxLooks`).
 * - The geometries are built once per data change and disposed when replaced or unmounted; R3F does not
 *   dispose a geometry it was handed as a prop.
 *
 * Frame demand: one-shot. An effect asks for one frame when the layers or the presences change; nothing keeps it
 *   asking. Its looks are painted in frames somebody else asked for (`useBoxLooks`, `useAssetLooks.ts`).
 */
export function AssetBoxes({ assets, feed, hover, presences }: AssetBoxesProps) {
  const picker = usePicker();
  const invalidate = useThree((state) => state.invalidate);
  const faces = useRef<Mesh>(null);
  const layers = useMemo(() => {
    if (assets.length === 0) return null;
    const created = createBoxLayers(assets);
    // Born with everything as it is: the groups follow the presences in the effect below, without a rebuild.
    applyGroups(created.faces, groupsForLooks(spansOf(created), [], faceTotalOf(created)));
    return created;
  }, [assets]);

  useEffect(
    () => () => {
      layers?.faces.dispose();
      layers?.solid.dispose();
      layers?.dashed.dispose();
    },
    [layers],
  );

  // The fade and the hiding (V2-15.7, V2-15.8): each box is drawn as it is, faded or not at all, by the groups. A layout
  // effect, so a mesh born while a building is already in focus has its groups before its first frame.
  useLayoutEffect(() => {
    if (layers === null) return;
    const looks = layers.ranges.map(({ code }) => presences.get(code) ?? 'drawn');
    applyGroups(layers.faces, groupsForLooks(spansOf(layers), looks, faceTotalOf(layers)));
    invalidate();
  }, [layers, presences, invalidate]);

  // The looks of stale, alarm and hover, painted into the layers from the feed's flags and the hover (V2-14.9, V2-15.5).
  useBoxLooks(feed, layers, hover, presences);

  // Registered while it is the mesh drawn; a rebuilt set of boxes registers again, and the old one goes.
  useEffect(() => {
    if (picker === null || layers === null || faces.current === null) return;
    return picker.addTable(faces.current, boxTable(layers.ranges));
  }, [picker, layers]);

  if (layers === null) return null;
  return (
    <>
      <mesh
        ref={faces}
        geometry={layers.faces}
        renderOrder={FACES_ORDER}
        userData={{ ranges: layers.ranges }}
      >
        {/* Group 0 is a box as it is; group 1 is one faded (`applyGroups`). */}
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
      </mesh>
      <lineSegments geometry={layers.solid} renderOrder={OUTLINE_ORDER}>
        <lineBasicMaterial vertexColors />
      </lineSegments>
      {/* Empty while no box is stale: an empty index draws nothing. */}
      <lineSegments geometry={layers.dashed} renderOrder={OUTLINE_ORDER}>
        <lineDashedMaterial vertexColors dashSize={EDGE_DASH_M} gapSize={EDGE_GAP_M} />
      </lineSegments>
    </>
  );
}
