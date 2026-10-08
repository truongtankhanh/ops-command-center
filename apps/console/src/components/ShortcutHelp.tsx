import { hasPermission } from '@occ/contracts';
import { useId } from 'react';
import { useSession } from '../auth/store';
import { SHORTCUTS } from '../lib/shortcuts';
import { useShortcut } from '../lib/useShortcut';
import { useConsole } from '../store';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Kbd } from '../ui/Kbd';
import styles from './ShortcutHelp.module.css';

/**
 * The keyboard shortcuts help, opened with `?` or from the account menu. Always mounted, so `?`
 * works anywhere outside a text field (and outside another dialog, which stops keys at its root).
 * It is also where the keys that are not announced are listed: the incident list's arrows, the
 * tabs' arrows, the map's keys.
 */
export function ShortcutHelp() {
  const open = useConsole((s) => s.shortcutHelpOpen);
  const openShortcutHelp = useConsole((s) => s.openShortcutHelp);
  useShortcut('?', openShortcutHelp, !open);
  return open ? <ShortcutHelpDialog /> : null;
}

/**
 * Only the keys this user can use: single-key shortcuts while they are on, and actions their roles
 * grant (a viewer sees no `N`, `A` or `R`). The short intro, not the whole list, is the dialog's
 * description, so opening it does not read every row.
 */
function ShortcutHelpDialog() {
  const close = useConsole((s) => s.closeShortcutHelp);
  const keysOn = useConsole((s) => s.keyboardShortcuts);
  const roles = useSession((s) => s.user?.roles);
  const introId = useId();

  const groups = SHORTCUTS.map((group) => ({
    ...group,
    rows: group.rows.filter(
      (row) =>
        (keysOn || !row.character) &&
        (!row.permission || hasPermission(roles ?? [], row.permission)),
    ),
  })).filter((group) => group.rows.length > 0);

  return (
    <Dialog
      title="Keyboard shortcuts"
      size="wide"
      describedBy={introId}
      onCancel={close}
      actions={
        <Button variant="ghost" onClick={close}>
          Close
        </Button>
      }
    >
      <p id={introId} className={styles.intro}>
        {keysOn
          ? 'Single-key shortcuts do nothing while you type in a text field.'
          : 'Single-key shortcuts are off. Turn them on in the account menu.'}
      </p>
      <div className={styles.groups}>
        {groups.map((group) => (
          <div key={group.title}>
            <h3 className={styles.groupTitle}>{group.title}</h3>
            <dl className={styles.rows}>
              {group.rows.map((row) => (
                <div key={row.description} className={styles.row}>
                  <dt className={styles.keys}>
                    {row.keys.map((key) => (
                      <Kbd key={key} decorative={false}>
                        {key}
                      </Kbd>
                    ))}
                  </dt>
                  <dd className={styles.description}>{row.description}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
