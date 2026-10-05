import { INCIDENT_SEVERITIES } from '@occ/contracts';
import { useIncidents } from '../api/queries';
import { useSession } from '../auth/store';
import { useReadOnly } from '../auth/usePermission';
import { useSignOut } from '../auth/useSignOut';
import { countActiveBySeverity } from '../lib/incidents';
import { useNow } from '../lib/useNow';
import { useConsole } from '../store';
import button from '../styles/button.module.css';
import text from '../styles/text.module.css';
import styles from './Header.module.css';

const CONNECTION_LABEL = { live: 'Live', connecting: 'Connecting…', offline: 'Offline' } as const;

export function Header() {
  const { data: incidents = [] } = useIncidents();
  const connection = useConsole((s) => s.connection);
  const user = useSession((s) => s.user);
  const readOnly = useReadOnly();
  const signOut = useSignOut();
  const now = useNow(1000);
  const counts = countActiveBySeverity(incidents);

  return (
    <header className={styles.header}>
      <div>
        <h1 className={text.appTitle}>Operations</h1>
        <div className={styles.site}>Langbiang Tech Campus</div>
      </div>

      <ul className={styles.severityStrip} aria-label="Active incidents by severity">
        {[...INCIDENT_SEVERITIES].reverse().map((severity) => (
          <li
            key={severity}
            className={styles.severityCount}
            data-severity={severity}
            data-zero={counts[severity] === 0}
          >
            <strong>{counts[severity]}</strong>
            {severity}
          </li>
        ))}
      </ul>

      <div className={styles.connection} data-state={connection} role="status">
        {CONNECTION_LABEL[connection]}
      </div>
      <time className={styles.clock} dateTime={new Date(now).toISOString()}>
        {new Date(now).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })}
      </time>
      <div className={styles.sessionUser}>
        {/* Explains why the actions are missing; the API still refuses them (ADR-0011). */}
        {readOnly && <span className={styles.sessionAccess}>View only</span>}
        <span>{user?.displayName}</span>
        <button type="button" className={button.button} onClick={signOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
