import { useCallback } from 'react';
import { flyToSelection } from '../lib/twinFlight';
import { useSelectionTarget } from '../lib/useSelectionTarget';
import { useShortcut } from '../lib/useShortcut';
import { useTwinCapability } from '../lib/useTwinCapability';
import { useConsole } from '../store';

/** `V`: the other view. A function of the store at the moment of the press, so its identity never changes. */
function toggleView() {
  const { view, setView } = useConsole.getState();
  setView(view === '3d' ? '2d' : '3d');
}

/** `P`: the other drag tool. A function of the store at the moment of the press, so its identity never changes. */
function togglePanTool() {
  useConsole.getState().togglePanTool();
}

/**
 * The single-key shortcuts of the 3D view (V2-18.2, frame 16; `P` is V3-29's): `V` switches between 3D and 2D, `F` flies to
 * the selection, `P` switches the drag between Orbit and Pan. Both are character keys, so `useShortcut` turns them off with the account menu's switch (WCAG 2.1.4) and
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
  const target = useSelectionTarget();
  const flyToTarget = useCallback(() => {
    if (target !== null) flyToSelection(target);
  }, [target]);

  useShortcut('v', toggleView, twinAvailable);
  useShortcut('f', flyToTarget, twinAvailable && target !== null);
  // `P`: the drag's tool, Orbit or Pan (V3-29). Acts on the camera only, so it reads nothing about the role.
  useShortcut('p', togglePanTool, twinAvailable);
  return null;
}
