import { useEffect, useMemo } from 'react';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { buildBoxGeometry } from '../lib/twinBoxes';
import { GROUND_LAYERS } from '../lib/twinGround';
import { type PlacedAsset, visibleAssets } from '../lib/twinPlacement';
import { twinColors } from '../styles/tokens';

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
}

/**
 * The equipment (V2-14.6, frame 15): every asset the level shows as a neutral box of its class's footprint,
 * standing where `placeAssets` put it, as **one merged mesh** and **one merged `LineSegments`**: two draw
 * calls however many assets. Models replace the boxes class by class from V2-14.7. Nothing is drawn for a
 * site with no asset.
 *
 * - The faces are one material, `--tw-neutral`, shaded by the two lights (`Lights`); the outline is
 *   `--tw-edge`, unlit. The faces are pushed back a little (`polygonOffset`) so the outline wins on the
 *   borders instead of z-fighting with them, as on the shells.
 * - The mesh keeps the per-box ranges as `userData.ranges` (`lib/twinBoxes.ts`): the table that colouring by
 *   state (V2-14.9) and picking (V2-15.3) read, so neither needs a mesh per asset.
 * - The geometries are built once per data change and disposed when replaced or unmounted; R3F does not
 *   dispose a geometry it was handed as a prop.
 */
export function AssetBoxes({ assets, focusedZoneId = null }: AssetBoxesProps) {
  const boxes = useMemo(() => {
    const { positions, normals, indices, edges, ranges } = buildBoxGeometry(
      visibleAssets(assets, focusedZoneId),
    );
    if (ranges.length === 0) return null;
    const faces = new BufferGeometry();
    faces.setAttribute('position', new Float32BufferAttribute(positions, 3));
    faces.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    faces.setIndex(indices);
    const outline = new BufferGeometry();
    outline.setAttribute('position', new Float32BufferAttribute(edges, 3));
    return { faces, outline, ranges };
  }, [assets, focusedZoneId]);

  useEffect(
    () => () => {
      boxes?.faces.dispose();
      boxes?.outline.dispose();
    },
    [boxes],
  );

  if (boxes === null) return null;
  return (
    <>
      <mesh geometry={boxes.faces} renderOrder={FACES_ORDER} userData={{ ranges: boxes.ranges }}>
        <meshLambertMaterial
          color={twinColors.neutral}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      <lineSegments geometry={boxes.outline} renderOrder={OUTLINE_ORDER}>
        <lineBasicMaterial color={twinColors.edge} />
      </lineSegments>
    </>
  );
}
