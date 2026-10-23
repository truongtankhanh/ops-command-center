/*
 * The 3D stage's WebGL context loss as plain timer logic (V2-12.11, ADR-0020 § Capability check): a context
 * that is lost and does not come back within 5 s ends the 3D session. No `three`, no canvas: the thing
 * watched is any `EventTarget`, so the deadline is tested with fake timers and a plain target.
 *
 * What three.js already does on its own, and so is not repeated here: it prevents the default on a loss
 * (so the browser may restore the context) and re-initialises its state on a restore, after which
 * geometries, materials and textures upload again the next time they are drawn. R3F adds nothing. What is
 * missing is the deadline, and, because `frameloop="demand"` draws nothing until asked, a redraw after a restore.
 */

/** How long a lost context may take to come back (ADR-0020). */
export const RESTORE_MS = 5000;

interface ContextWatch {
  /** The context came back before the deadline: the scene has to be drawn again. */
  onRestore(): void;
  /** It did not: the 3D session is over. Called once; the watch has stopped by then. */
  onFault(): void;
  /** For tests and tuning; the default is the ADR's. */
  restoreMs?: number;
}

/**
 * Watches `target` (the canvas) for `webglcontextlost` and `webglcontextrestored`. Returns what stops the
 * watch.
 *
 * - A loss is prevented (so the browser may restore it) and starts the deadline. A second loss while the
 *   deadline is running does not extend it, so a context that flaps cannot keep the stage alive for ever.
 * - A restore before the deadline cancels it and calls `onRestore`. A restore with no loss pending is ignored.
 * - When the deadline passes, `onFault` is called once and the watch ends: a restore at exactly the
 *   deadline is too late, one a millisecond before it is not.
 */
export function watchContext(
  target: EventTarget,
  { onRestore, onFault, restoreMs = RESTORE_MS }: ContextWatch,
): () => void {
  let deadline: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    target.removeEventListener('webglcontextlost', onLost);
    target.removeEventListener('webglcontextrestored', onRestored);
    if (deadline !== null) clearTimeout(deadline);
    deadline = null;
  };

  function onLost(event: Event) {
    event.preventDefault();
    if (deadline !== null) return;
    deadline = setTimeout(() => {
      deadline = null;
      stop();
      onFault();
    }, restoreMs);
  }

  function onRestored() {
    if (deadline === null) return;
    clearTimeout(deadline);
    deadline = null;
    onRestore();
  }

  target.addEventListener('webglcontextlost', onLost);
  target.addEventListener('webglcontextrestored', onRestored);
  return stop;
}
