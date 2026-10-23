import { useConsole } from '../../store';
import { twinCommands } from './twinCommands';
import { focusSelection } from './twinFocus';
import type { SelectionTarget } from './twinSelection';

/*
 * "Switch to the 3D view if you can, then fly" (V2-16.6 "Show in 3D", V2-18.2 `F`): the one place that knows it, so
 * a button and a key cannot drift. It reads the store outside React, like the other callers of `setView`, and is
 * the only module here that does: `twinCommands.ts` stays a leaf (the registry) and `twinFocus.ts` stays free of the
 * store (it is the part and asset flight's seam). The reset (`resetView`) sits here for the same reason: it changes the
 * level in the store and then asks for the camera.
 */

/**
 * Reset (Home, V2-15.1): back to the campus level and the home view. The level goes first, so an asset is
 * deselected and a building left (an open incident and a report form stay), and the camera flies home even
 * when the level was campus already, because the operator may have orbited away. The Reset button and the `Home` key
 * (V2-18.3) both call it.
 */
export function resetView(): void {
  useConsole.getState().goCampus();
  twinCommands.home();
}

/**
 * Makes sure the 3D view is the one in effect, and says whether it is. `setView` does nothing where 3D cannot be
 * drawn (no WebGL 2, a lost context), so the answer is read back, not assumed.
 */
function enterTwin(): boolean {
  const { view, setView } = useConsole.getState();
  if (view !== '3d') setView('3d');
  return useConsole.getState().view === '3d';
}

/**
 * Frames the asset `code` in the 3D view, switching to it first, and selects nothing ("Show in 3D", frame 10): the
 * incident sheet stays open and the incident's beacon stays ringed. From the 2D view the stage does not exist yet, so
 * the request waits for its rig (`twinCommands.showAsset`). Does nothing where 3D is unavailable.
 */
export function showAssetIn3d(code: string): void {
  if (enterTwin()) twinCommands.showAsset(code);
}

/**
 * Flies to `target` (`selectionTargetOf`), switching to the 3D view first.
 *
 * - A part or an asset is "Focus": `focusSelection`, which needs the canvas's resolver. From the 2D view it has none
 *   yet and does nothing, and it does not need to: the store kept the selection, so the stage's first view is the
 *   asset's fit (V2-15.7). A part is not flown to from 2D; a second `F`, in 3D, does (V2-18.2, Q4).
 * - An incident's asset is "Show in 3D" (`showAssetIn3d`).
 * - Any other incident is the toast's "Fly to": its beacon, kept for the rig when there is none yet (Q1). It is not
 *   selected here: the selection is what `F` flew from.
 */
export function flyToSelection(target: SelectionTarget): void {
  switch (target.kind) {
    case 'part':
      if (enterTwin()) focusSelection(target.assetCode, target.part);
      return;
    case 'asset':
      if (enterTwin()) focusSelection(target.assetCode, null);
      return;
    case 'incident-asset':
      showAssetIn3d(target.assetCode);
      return;
    case 'incident':
      if (enterTwin()) twinCommands.flyToIncident(target.incidentId);
      return;
  }
}
