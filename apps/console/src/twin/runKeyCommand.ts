import { twinCommands } from '../lib/twinCommands';
import { resetView } from '../lib/twinFlight';
import type { KeyCommand } from '../lib/twinKeys';
import { levelOf } from '../lib/twinLevel';
import { useConsole } from '../store';

/**
 * Runs what a key of the 3D view asked for (V2-18.3, `keyCommand`) and says whether the key was used, so the caller
 * calls `preventDefault()` for a handled key only.
 *
 * - The camera keys go through `twinCommands`, like the on-screen buttons; with no rig they do nothing.
 * - `home` is the Reset button's `resetView`: campus level, then the home view.
 * - `up` is one step of Escape's ladder (`goUp`: part, asset, building). It does not ask for the camera: the level
 *   camera (`useLevelCamera`) follows the level by itself, so a second request would fly twice. At the campus there is
 *   nothing to close and nothing is done (ADR-0020: Escape never switches to 2D), so the key is reported as not used
 *   and whoever else listens for it still gets it.
 *
 * Reads the store with `getState()`: the view subscribes to nothing for it.
 */
export function runKeyCommand(command: KeyCommand): boolean {
  switch (command.type) {
    case 'orbit':
      twinCommands.rotateBy(command.deg);
      return true;
    case 'tilt':
      twinCommands.tiltBy(command.deg);
      return true;
    case 'pan':
      twinCommands.panBy(command.dx, command.dy);
      return true;
    case 'zoom':
      twinCommands.zoomBy(command.factor);
      return true;
    case 'home':
      resetView();
      return true;
    case 'up': {
      const state = useConsole.getState();
      if (levelOf(state) === 'campus') return false;
      state.goUp();
      return true;
    }
  }
}
