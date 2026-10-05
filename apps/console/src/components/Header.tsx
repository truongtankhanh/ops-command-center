import { INCIDENT_SEVERITIES } from '@occ/contracts';
import { useIncidents } from '../api/queries';
import { useSession } from '../auth/store';
import { useReadOnly } from '../auth/usePermission';
import { useSignOut } from '../auth/useSignOut';
import { countActiveBySeverity } from '../lib/incidents';
import { useNow } from '../lib/useNow';
import { useConsole } from '../store';

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
    <header className="header">
      <div>
        <h1 className="header-title">Operations</h1>
        <div className="header-site">Langbiang Tech Campus</div>
      </div>

      <ul className="severity-strip" aria-label="Active incidents by severity">
        {[...INCIDENT_SEVERITIES].reverse().map((severity) => (
          <li
            key={severity}
            className="severity-count"
            data-severity={severity}
            data-zero={counts[severity] === 0}
          >
            <strong>{counts[severity]}</strong>
            {severity}
          </li>
        ))}
      </ul>

      <div className="connection" data-state={connection} role="status">
        {CONNECTION_LABEL[connection]}
      </div>
      <time className="clock" dateTime={new Date(now).toISOString()}>
        {new Date(now).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })}
      </time>
      <div className="session-user">
        {/* Explains why the actions are missing; the API still refuses them (ADR-0011). */}
        {readOnly && <span className="session-access">View only</span>}
        <span>{user?.displayName}</span>
        <button type="button" className="button" onClick={signOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
