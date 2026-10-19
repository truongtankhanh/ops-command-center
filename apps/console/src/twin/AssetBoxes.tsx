import { useThree } from '@react-three/fiber';
import { type RefObject, useEffect, useMemo, useRef } from 'react';
import type { Mesh } from 'three';
import { GROUND_LAYERS } from '../lib/twinGround';
import { groupsFor, keepIndex } from '../lib/twinGroups';
import type { HoverState } from '../lib/twinHover';
import { type Isolation, isFaded } from '../lib/twinLevel';
import { EDGE_DASH_M, EDGE_GAP_M, GHOST_OPACITY } from '../lib/twinMaterials';
import { type PlacedAsset, visibleAssets } from '../lib/twinPlacement';
import { boxTable } from '../lib/twinPicking';
import type { TwinFeed } from '../realtime/twinFeed';
import { applyGroups } from './applyGroups';
import { usePicker } from './PickContext';
import { type BoxLayers, createBoxLayers, useBoxLooks } from './useAssetLooks';

/**
 * After the ground (0 – 8), the buildings (9, 10) and the markers (11), so nothing here moves `Markers`'s
 * slot. The boxes write depth like the shells, so what is behind one stays behind it whatever the order.
 */
const FACES_ORDER = GROUND_LAYERS.length + 3;
const OUTLINE_ORDER = FACES_ORDER + 1;

/** The run of each box in the faces' index: a triangle is three indices. */
const spansOf = ({ ranges }: BoxLayers) =>
  ranges.map((range) => ({ start: range.firstTriangle * 3, count: range.triangleCount * 3 }));

/** How many indices the faces draw. */
const faceTotalOf = ({ faces }: BoxLayers): number => faces.index?.count ?? 0;

interface AssetBoxesProps {
  /** Every asset, placed (`useTwinScene`); this component draws the ones the level shows. */
  assets: readonly PlacedAsset[];
  /**
   * The building in focus, whose `inside` assets are drawn too. `null` is campus level: only `outdoor` and
   * `roof` assets. Nothing sets it before V2-15.8.
   */
  focusedZoneId?: string | null;
  /** The telemetry feed whose flags the boxes' looks follow (V2-14.9); `null` while there is no client. */
  feed: TwinFeed | null;
  /** The hover the canvas keeps from the store (`useHoverRef`): a hovered box takes the hover look (V2-15.5). */
  hover: RefObject<HoverState>;
  /**
   * The asset isolated and its building (V2-15.7), or `null`: every box but the isolated asset's is faded (and, as
   * the asset may have a model and no box, all of them are when it is not among them).
   */
  isolation?: Isolation | null;
}

/**
 * The equipment (V2-14.6, frame 15): every asset the level shows as a neutral box of its class's footprint,
 * standing where `placeAssets` put it, as **one merged mesh** of faces and **two** merged line layers (a solid
 * one and a dashed one that is empty until a box is stale): two draw calls when nothing is stale, three at
 * most, however many assets. Models replace the boxes class by class from V2-14.7. Nothing is drawn for a site
 * with no asset.
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
 * - While an asset is isolated (V2-15.7) the other boxes are faded to `--tw-ghost-opacity`: the faces mesh has two
 *   materials (as they are, faded) and the geometry's **groups** say which box is drawn with which, by the ranges
 *   above. Nothing is rebuilt and the picking table does not move; the faded faces are transparent and write no
 *   depth. A faded box draws no outline (`useBoxLooks`).
 * - The geometries are built once per data change and disposed when replaced or unmounted; R3F does not
 *   dispose a geometry it was handed as a prop.
 */
export function AssetBoxes({
  assets,
  focusedZoneId = null,
  feed,
  hover,
  isolation = null,
}: AssetBoxesProps) {
  const picker = usePicker();
  const invalidate = useThree((state) => state.invalidate);
  const faces = useRef<Mesh>(null);
  const layers = useMemo(() => {
    const visible = visibleAssets(assets, focusedZoneId);
    if (visible.length === 0) return null;
    const created = createBoxLayers(visible);
    // Born with everything as it is: the groups follow the isolation in the effect below, without a rebuild.
    applyGroups(created.faces, groupsFor(spansOf(created), null, faceTotalOf(created)));
    return created;
  }, [assets, focusedZoneId]);

  useEffect(
    () => () => {
      layers?.faces.dispose();
      layers?.solid.dispose();
      layers?.dashed.dispose();
    },
    [layers],
  );

  // The fade (V2-15.7): the isolated box is drawn as it is and the rest faded; with none of them isolated, all faded.
  useEffect(() => {
    if (layers === null) return;
    const keep = keepIndex(layers.ranges, isolation !== null, (range) =>
      isFaded({ kind: 'asset', code: range.code }, isolation),
    );
    applyGroups(layers.faces, groupsFor(spansOf(layers), keep, faceTotalOf(layers)));
    invalidate();
  }, [layers, isolation, invalidate]);

  // The looks of stale, alarm and hover, painted into the layers from the feed's flags and the hover (V2-14.9, V2-15.5).
  useBoxLooks(feed, layers, hover, isolation);

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
