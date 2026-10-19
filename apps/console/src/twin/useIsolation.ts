import { useMemo } from 'react';
import { type Isolation, isolationOf } from '../lib/twinLevel';
import { useConsole } from '../store';

/**
 * The asset isolated and its building (V2-15.7), or `null`: what the canvas fades the rest for. Read from the
 * store as two values and memoised on them, so the object changes only when the isolated asset or the building in
 * focus does: a hover renders nothing here, and a part being selected is no change (the asset stays isolated at part
 * level). The store is a plain external store, so the hook is safe inside the canvas, as in `CameraMarkers`.
 *
 * It is React state on purpose, unlike the hover (`useHoverRef`): the fade is a change of the meshes' groups and of
 * a few materials, once per selection, not a paint per frame.
 */
export function useIsolation(): Isolation | null {
  const assetCode = useConsole((state) => state.selectedAssetCode);
  const zoneId = useConsole((state) => state.focusZoneId);
  return useMemo(
    () => isolationOf({ selectedAssetCode: assetCode, focusZoneId: zoneId, selectedPart: null }),
    [assetCode, zoneId],
  );
}
