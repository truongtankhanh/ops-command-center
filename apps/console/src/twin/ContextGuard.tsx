import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { watchContext } from '../lib/twinContext';
import { useConsole } from '../store';

/**
 * Watches the canvas's WebGL context (V2-12.11, ADR-0020 § Capability check). Rendered inside the canvas, it
 * renders nothing.
 *
 * three.js already prevents the default of a loss (so the browser may restore the context) and re-initialises
 * itself on a restore; R3F adds nothing. What is missing, and added here through `watchContext`: a redraw after
 * a restore (`frameloop="demand"` draws nothing until asked, so the restored context would sit blank) and the
 * deadline: a context that does not come back within 5 s ends the 3D session with `markTwinLost()`, after which
 * `StageView` shows the 2D map and the `context-lost` banner and keeps the stored choice.
 *
 * Between the loss and the restore the canvas is blank or frozen on its last frame; the design has no state for
 * those seconds, so nothing is shown. The listeners go with the stage (a switch to 2D, or the fault itself).
 *
 * Frame demand: one-shot. A restored WebGL context asks for one frame (`onRestore`); it asks for nothing otherwise.
 */
export function ContextGuard() {
  const get = useThree((state) => state.get);
  const markTwinLost = useConsole((state) => state.markTwinLost);

  useEffect(() => {
    const { gl, invalidate } = get();
    return watchContext(gl.domElement, { onRestore: invalidate, onFault: markTwinLost });
  }, [get, markTwinLost]);

  return null;
}
