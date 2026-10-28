import { useSession } from '../../auth/store';
import { useReadOnly } from '../../auth/usePermission';
import { useSignOut } from '../../auth/useSignOut';
import { initials, rolesLabel } from '../../lib/shell/users';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { ChevronDown, Eye, LogOut } from '../../ui/icons';
import { Popover } from '../../ui/Popover';
import { SettingsSwitches } from './SettingsSwitches';
import styles from './UserMenu.module.css';

/**
 * Who is signed in, why actions may be missing, the sound for critical incidents, the single-key
 * shortcuts switch and their help, compact density, and Sign out (frame 06). The trigger's visible
 * text (name, then role or "View only") is its accessible name; the avatar is decorative.
 */
export function UserMenu({ className }: { className?: string }) {
  const user = useSession((s) => s.user);
  const readOnly = useReadOnly();
  const signOut = useSignOut();
  // AuthGate renders the console only for a signed-in user, so this is a type guard.
  if (!user) return null;

  const roles = rolesLabel(user.roles);
  const avatar = initials(user.displayName);

  return (
    <Popover
      className={className}
      triggerClassName={styles.trigger}
      panelLabel="Account"
      trigger={
        <>
          <span className={styles.avatar} aria-hidden="true">
            {avatar}
          </span>
          <span className={styles.who}>
            <span className={styles.name} title={user.displayName}>
              {user.displayName}
            </span>{' '}
            {/* Explains why actions are missing; the API still refuses them (ADR-0011). */}
            <span className={styles.role}>
              {readOnly ? (
                <>
                  <Icon glyph={Eye} size={14} />
                  View only
                </>
              ) : (
                roles
              )}
            </span>
          </span>
          <Icon glyph={ChevronDown} size={14} className={styles.chevron} />
        </>
      }
    >
      {(close) => (
        <>
          <div className={styles.identity}>
            <span className={styles.avatar} aria-hidden="true">
              {avatar}
            </span>
            <strong className={styles.identityName}>{user.displayName}</strong>
            <span className={styles.identityRole}>
              {user.roles.length > 1 ? 'Roles' : 'Role'}: {roles}
            </span>
          </div>
          {readOnly && (
            <p className={styles.note}>
              <strong className={styles.noteTitle}>
                <Icon glyph={Eye} size={14} />
                View only
              </strong>
              You can follow incidents, the map and cameras. Reporting, acknowledging and resolving
              need the operator or supervisor role.
            </p>
          )}
          {/* The sound, shortcuts and density switches and the shortcuts help: shared with the status bar's Settings (V3-06.3). */}
          <SettingsSwitches close={close} />
          <hr className={styles.separator} />
          <div className={styles.actions}>
            {/* Ghost: a secondary button's boundary fails 3:1 on the menu's --surface-3. */}
            <Button variant="ghost" icon={LogOut} className={styles.menuButton} onClick={signOut}>
              Sign out
            </Button>
          </div>
        </>
      )}
    </Popover>
  );
}
