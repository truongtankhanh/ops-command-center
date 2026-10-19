import { useEffect, useMemo, useRef } from 'react';
import type { Mesh } from 'three';
import { GROUND_LAYERS } from '../lib/twinGround';
import { EDGE_DASH_M, EDGE_GAP_M } from '../lib/twinMaterials';
import { type PlacedAsset, visibleAssets } from '../lib/twinPlacement';
import { boxTable } from '../lib/twinPicking';
import type { TwinFeed } from '../realtime/twinFeed';
import { usePicker } from './PickContext';
import { createBoxLayers, useBoxLooks } from './useAssetLooks';

/**
 * After the ground (0 – 8), the buildings (9, 10) and the markers (11), so nothing here moves `Markers`'s
 * slot. The boxes write depth like the shells, so what is behind one stays behind it whatever the order.
 */
const FACES_ORDER = GROUND_LAYERS.length + 3;
const OUTLINE_ORDER = FACES_ORDER + 1;

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
 *   colours of one asset's range when its look changes (stale grey, the severity tint, the severity edge).
 * - The two line layers share their vertices, colours and line distances and have their own index: the
 *   segments of a stale asset are in the dashed layer, all the others in the solid one (`edgeIndices`).
 * - The faces are pushed back a little (`polygonOffset`) so the outline wins on the borders instead of
 *   z-fighting with them, as on the shells.
 * - The mesh keeps the per-box ranges as `userData.ranges` (`lib/twinBoxes.ts`): the table that the looks and
 *   picking read, so neither needs a mesh per asset. The faces are registered with the picker as they are
 *   (V2-15.3), so only the boxes that are drawn can be hit, and a hit's triangle names its asset through it.
 * - The geometries are built once per data change and disposed when replaced or unmounted; R3F does not
 *   dispose a geometry it was handed as a prop.
 */
export function AssetBoxes({ assets, focusedZoneId = null, feed }: AssetBoxesProps) {
  const picker = usePicker();
  const faces = useRef<Mesh>(null);
  const layers = useMemo(() => {
    const visible = visibleAssets(assets, focusedZoneId);
    return visible.length === 0 ? null : createBoxLayers(visible);
  }, [assets, focusedZoneId]);

  useEffect(
    () => () => {
      layers?.faces.dispose();
      layers?.solid.dispose();
      layers?.dashed.dispose();
    },
    [layers],
  );

  // The looks of stale and alarm, painted into the layers from the feed's flags (V2-14.9).
  useBoxLooks(feed, layers);

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
        <meshLambertMaterial
          color="#ffffff"
          vertexColors
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
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
