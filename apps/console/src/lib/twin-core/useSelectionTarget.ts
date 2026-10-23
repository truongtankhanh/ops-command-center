import { useMemo } from 'react';
import { useAssets, useIncident } from '../../api/queries';
import { useConsole } from '../../store';
import { type SelectionTarget, selectionTargetOf } from './twinSelection';

/**
 * What is selected, as the target `F` flies to and the pad's centre button looks at (`selectionTargetOf`), or `null` for
 * nothing. It reads the selected incident and the asset catalogue from the cache the lists already fill, so it adds no
 * request. The result is memoised on the selection and the catalogue, so a handler built from it stays stable and
 * `useShortcut` does not re-add its listener on each render.
 */
export function useSelectionTarget(): SelectionTarget | null {
  const selectedPart = useConsole((s) => s.selectedPart);
  const selectedAssetCode = useConsole((s) => s.selectedAssetCode);
  const selectedIncidentId = useConsole((s) => s.selectedIncidentId);
  const { data: incident } = useIncident(selectedIncidentId);
  const { data: assets } = useAssets();
  const assetId = incident?.assetId;

  return useMemo(
    () =>
      selectionTargetOf({
        selectedPart,
        selectedAssetCode,
        selectedIncidentId,
        incident: assetId === undefined ? undefined : { assetId },
        assets,
      }),
    [selectedPart, selectedAssetCode, selectedIncidentId, assetId, assets],
  );
}
