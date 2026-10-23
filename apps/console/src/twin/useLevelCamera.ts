import { useEffect, useRef } from 'react';
import type { FitBox } from '../lib/twin-core/twinCamera';
import { twinCommands } from '../lib/twin-core/twinCommands';
import { levelCameraStep, levelKeyOf } from '../lib/twin-core/twinLevelCamera';
import { levelOf } from '../lib/twin-core/twinLevel';
import { useConsole } from '../store';

/**
 * Makes the camera follow the scene's level (V2-15.6, Q1; V2-15.7): when the operator moves to another level,
 * building or asset, the camera flies to its fit (`levelCameraStep`): the home view for the campus, the building's
 * box for a building, the asset's box for an isolated asset (another asset is another flight: the asset code is
 * part of what is watched), nothing for a part. One seam for every way the level changes: the breadcrumb and its
 * back button, the Reset button, a click on a building, a row, and later the keys (V2-18.3), none of which has to
 * remember to fly. The store does not hold the scene's data (a building's box, the stage's shape), which is why the
 * camera is not asked from its actions.
 *
 * It listens to the store outside React, so a level change renders nothing here. It reads the store alone, never
 * the data: reference data arriving does not change the level and so does not move the camera, which only moves for
 * an operator's act (`Rig`). It also does nothing at mount: the stage's first view is the rig's own
 * (`startBoxOf`, `startAssetBoxOf`). `boxes` and `assets` are read at the moment of the change, so newer ones are
 * used without resubscribing.
 */
export function useLevelCamera(
  boxes: ReadonlyMap<string, FitBox>,
  assets: ReadonlyMap<string, FitBox>,
): void {
  const latest = useRef({ boxes, assets });
  useEffect(() => {
    latest.current = { boxes, assets };
  });

  useEffect(() => {
    let previous = levelKeyOf(useConsole.getState());
    return useConsole.subscribe((state) => {
      // The store changes on every hover: look at the three things that matter before building anything.
      if (
        levelOf(state) === previous.level &&
        state.focusZoneId === previous.focusZoneId &&
        state.selectedAssetCode === previous.assetCode
      ) {
        return;
      }
      const next = levelKeyOf(state);
      const step = levelCameraStep(previous, next, latest.current.boxes, latest.current.assets);
      previous = next;
      if (step === null) return;
      switch (step.kind) {
        case 'home':
          twinCommands.home();
          return;
        case 'fit':
          twinCommands.fit(step.box);
          return;
        case 'fit-asset':
          twinCommands.fitAsset(step.box);
          return;
      }
    });
  }, []);
}
