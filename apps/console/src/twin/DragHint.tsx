import { useEffect, useRef, useState } from 'react';
import { useConsole } from '../store';
import { Kbd } from '../ui/Kbd';
import styles from './DragHint.module.css';

/** Per tab, like the 3D fallback banner's dismissal: a new tab or a new visit shows the hint again. */
const STORAGE_KEY = 'occ.console.twinDragHintSeen';

/** A pointer that has moved this far, in px, with a button down is a drag, not a click that shook. */
const DRAG_PX = 4;

/**
 * "Drag to rotate · Pan tool or Shift + drag to pan" (V2-12.10, frame 01 `.tw-drag-hint`; V3-29 added the tool and the
 * Pan tool's own wording, "Drag to pan · Shift + drag to rotate"): a pill over the 3D stage until
 * the operator has dragged it once in this tab. It is decoration (`aria-hidden`, no pointer events): the same
 * instruction is in the stage's label for assistive tech (V2-12.12). It sits at the top of the part of the stage the
 * sheet leaves visible, clear of the legends at the bottom-right (V3-10.4; it was at the bottom until then, and
 * moved up only while the sheet was open). A phone has no Shift, so it is hidden there (`DragHint.module.css`).
 *
 * The drag is watched on the stage box (the hint's parent), which gets the pointer events the canvas gets.
 */
export function DragHint() {
  const hint = useRef<HTMLParagraphElement>(null);
  const panTool = useConsole((s) => s.panTool);
  const [seen, setSeen] = useState(readSeen);

  useEffect(() => {
    const stage = hint.current?.parentElement;
    if (seen || !stage) return;
    let down: { x: number; y: number } | null = null;
    const onDown = (event: PointerEvent) => {
      down = { x: event.clientX, y: event.clientY };
    };
    const onMove = (event: PointerEvent) => {
      if (!down || event.buttons === 0) return;
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) <= DRAG_PX) return;
      writeSeen();
      setSeen(true);
    };
    const onEnd = () => {
      down = null;
    };
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onEnd);
    stage.addEventListener('pointercancel', onEnd);
    return () => {
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onEnd);
      stage.removeEventListener('pointercancel', onEnd);
    };
  }, [seen]);

  if (seen) return null;
  return (
    <p ref={hint} className={styles.hint} aria-hidden="true">
      {panTool ? (
        <>
          Drag to pan · <Kbd>Shift</Kbd> + drag to rotate
        </>
      ) : (
        <>
          Drag to rotate · Pan tool or <Kbd>Shift</Kbd> + drag to pan
        </>
      )}
    </p>
  );
}

// Storage can be missing or throw (private window, blocked site data): the hint then shows until the page is
// reloaded, which is the safe side.

function readSeen(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeSeen(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, 'true');
  } catch {
    // Not remembered; see above.
  }
}
