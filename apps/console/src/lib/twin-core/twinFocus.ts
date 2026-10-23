import type { Asset, Zone } from '@occ/contracts';
import type { FitBox, Vec3 } from './twinCamera';
import { twinCommands } from './twinCommands';
import { focusOf, presenceOf } from './twinLevel';
import { placementOf } from './twinPlacement';
import type { ViewChoice } from './shell/viewChoice';

/*
 * "Focus" (V2-15.11, ADR-0020 "Settled in V2-15.11"): flying the camera to the selected part, else to the
 * isolated asset, from the controls outside the canvas (the inspector's foot, a Parts row). Those are main-chunk
 * code and may not import `three`, while a part's bounds only exist in the canvas, so this module is the seam: the
 * canvas registers a *resolver* (which box is this part or asset?) and the caller asks to focus; the flight itself is
 * the camera's `fitAsset`, unchanged. Plain module state, like `lib/twinCommands.ts`: nothing renders from it.
 */

/**
 * The fit box of a world-space box given by its corners (`Box3.min` and `.max`): the ground rectangle, how tall it
 * stands and the height of its base, which is what `fitAsset` takes. An empty box is the caller's to skip.
 */
export function fitBoxOf(min: Vec3, max: Vec3): FitBox {
  return {
    bounds: { minX: min[0], maxX: max[0], minZ: min[2], maxZ: max[2] },
    heightM: max[1] - min[1],
    baseM: min[1],
  };
}

/**
 * Whether the inspector offers "Focus" for `asset`: in the 3D view only (the 2D view has no camera to move), and only
 * when the scene draws the asset at all. The one case the scene does not draw a selected asset is an `inside` one
 * whose building is not in focus (`presenceOf`: `hidden`), which can happen while the zones are still on their way.
 * The asset is the inspector's own, so the rule does not depend on which asset the store calls selected.
 */
export function focusAvailable({
  view,
  asset,
  zone,
  focusZoneId,
  selectedPart,
}: {
  view: ViewChoice;
  asset: Pick<Asset, 'code' | 'zoneId' | 'position' | 'elevationM'>;
  zone: Zone | undefined;
  focusZoneId: string | null;
  selectedPart: string | null;
}): boolean {
  if (view !== '3d') return false;
  const focus = focusOf({ focusZoneId, selectedAssetCode: asset.code, selectedPart });
  const presence = presenceOf(
    {
      kind: 'asset',
      code: asset.code,
      zoneId: asset.zoneId,
      placement: placementOf(asset, zone),
    },
    focus,
  );
  return presence !== 'hidden';
}

/**
 * Answers "which box?" for an asset and, when given, one of its parts: the part's box, else the asset's, else
 * `null` (nothing drawn to fly to).
 */
export type FocusResolver = (assetCode: string, part: string | null) => FitBox | null;

let resolver: FocusResolver | null = null;

/**
 * Makes `next` the resolver. Returns what takes it away again, which clears the registration **only if it is still
 * this one**, so a canvas that was replaced does not undo its successor when its own cleanup runs late
 * (`registerTwinCommands` does the same).
 */
export function registerFocusResolver(next: FocusResolver): () => void {
  resolver = next;
  return () => {
    if (resolver === next) resolver = null;
  };
}

/**
 * Flies to `part` of `assetCode`, or to the asset when `part` is `null` or the model has no such node. Does nothing
 * with no canvas (the 2D view, a stage that has not loaded) or nothing to look at, like every `twinCommands` call.
 */
export function focusSelection(assetCode: string, part: string | null): void {
  const box = resolver?.(assetCode, part);
  if (box) twinCommands.fitAsset(box);
}
