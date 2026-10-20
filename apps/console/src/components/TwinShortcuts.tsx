import { useCallback, useMemo } from 'react';
import { useAssets, useIncident } from '../api/queries';
import { flyToSelection } from '../lib/twinFlight';
import { selectionTargetOf } from '../lib/twinSelection';
import { useShortcut } from '../lib/useShortcut';
import { useTwinCapability } from '../lib/useTwinCapability';
import { useConsole } from '../store';

/** `V`: the other view. A function of the store at the moment of the press, so its identity never changes. */
function toggleView() {
  const { view, setView } = useConsole.getState();
  setView(view === '3d' ? '2d' : '3d');
}

/**
 * The two single-key shortcuts of the 3D view (V2-18.2, frame 16): `V` switches between 3D and 2D, `F` flies to the
 * selection. Both are character keys, so `useShortcut` turns them off with the account menu's switch (WCAG 2.1.4) and
 * ignores them in text fields, with modifiers, on repeat, during IME composition and inside a dialog; both are
 * listed in `lib/shortcuts.ts` (V2-18.1) and read nothing about the user's role, as choosing a view and flying a
 * camera act on nothing.
 *
 * `F` has three meanings by place (phase-0 decision 7) and is registered **once**, here, with one handler that
 * chooses from what is selected (`selectionTargetOf`): the part, else the asset ("Focus"), else the incident's asset
 * ("Show in 3D") or its beacon. So no registration order decides which meaning wins. It is enabled only with a
 * target, so with nothing selected it does nothing and no control advertises it; the hints on those controls
 * (`Button`'s `shortcut`) are drawn only where that is true.
 *
 * `V` stays honoured while the report form is picking a place: the pick (`picking` in the store) carries over to the
 * 2D map ("Pick on map"), so leaving 3D strands nothing.
 *
 * A component of its own and long lived, like `TelemetryWatchSet` (it reads the same queries, so it adds no request):
 * `App` mounts it for the whole session, in the main chunk; the camera is reached through `lib/twinFlight.ts`, never
 * the canvas.
 */
export function TwinShortcuts() {
  const twinAvailable = useTwinCapability().available;
  const selectedPart = useConsole((s) => s.selectedPart);
  const selectedAssetCode = useConsole((s) => s.selectedAssetCode);
  const selectedIncidentId = useConsole((s) => s.selectedIncidentId);
  const { data: incident } = useIncident(selectedIncidentId);
  const { data: assets } = useAssets();
  const assetId = incident?.assetId;

  // Rebuilt only when the selection or the catalogue changes, so `useShortcut` does not re-add its listener on each
  // render (it needs a stable handler).
  const target = useMemo(
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
  const flyToTarget = useCallback(() => {
    if (target !== null) flyToSelection(target);
  }, [target]);

  useShortcut('v', toggleView, twinAvailable);
  useShortcut('f', flyToTarget, twinAvailable && target !== null);
  return null;
}
