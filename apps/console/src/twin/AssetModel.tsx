import { useMemo } from 'react';
import type { PlacedAsset } from '../lib/twinPlacement';
import { type ClassTemplate, instantiate } from './classModel';

interface AssetModelProps {
  /** The class's model, ready (`useClassModels`). */
  template: ClassTemplate;
  /** The assets of this class to draw, placed and posed (`placeAssets`). */
  assets: readonly PlacedAsset[];
}

/**
 * One class's model, once per asset (V2-14.7, frames 03 and 08): a copy of the template at the asset's pose,
 * its base on `pose.y`, centred on `pose.x`, `pose.z` and turned by `pose.rotationY`. The copies share the
 * template's geometry and materials, so a class costs its file once however many assets stand in it; each has
 * its own bound parts, which V2-14.8 moves.
 *
 * The scene graph objects are `<primitive>`s: R3F does not dispose what it is handed that way, which is right
 * here, because the template owns the geometry and `useClassModels` frees it with the stage.
 */
export function AssetModel({ template, assets }: AssetModelProps) {
  const copies = useMemo(
    () => assets.map((asset) => ({ asset, object: instantiate(template) })),
    [template, assets],
  );
  return (
    <>
      {copies.map(({ asset, object }) => (
        <primitive
          key={asset.code}
          object={object}
          position={[asset.pose.x, asset.pose.y, asset.pose.z]}
          rotation-y={asset.pose.rotationY}
        />
      ))}
    </>
  );
}
