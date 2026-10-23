import { ZOOM_IN_FACTOR, ZOOM_OUT_FACTOR } from './twinCamera';

/*
 * The 3D view's own keys (V2-18.3, frame 16 "3D view, while it has focus"), as a pure map from a key press to what it
 * asks of the camera or the level. `TwinView` runs the result on the element that has focus (`twin/runKeyCommand.ts`).
 *
 * These are **not** single-character shortcuts in the sense of `useShortcut`: they act only while the 3D view itself has
 * focus (WCAG 2.1.4 allows that), so the account menu's switch does not turn them off and `isShortcut` is not used. They
 * must not fight the lists either: `Home` and the arrows keep V1's meaning wherever focus is not on the view.
 *
 * The steps are the prototype's (`TwinScene.dc.html`, the `key` handler): `unverified` against the real camera's
 * smoothing, by feel in a browser.
 */

/** `←` turns the camera towards the east by this much, `→` back (the same sense as the "Rotate left" button). */
export const ORBIT_STEP_DEG = 15;
/** `↑` lowers the tilt by this much (towards overhead), `↓` raises it; the controls hold it to 20° – 78°. */
export const TILT_STEP_DEG = 5;
/** `Shift` and an arrow move the target by this fraction of the camera's distance, so a step scales with the zoom. */
export const PAN_STEP = 0.1;

export type KeyCommand =
  | { type: 'orbit'; deg: number }
  | { type: 'tilt'; deg: number }
  /** `dx` to the camera's right, `dy` forward, each a fraction of the distance (`twinCommands.panBy`). */
  | { type: 'pan'; dx: number; dy: number }
  /** A share of the distance, as `twinCommands.zoomBy` takes it: below 1 comes closer. */
  | { type: 'zoom'; factor: number }
  | { type: 'home' }
  | { type: 'up' };

/** The parts of a `KeyboardEvent` this reads, so a test can pass a plain object. */
export type KeyPress = Pick<
  KeyboardEvent,
  'key' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey' | 'repeat' | 'isComposing'
>;

/**
 * What a key press asks for, or `null` when it is not the 3D view's (so the caller leaves the event alone and `Tab`,
 * `V`, `F`, `?`, `/` and `N` reach their own handlers).
 *
 * - Ctrl, Alt and Meta belong to the browser and the OS, and a key during IME composition is not a command.
 * - `Shift` with an arrow pans; without it the arrow orbits or tilts. `Shift` is ignored for `+ = - _`, because `+` is
 *   `Shift` and `=` on most layouts.
 * - Holding an arrow, `+` or `-` repeats (the camera's smoothing and limits absorb it). `Home` and `Escape` do not: one
 *   step per press, so a held Escape cannot climb the whole level ladder in a second. A `Shift`-modified `Home` or
 *   `Escape` is not ours either.
 */
export function keyCommand(event: KeyPress): KeyCommand | null {
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return null;
  switch (event.key) {
    case 'ArrowLeft':
      return event.shiftKey
        ? { type: 'pan', dx: -PAN_STEP, dy: 0 }
        : { type: 'orbit', deg: ORBIT_STEP_DEG };
    case 'ArrowRight':
      return event.shiftKey
        ? { type: 'pan', dx: PAN_STEP, dy: 0 }
        : { type: 'orbit', deg: -ORBIT_STEP_DEG };
    case 'ArrowUp':
      return event.shiftKey
        ? { type: 'pan', dx: 0, dy: PAN_STEP }
        : { type: 'tilt', deg: -TILT_STEP_DEG };
    case 'ArrowDown':
      return event.shiftKey
        ? { type: 'pan', dx: 0, dy: -PAN_STEP }
        : { type: 'tilt', deg: TILT_STEP_DEG };
    case '+':
    case '=':
      return { type: 'zoom', factor: ZOOM_IN_FACTOR };
    case '-':
    case '_':
      return { type: 'zoom', factor: ZOOM_OUT_FACTOR };
    case 'Home':
      return event.repeat || event.shiftKey ? null : { type: 'home' };
    case 'Escape':
      return event.repeat || event.shiftKey ? null : { type: 'up' };
    default:
      return null;
  }
}
