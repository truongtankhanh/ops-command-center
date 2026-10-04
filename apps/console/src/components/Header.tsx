import { INCIDENT_SEVERITIES } from '@occ/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useIncidents } from '../api/queries';
import { signOut } from '../auth/session';
import { useSession } from '../auth/store';
import { countActiveBySeverity } from '../lib/incidents';
import { useNow } from '../lib/useNow';
import { useConsole } from '../store';

const CONNECTION_LABEL = { live: 'Live', connecting: 'Connecting…', offline: 'Offline' } as const;

export function Header() {
  const { data: incidents = [] } = useIncidents();
  const connection = useConsole((s) => s.connection);
  const user = useSession((s) => s.user);
  const queryClient = useQueryClient();
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
        <span>{user?.displayName}</span>
        <button
          type="button"
          className="button"
          onClick={() => {
            // signOut() switches the session status before its first await, so the console
            // unmounts in this render and nothing refetches into the cleared cache: the next
            // operator at this workstation sees none of this session's data.
            void signOut();
            queryClient.clear();
          }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
