import { useEffect, useRef } from 'react';
import type { FitBox } from '../lib/twinCamera';
import { twinCommands } from '../lib/twinCommands';
import { levelCameraStep, levelKeyOf } from '../lib/twinLevelCamera';
import { levelOf } from '../lib/twinLevel';
import { useConsole } from '../store';

/**
 * Makes the camera follow the scene's level (V2-15.6, Q1): when the operator moves to another level or building,
 * the camera flies to its fit (`levelCameraStep`): the home view for the campus, the building's box for a
 * building, nothing yet for an asset (V2-15.7). One seam for every way the level changes: the breadcrumb and its
 * back button, the Reset button, a click on a building, a row, and later the keys (V2-18.3), none of which has to
 * remember to fly. The store does not hold the scene's data (a building's box, the stage's shape), which is why the
 * camera is not asked from its actions.
 *
 * It listens to the store outside React, so a level change renders nothing here. It reads the store alone, never
 * the data: reference data arriving does not change the level and so does not move the camera, which only moves for
 * an operator's act (`Rig`). It also does nothing at mount: the stage's first view is the rig's own
 * (`startBoxOf`). `boxes` is read at the moment of the change, so a newer one is used without resubscribing.
 */
export function useLevelCamera(boxes: ReadonlyMap<string, FitBox>): void {
  const latest = useRef(boxes);
  useEffect(() => {
    latest.current = boxes;
  });

  useEffect(() => {
    let previous = levelKeyOf(useConsole.getState());
    return useConsole.subscribe((state) => {
      // The store changes on every hover: look at the two things that matter before building anything.
      if (levelOf(state) === previous.level && state.focusZoneId === previous.focusZoneId) return;
      const next = levelKeyOf(state);
      const step = levelCameraStep(previous, next, latest.current);
      previous = next;
      if (step === null) return;
      if (step.kind === 'home') twinCommands.home();
      else twinCommands.fit(step.box);
    });
  }, []);
}
