import { useId } from 'react';
import { TWIN_UNAVAILABLE_COPY, twinCapability } from '../lib/twinCapability';
import { useConsole } from '../store';
import { Button } from '../ui/Button';
import { Box, MapIcon } from '../ui/icons';
import styles from './ViewSwitch.module.css';

/**
 * The 3D option's element id. `TwinFallbackBanner` hands focus to it when it is dismissed (the
 * switch is a single instance, as `#incident-feed` and `#side-panel` are).
 */
export const VIEW_SWITCH_3D_ID = 'view-switch-3d';

/**
 * Frame 14's `3D / 2D` switch: two toggle buttons in a group, the view in effect pressed.
 *
 * While the twin cannot be drawn (`twinCapability`) the 3D option is `aria-disabled`, not
 * `disabled`: a disabled button drops keyboard focus, and the switch must stay reachable for
 * keyboard and screen reader users, who then hear why. The reason is a visually hidden line that is
 * always rendered, so it is still read after the banner that says the same is dismissed. A press on
 * 3D does nothing then (the store refuses it as well).
 *
 * The same for every role: choosing a view is not an action on the site.
 */
export function ViewSwitch() {
  const view = useConsole((s) => s.view);
  const setView = useConsole((s) => s.setView);
  const capability = twinCapability();
  const reasonId = useId();

  return (
    <div role="group" aria-label="View" className={styles.switch}>
      <Button
        id={VIEW_SWITCH_3D_ID}
        variant="ghost"
        icon={Box}
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
