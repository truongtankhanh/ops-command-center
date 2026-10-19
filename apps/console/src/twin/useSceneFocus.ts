import { useMemo } from 'react';
import { focusOf, type SceneFocus } from '../lib/twinLevel';
import { useConsole } from '../store';

/**
 * What the scene is looking at (V2-15.8): the building in focus and, at asset and part level, the isolated asset, or
 * `null` at campus level. It is what `presenceOf` (`lib/twinLevel.ts`) turns into how every building, box, model and
 * marker is drawn. Read from the store as two values and memoised on them, so the object changes only when the focused
 * building or the selected asset does: a hover renders nothing here, and a part being selected is no change (the asset
 * stays isolated at part level). The store is a plain external store, so the hook is safe inside the canvas, as
 * `useIsolation` and `CameraMarkers` already are.
 *
 * It is React state on purpose, unlike the hover (`useHoverRef`): a change of focus is a change of the meshes' groups,
 * the instances shown and a few materials, once per selection, not a paint per frame.
 */
export function useSceneFocus(): SceneFocus | null {
  const assetCode = useConsole((state) => state.selectedAssetCode);
  const zoneId = useConsole((state) => state.focusZoneId);
  return useMemo(
    () => focusOf({ selectedAssetCode: assetCode, focusZoneId: zoneId, selectedPart: null }),
    [assetCode, zoneId],
  );
}
