import { useId } from 'react';
import { TWIN_UNAVAILABLE_COPY } from '../../lib/twin-core/twinCapability';
import { useTwinCapability } from '../../lib/twin-core/useTwinCapability';
import { useConsole } from '../../store';
import { Button } from '../../ui/Button';
import { Box, MapIcon } from '../../ui/icons';
import styles from './ViewSwitch.module.css';

/**
 * The 3D option's element id. `TwinFallbackBanner` hands focus to it when it is dismissed (the
 * switch is a single instance, as `#incident-feed` and `#side-panel` are).
 */
export const VIEW_SWITCH_3D_ID = 'view-switch-3d';

/**
 * Frame 14's `3D / 2D` switch: two toggle buttons in a group, the view in effect pressed.
 *
 * While the twin cannot be drawn (`useTwinCapability`) the 3D option is `aria-disabled`, not
 * `disabled`: a disabled button drops keyboard focus, and the switch must stay reachable for
 * keyboard and screen reader users, who then hear why. The reason is a visually hidden line that is
 * always rendered, so it is still read after the banner that says the same is dismissed. A press on
 * 3D does nothing then (the store refuses it as well).
 *
 * The pressed-off option carries `V`'s hint while single-key shortcuts are on (V2-18.2): `V` flips the view, so it
 * activates that one. The 3D option has none where 3D is unavailable (the key does nothing there). The key itself is
 * `TwinShortcuts`'; this component only states it.
 *
 * The same for every role: choosing a view is not an action on the site.
 */
export function ViewSwitch() {
  const view = useConsole((s) => s.view);
  const setView = useConsole((s) => s.setView);
  const keysOn = useConsole((s) => s.keyboardShortcuts);
  const capability = useTwinCapability();
  const reasonId = useId();

  return (
    <div role="group" aria-label="View" className={styles.switch}>
      <Button
        id={VIEW_SWITCH_3D_ID}
        variant="ghost"
        icon={Box}
        shortcut={keysOn && capability.available && view === '2d' ? 'V' : undefined}
        className={styles.option}
        aria-pressed={view === '3d'}
        aria-disabled={capability.available ? undefined : true}
        aria-describedby={capability.available ? undefined : reasonId}
        onClick={() => {
          if (capability.available) setView('3d');
        }}
      >
        3D
      </Button>
      <Button
        variant="ghost"
        icon={MapIcon}
        shortcut={keysOn && view === '3d' ? 'V' : undefined}
        className={styles.option}
        aria-pressed={view === '2d'}
        onClick={() => setView('2d')}
      >
        2D
      </Button>
      {!capability.available && (
        <span id={reasonId} className={styles.reason}>
          {TWIN_UNAVAILABLE_COPY[capability.reason].title}
        </span>
      )}
    </div>
  );
}
