import { useEffect } from 'react';

/**
 * Escape ends the picking of the report's location in the 3D view (V2-16.7, frame 09: "Esc stops picking"). While
 * `enabled`, a `keydown` for Escape on the document, in the **capture phase**, calls `stop` and is stopped there, so
 * the sheet's own Escape (which would close the form, or keep it open and announce the kept draft) does not also act
 * on the same key: stopping picking is one step, closing the form is the next press. Capture on the document, as
 * `Popover` does, because after a click on the canvas focus is on the page body and the sheet never hears the key.
 *
 * `enabled` is the caller's whole rule. The form turns it on only in the 3D view while picking, so the 2D map's
 * Escape (the sheet's) is exactly as it was. A key during IME composition is not Escape.
 */
export function useStopPickingOnEscape(enabled: boolean, stop: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      stop();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [enabled, stop]);
}
