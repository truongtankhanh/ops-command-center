import { useMemo, useState } from 'react';
import type { Incident } from '@occ/contracts';
import { useAssets, useIncidents } from '../api/queries';
import type { TelemetryState } from '../lib/telemetry/telemetryState';
import { buildingReadings, type HeatScene, heatSceneOf, showsHeat } from '../lib/twinHeat';
import { levelOf } from '../lib/twinLevel';
import { useServerNow, useTelemetryStore } from '../realtime/telemetryStore';
import { useConsole } from '../store';
import { twinColors } from '../styles/tokens';
import type { TwinScene } from './useTwinScene';

const NO_OVERVIEW: TelemetryState['assets'] = {};
const NO_INCIDENTS: readonly Incident[] = [];

/**
 * The heat overlay as data (V2-17.3, ADR-0020 "Settled in V2-17.1" and "V2-17.3"): what the shells, the equipment, the
 * labels and the 3D view's name each draw or say, or `null` when the overlay is not shown. Read by the stage and handed
 * down, because `<Canvas>` renders in its own reconciler where a query hook has no client (as `useTwinBeacons`).
 *
 * - **Shown** is the layer being on and the level being campus or building (`showsHeat`): with an asset isolated, or one
 *   of its parts, the layer stays on and draws nothing different. Read as one boolean from the store, so a change of
 *   anything else renders nothing here.
 * - **Costs nothing while it is off.** Off, the hook subscribes to neither the overview nor the clock: the overview
 *   arrives every second and `useServerNow` ticks every second, and a stage that followed them for a layer nobody
 *   asked for would render once a second for nothing.
 * - **Nothing is said that is not known.** Until the scene and the catalogue are there it is `null`, not "every
 *   building is silent". The incidents only decide which equipment is spared the ghost, so a list still on its way
 *   reads as none, as the building card does.
 * - **One object while nothing changes.** The readings are recomputed every second, because the clock ticks, and most
 *   seconds change nothing a reader draws. The previous scene is kept while its `key` is equal, so a reader that
 *   repaints on a change of identity repaints on a change of the picture, and the on-demand canvas stays asleep.
 */
export function useHeatScene(scene: TwinScene | null): HeatScene | null {
  const shown = useConsole((state) => state.layers.heat && showsHeat(levelOf(state)));
  const { data: assets } = useAssets();
  const { data: incidents } = useIncidents();
  const overview = useTelemetryStore((state) => (shown ? state.view.state.assets : NO_OVERVIEW));
  const serverNow = useServerNow(shown);

  const next = useMemo(() => {
    if (!shown || scene === null || assets === undefined) return null;
    const readings = buildingReadings(scene.zones, assets, overview, serverNow);
    return heatSceneOf({
      zones: scene.zones,
      readings,
      assets,
      incidents: incidents ?? NO_INCIDENTS,
      stops: twinColors.heat,
    });
  }, [shown, scene, assets, incidents, overview, serverNow]);

  // The scene held across renders (the documented "keep the previous state while it is equal" pattern): a new object
  // with the same key is dropped, so the result below keeps its identity.
  const [held, setHeld] = useState<HeatScene | null>(null);
  if ((held?.key ?? null) !== (next?.key ?? null)) setHeld(next);
  return held !== null && next !== null && held.key === next.key ? held : next;
}
