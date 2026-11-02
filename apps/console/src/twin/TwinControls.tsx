import type { RefObject } from 'react';
import { ZOOM_IN_FACTOR, ZOOM_OUT_FACTOR } from '../lib/twin-core/twinCamera';
import { twinCommands } from '../lib/twin-core/twinCommands';
import { focusSelection } from '../lib/twin-core/twinFocus';
import { resetView } from '../lib/twin-core/twinFlight';
import { useFocusableSelection } from '../lib/twin-core/useFocusableSelection';
import { Button } from '../ui/Button';
import { useConsole } from '../store';
import { Crosshair, Hand, House, Minus, Orbit, Plus, RotateCcw, RotateCw } from '../ui/icons';
import { Panel } from '../ui/Panel';
import styles from './TwinControls.module.css';

/**
 * Frame 01's turn (TwinScene) is 30°. A positive turn takes the camera towards the east, which turns the scene the
 * other way, so the left button (counter-clockwise glyph) is the positive one. The zoom steps are shared with the
 * keys (`ZOOM_IN_FACTOR`, `ZOOM_OUT_FACTOR`), and so is the reset (`resetView`, which the `Home` key calls too: V2-18.3).
 */
const TURN_DEGREES = 30;

interface TwinControlsProps {
  /**
   * The compass button. The canvas's `CompassSync` writes its rotation and its name from the camera on each
   * drawn frame through this ref, so the cluster re-renders for none of it.
   */
  compassRef: RefObject<HTMLButtonElement | null>;
}

/**
 * The 3D stage's camera controls (V2-12.10, frame 01; a rail since V3-10.2): one floating `Panel` down the **left**
 * edge of the stage, below the stage bar, so the open sheet, which lies over the right, never covers it and it needs
 * no `--sheet-inset`. In the order they are tabbed to: the compass, which faces north in one press, the drag tool
 * (Orbit or Pan, V3-29), zoom, rotate and reset, and, only while an asset or part is selected and the scene draws
 * it, "Focus". Everything goes through `twinCommands`, so this knows nothing of the canvas, and a press does nothing
 * while no rig is registered (the chunk is still loading, or the scene is empty).
 *
 * The compass is named "Face north" and, once the view is turned, says by how much ("Face north — the view
 * is rotated 60°", frame 00); the needle is a shape (north is the accent half), so direction is not colour
 * alone. `CompassSync` finds the needle as the button's one `svg` and renames the button, so both stay as they are.
 *
 * "Focus" is `AssetFoot`'s button and command (`focusSelection`, the same `focusAvailable` rule through
 * `useFocusableSelection`): a second entry, not a second behaviour, so an asset's sheet and the rail can both offer it.
 * It is icon-only like its neighbours, so `F` is announced through `aria-keyshortcuts` while single-key shortcuts
 * are on (as Pan does for `P`); the labelled button in the inspector's foot is where the key is drawn. `TwinShortcuts`
 * owns the key itself.
 *
 * The same for every role: moving the camera is not an action on the site.
 */
export function TwinControls({ compassRef }: TwinControlsProps) {
  const panTool = useConsole((s) => s.panTool);
  const setPanTool = useConsole((s) => s.setPanTool);
  const keysOn = useConsole((s) => s.keyboardShortcuts);
  const focusTarget = useFocusableSelection();
  return (
    <Panel variant="floating" className={styles.rail}>
      <button
        type="button"
        ref={compassRef}
        className={styles.compass}
        aria-label="Face north"
        onClick={() => twinCommands.faceNorth()}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={styles.needle}
        >
          <path className={styles.north} d="M12 2 17 12H7z" />
          <path className={styles.south} d="M7 12h10l-5 10z" />
        </svg>
      </button>
      {/*
        The drag's tool (V3-29): Orbit, the default, or Pan. A pair of toggle buttons, one pressed. `P` switches it, and the key
        is named only while single-key shortcuts are on (WCAG 2.1.4). A session choice: the store does not remember it.
      */}
      <div role="group" aria-label="Drag tool" className={styles.group}>
        <Button
          variant="ghost"
          icon={Orbit}
          aria-label="Orbit: drag rotates"
          aria-pressed={!panTool}
          className={styles.button}
          onClick={() => setPanTool(false)}
        />
        <Button
          variant="ghost"
          icon={Hand}
          aria-label="Pan: drag moves the view"
          aria-pressed={panTool}
          aria-keyshortcuts={keysOn ? 'P' : undefined}
          className={styles.button}
          onClick={() => setPanTool(true)}
        />
      </div>
      <div role="group" aria-label="Camera" className={styles.group}>
        <Button
          variant="ghost"
          icon={Plus}
          aria-label="Zoom in"
          className={styles.button}
          onClick={() => twinCommands.zoomBy(ZOOM_IN_FACTOR)}
        />
        <Button
          variant="ghost"
          icon={Minus}
          aria-label="Zoom out"
          className={styles.button}
          onClick={() => twinCommands.zoomBy(ZOOM_OUT_FACTOR)}
        />
        <Button
          variant="ghost"
          icon={RotateCcw}
          aria-label="Rotate left"
          className={styles.button}
          onClick={() => twinCommands.rotateBy(TURN_DEGREES)}
        />
        <Button
          variant="ghost"
          icon={RotateCw}
          aria-label="Rotate right"
          className={styles.button}
          onClick={() => twinCommands.rotateBy(-TURN_DEGREES)}
        />
        <Button
          variant="ghost"
          icon={House}
          aria-label="Reset view"
          className={styles.button}
          onClick={resetView}
        />
      </div>
      {focusTarget && (
        <div role="group" aria-label="Selection" className={styles.group}>
          <Button
            variant="ghost"
            icon={Crosshair}
            aria-label="Focus"
            aria-keyshortcuts={keysOn ? 'F' : undefined}
            className={styles.button}
            onClick={() => focusSelection(focusTarget.assetCode, focusTarget.part)}
          />
        </div>
      )}
    </Panel>
  );
}
