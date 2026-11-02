import { useMemo } from 'react';
import { useAssets, useZones } from '../../api/queries';
import { useConsole } from '../../store';
import { focusAvailable } from './twinFocus';

/** What the camera rail's "Focus" acts on: the selected asset, and its selected part when there is one. */
export interface FocusableSelection {
  assetCode: string;
  part: string | null;
}

/**
 * The asset or part the rail's "Focus" would fly to (V3-10.2), or `null` when the button is not offered.
 *
 * It is `AssetFoot`'s rule, derived a second time for a second entry (the inspector's foot and the rail are
 * two buttons for one command): an asset is selected, the catalogue knows it, and `focusAvailable` says the scene
 * draws it in the 3D view. An incident with no asset selected is `null` here even though `F` can frame an
 * incident's asset or beacon (`useSelectionTarget`): the rail's button is for the asset or part you are looking
 * at, and the `F` hint on it is only true for that. A third caller is the moment to give `AssetFoot` this hook.
 *
 * It reads the store through single-field selectors and the two reference queries the lists already fill, and the
 * result is memoised on them, so the rail re-renders for a change of selection and for nothing the canvas does.
 */
export function useFocusableSelection(): FocusableSelection | null {
  const view = useConsole((s) => s.view);
  const selectedAssetCode = useConsole((s) => s.selectedAssetCode);
  const selectedPart = useConsole((s) => s.selectedPart);
  const focusZoneId = useConsole((s) => s.focusZoneId);
  const { data: assets } = useAssets();
  const { data: zones } = useZones();

  return useMemo(() => {
    if (selectedAssetCode === null) return null;
    const asset = assets?.find((candidate) => candidate.code === selectedAssetCode);
    if (!asset) return null;
    const zone = zones?.find((candidate) => candidate.id === asset.zoneId);
    if (!focusAvailable({ view, asset, zone, focusZoneId, selectedPart })) return null;
    return { assetCode: asset.code, part: selectedPart };
  }, [view, selectedAssetCode, selectedPart, focusZoneId, assets, zones]);
}
