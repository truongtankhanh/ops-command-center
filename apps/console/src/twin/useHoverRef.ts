import { useThree } from '@react-three/fiber';
import { type RefObject, useEffect, useRef } from 'react';
import { type HoverState, hoverOf, NO_HOVER } from '../lib/twinHover';
import { useConsole } from '../store';

/**
 * The store's hover, as a ref the paint loops read in their frame (V2-15.5): `hoveredAssetCode` and
 * `hoveredPart`, written by the pointer (V2-15.4) and by the Assets tab's rows, so the scene and the list
 * highlight each other whoever moved first. Not React state: a hover would otherwise render the canvas's
 * components for something only the frame loop needs. The ref holds a **new object** for each change, so a
 * loop tells by identity that the hover moved, and each change asks the on-demand canvas for a frame
 * (`invalidate`), which is what draws it.
 *
 * Each call subscribes on its own (the equipment and the buildings), which costs one listener and no
 * extra frame: invalidations in the same tick share one.
 *
 * Frame demand: one-shot. One frame per change of the hovered asset or part (and one on mount if a hover was
 *   already there).
 */
export function useHoverRef(): RefObject<HoverState> {
  const invalidate = useThree((state) => state.invalidate);
  const hover = useRef<HoverState>(NO_HOVER);

  useEffect(() => {
    // A hover that was already there when the canvas came up.
    const first = hoverOf(useConsole.getState());
    if (first !== NO_HOVER) {
      hover.current = first;
      invalidate();
    }
    const stop = useConsole.subscribe((state, previous) => {
      if (
        state.hoveredAssetCode === previous.hoveredAssetCode &&
        state.hoveredPart === previous.hoveredPart
      ) {
        return;
      }
      hover.current = hoverOf(state);
      invalidate();
    });
    return () => {
      stop();
      hover.current = NO_HOVER;
    };
  }, [invalidate]);

  return hover;
}
