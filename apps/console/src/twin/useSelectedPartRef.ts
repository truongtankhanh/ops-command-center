import { useThree } from '@react-three/fiber';
import { type RefObject, useEffect, useRef } from 'react';
import { NO_SELECTION, type SelectedPart, selectionOf } from '../lib/twin-core/twinHover';
import { useConsole } from '../store';

/**
 * The selected part (V2-15.10), kept in a ref for the canvas's frame loops: `selectedAssetCode` and `selectedPart` of
 * the store, as `selectionOf` reads them. It is the selected look's input (`useModelLooks`) and the leader's
 * (`LeaderProjector`), and it is `useHoverRef`'s twin: a new object per change so a reader tells by identity that it
 * changed, and a frame asked for on every change because the on-demand canvas draws nothing on its own and the painters
 * only run inside a frame. A part is never selected without its asset, and a selection that was already there when
 * the canvas came up is read at once.
 *
 * A hook of its own, and not a second value of `useHoverRef`, so the hover's readers (`Buildings`, `Equipment`) do not
 * depend on the selection and each ref has one reason to change.
 *
 * Frame demand: one-shot. One frame per change of the selected asset or part (and one on mount if a selection was
 *   already there).
 */
export function useSelectedPartRef(): RefObject<SelectedPart> {
  const invalidate = useThree((state) => state.invalidate);
  const selection = useRef<SelectedPart>(NO_SELECTION);

  useEffect(() => {
    const first = selectionOf(useConsole.getState());
    if (first !== NO_SELECTION) {
      selection.current = first;
      invalidate();
    }
    const stop = useConsole.subscribe((state, previous) => {
      if (
        state.selectedAssetCode === previous.selectedAssetCode &&
        state.selectedPart === previous.selectedPart
      ) {
        return;
      }
      selection.current = selectionOf(state);
      invalidate();
    });
    return () => {
      stop();
      selection.current = NO_SELECTION;
    };
  }, [invalidate]);

  return selection;
}
