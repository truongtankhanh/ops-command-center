import { useSession } from '../auth/store';
import { useReadOnly } from '../auth/usePermission';
import { useSignOut } from '../auth/useSignOut';
import { playCriticalCue, unlockAudio } from '../lib/criticalCue';
import { initials, rolesLabel } from '../lib/users';
import { useConsole } from '../store';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { ChevronDown, Eye, LogOut, Volume2 } from '../ui/icons';
import { Popover } from '../ui/Popover';
import styles from './UserMenu.module.css';

/**
 * Who is signed in, why actions may be missing, the sound for critical incidents, and Sign out
 * (frame 06). The trigger's visible text (name, then role or "View only") is its accessible name;
 * the avatar is decorative.
 */
export function UserMenu({ className }: { className?: string }) {
  const user = useSession((s) => s.user);
  const readOnly = useReadOnly();
  const signOut = useSignOut();
  const criticalSound = useConsole((s) => s.criticalSound);
  const setCriticalSound = useConsole((s) => s.setCriticalSound);
  // AuthGate renders the console only for a signed-in user, so this is a type guard.
  if (!user) return null;

  const toggleSound = () => {
    const on = !criticalSound;
    setCriticalSound(on);
    // This click is the gesture that lets audio start; the cue plays once so the operator hears it.
    if (!on) return;
    void unlockAudio().then((running) => {
      if (running) playCriticalCue({ preview: true });
    });
  };

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
            <span className={styles.name}>{user.displayName}</span>{' '}
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
          You can follow incidents, the map and cameras. Reporting, acknowledging and resolving need
          the operator or supervisor role.
        </p>
      )}
      {/* A switch, not a `menuitemcheckbox`: the popover is a disclosure, not an ARIA menu. */}
      <button
        type="button"
        role="switch"
        aria-checked={criticalSound}
        className={styles.sound}
        onClick={toggleSound}
      >
        <Icon glyph={Volume2} size={18} />
        Sound for critical incidents
        <span className={styles.switch} aria-hidden="true" />
      </button>
      <hr className={styles.separator} />
      <div className={styles.actions}>
        {/* Ghost: a secondary button's boundary fails 3:1 on the menu's --surface-3. */}
        <Button variant="ghost" icon={LogOut} className={styles.signOut} onClick={signOut}>
          Sign out
        </Button>
      </div>
    </Popover>
  );
}
