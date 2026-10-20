import { useEffect, useMemo } from 'react';
import { Box3 } from 'three';
import { fitBoxOf, registerFocusResolver } from '../lib/twinFocus';
import { assetBoxes } from '../lib/twinLevelCamera';
import type { PlacedAsset } from '../lib/twinPlacement';
import type { ModelInstance } from './AssetModel';

/** One box for every call: the resolver allocates nothing. */
const bounds = new Box3();

/**
 * Tells "Focus" (V2-15.11, `lib/twinFocus.ts`) where things are. The inspector's foot and the Parts rows live outside
 * the canvas and cannot read a model, so the canvas registers the one place that can: given an asset and maybe one of
 * its parts, the resolver answers with the box the camera should fit. A part's box is its **world bounds at the moment
 * of the call** (a spinning blade is where it is now; the pose and the parent's transforms are in it), else the
 * asset's own box (`assetBoxes`, the one the camera flies to on selection). An asset or a node that is not drawn (not
 * in `instances`, or a model without that node, or an empty box) falls back to the asset's box, and an asset the
 * scene does not hold gives `null`, so nothing flies.
 *
 * Renders nothing and holds no state; the registration follows the placed assets and the drawn instances.
 */
export function useFocusTargets(
  assets: readonly PlacedAsset[],
  instances: readonly Pick<ModelInstance, 'assetCode' | 'object'>[],
): void {
  const fits = useMemo(() => assetBoxes(assets), [assets]);

  useEffect(
    () =>
      registerFocusResolver((assetCode, part) => {
        if (part !== null) {
          const node = instances
            .find((instance) => instance.assetCode === assetCode)
            ?.object.getObjectByName(part);
          if (node !== undefined) {
            bounds.setFromObject(node);
            if (!bounds.isEmpty()) {
              return fitBoxOf(
                [bounds.min.x, bounds.min.y, bounds.min.z],
                [bounds.max.x, bounds.max.y, bounds.max.z],
              );
            }
          }
        }
        return fits.get(assetCode) ?? null;
      }),
    [fits, instances],
  );
}
