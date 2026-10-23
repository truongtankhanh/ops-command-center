import { type PointerEvent, useCallback, useEffect, useRef } from 'react';
import { twinCommands } from '../lib/twin-core/twinCommands';
import {
  centreTargetOf,
  HOLD_START_MS,
  PAN_DIRECTIONS,
  type PanDirection,
} from '../lib/twin-core/twinPan';
import { useSelectionTarget } from '../lib/twin-core/useSelectionTarget';
import { ArrowUp, Crosshair } from '../ui/icons';
import { Icon } from '../ui/Icon';
import styles from './PanPad.module.css';

/**
 * The 3D stage's 8-direction pad (V3-29, frame 24): eight arrows round a centre button, over the stage's bottom-left
 * corner. A press moves the view one step (a share of the visible ground width, `padStep`); holding it moves the view
 * continuously until it is let go. Directions are **screen** directions along the ground, like `Shift` and the arrows, so
 * "up" is away from the viewer whatever the camera's azimuth; the buttons are named that way ("Pan up and right").
 *
 * - **Pointer:** the press steps at once and, if it is still held after `HOLD_START_MS`, turns into a held move
 *   (`twinCommands.panHold`). The button captures the pointer, so the release is seen wherever it happens; a cancelled
 *   pointer, a lost capture, a window blur and an unmount all let go too.
 * - **Keyboard:** Space or Enter activates the button, which steps once (a held Enter repeats the step). A pointer
 *   press also ends in a `click`, which carries `detail > 0`; only a keyboard activation (`detail === 0`) steps from the
 *   click, so one press is never two steps.
 * - **The centre button** moves the view's target to what is selected (an asset, or an incident's beacon) and keeps the
 *   distance. With nothing selected it is `aria-disabled` and not `disabled`, so it keeps keyboard focus.
 * - Everything goes through `twinCommands`, so the pad knows nothing of the canvas and does nothing with no rig. The same
 *   for every role: moving the camera is not an action on the site.
 */
export function PanPad() {
  const centre = centreTargetOf(useSelectionTarget());
  const starting = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable, so the blur listener below is added once. It reads the timer only when it is called, never during render.
  const release = useCallback(() => {
    if (starting.current !== null) clearTimeout(starting.current);
    starting.current = null;
    twinCommands.panHold(null);
  }, []);

  // A hold never outlives the pad, and a window that loses focus cannot deliver the release.
  useEffect(() => {
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('blur', release);
      release();
    };
  }, [release]);

  const press = (direction: PanDirection, event: PointerEvent<HTMLButtonElement>) => {
    // Only the main button (and a touch or a pen, which report 0) presses it.
    if (event.button > 0) return;
    release();
    // The release must reach us even when the pointer leaves the button; a stand-in without capture is fine.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    twinCommands.panStep(direction.dx, direction.dy);
    starting.current = setTimeout(() => {
      starting.current = null;
      twinCommands.panHold({ dx: direction.dx, dy: direction.dy });
    }, HOLD_START_MS);
  };

  return (
    <div role="group" aria-label="Pan the view" className={styles.pad}>
      {PAN_DIRECTIONS.map((direction) => (
        <button
          key={direction.id}
          type="button"
          className={styles.arrow}
          data-dir={direction.id}
          aria-label={direction.name}
          onPointerDown={(event) => press(direction, event)}
          onPointerUp={release}
          onPointerCancel={release}
          onLostPointerCapture={release}
          onClick={(event) => {
            if (event.detail === 0) twinCommands.panStep(direction.dx, direction.dy);
          }}
        >
          <Icon glyph={ArrowUp} size={16} />
        </button>
      ))}
      <button
        type="button"
        className={styles.centre}
        aria-label="Centre on the selection"
        aria-disabled={centre === null || undefined}
        onClick={() => {
          if (centre !== null) twinCommands.centreOn(centre);
        }}
      >
        <Icon glyph={Crosshair} size={16} />
      </button>
    </div>
  );
}
