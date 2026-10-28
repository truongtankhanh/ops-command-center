import { playCriticalCue, unlockAudio } from '../../lib/incidents/criticalCue';
import { useConsole } from '../../store';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Info, Keyboard, Rows3, Volume2 } from '../../ui/icons';
import styles from './SettingsSwitches.module.css';

/**
 * The console's display and sound preferences: the sound for critical incidents, the single-key shortcuts and
 * their help, and compact density. The account menu (frame 06) and the status bar's Settings (V3-06.3) both render
 * this, so there is one copy of the logic and both read the same store. A fragment, so each popover's panel holds the
 * rows directly. `close` is the popover's: the help entry calls it first.
 *
 * V3-17's "Follow selection" is one more row here, before the help button, and so appears in both places.
 * Display preferences, offered to every role.
 */
export function SettingsSwitches({ close }: { close: () => void }) {
  const criticalSound = useConsole((s) => s.criticalSound);
  const setCriticalSound = useConsole((s) => s.setCriticalSound);
  const keyboardShortcuts = useConsole((s) => s.keyboardShortcuts);
  const setKeyboardShortcuts = useConsole((s) => s.setKeyboardShortcuts);
  const openShortcutHelp = useConsole((s) => s.openShortcutHelp);
  const compact = useConsole((s) => s.density === 'compact');
  const setDensity = useConsole((s) => s.setDensity);

  const toggleSound = () => {
    const on = !criticalSound;
    setCriticalSound(on);
    // This click is the gesture that lets audio start; the cue plays once so the operator hears it.
    if (!on) return;
    void unlockAudio().then((running) => {
      if (running) playCriticalCue({ preview: true });
    });
  };

  return (
    <>
      {/* Switches, not `menuitemcheckbox`es: the popover is a disclosure, not an ARIA menu. */}
      <button
        type="button"
        role="switch"
        aria-checked={criticalSound}
        className={styles.switchRow}
        onClick={toggleSound}
      >
        <Icon glyph={Volume2} size={18} />
        Sound for critical incidents
        <span className={styles.switch} aria-hidden="true" />
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={keyboardShortcuts}
        className={styles.switchRow}
        onClick={() => setKeyboardShortcuts(!keyboardShortcuts)}
      >
        <Icon glyph={Keyboard} size={18} />
        Single-key shortcuts
        <span className={styles.switch} aria-hidden="true" />
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={compact}
        className={styles.switchRow}
        onClick={() => setDensity(compact ? 'comfortable' : 'compact')}
      >
        <Icon glyph={Rows3} size={18} />
        Compact layout
        <span className={styles.switch} aria-hidden="true" />
      </button>
      <div className={styles.actions}>
        {/* Closes the popover first, so the help dialog returns focus to the popover's trigger. */}
        <Button
          variant="ghost"
          icon={Info}
          shortcut={keyboardShortcuts ? '?' : undefined}
          className={styles.menuButton}
          onClick={() => {
            close();
            openShortcutHelp();
          }}
        >
          Keyboard shortcuts
        </Button>
      </div>
    </>
  );
}
