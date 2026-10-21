import { useMemo } from 'react';
import type { Asset } from '@occ/contracts';
import { useAssets, useIncidents } from '../api/queries';
import { type Beacon, beaconsOf } from '../lib/twinBeacons';
import { useConsole } from '../store';
import type { TwinScene } from './useTwinScene';

const NO_BEACONS: readonly Beacon[] = [];
const NO_ASSETS: readonly Asset[] = [];

/**
 * The incident beacons of the scene (V2-16.3): the incidents the 2D map draws, in scene metres (`beaconsOf`). Read
 * by the stage and handed to the canvas, because `<Canvas>` renders in its own reconciler where a query hook has no
 * client (as `useTwinScene` and `useTwinFeed`); the selected incident comes from the store. Memoised on its inputs,
 * so it changes when an incident, the catalogue, the zones or the selection does, not when anything else renders.
 * Empty while the scene or the incidents are on their way; with no catalogue yet an incident of an asset is placed
 * by its position and moves to the asset's top when the catalogue arrives (V2-16.2).
 */
export function useTwinBeacons(scene: TwinScene | null): readonly Beacon[] {
  const { data: incidents } = useIncidents();
  const { data: assets } = useAssets();
  // On a video wall nothing is ever selected (that opens a sheet): the incident the camera is on gets the ring (V2-21.8).
  const selectedId = useConsole((state) =>
    state.wall === null ? state.selectedIncidentId : state.wallFocusId,
  );

  return useMemo(
    () =>
      scene === null || incidents === undefined
        ? NO_BEACONS
        : beaconsOf({
            incidents,
            selectedId,
            assets: assets ?? NO_ASSETS,
            zones: scene.zones,
            frame: scene.frame,
          }),
    [scene, incidents, assets, selectedId],
  );
}
