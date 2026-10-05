import type { Incident, Zone } from '@occ/contracts';
import { useIncidents, useZones } from '../api/queries';
import { usePermission } from '../auth/usePermission';
import { FEED_FILTERS, formatAge, matchesFilter, statusLabel, typeLabel } from '../lib/incidents';
import { useNow } from '../lib/useNow';
import { useConsole } from '../store';
import button from '../styles/button.module.css';
import text from '../styles/text.module.css';
import styles from './IncidentFeed.module.css';

const EMPTY_MESSAGE = {
  active: 'No active incidents. New reports appear here as they come in.',
  resolved: 'Nothing resolved yet this shift.',
  all: 'No incidents recorded yet.',
} as const;

export function IncidentFeed() {
  const { data: incidents, isPending, isError } = useIncidents();
  const { data: zones = [] } = useZones();
  const { filter, setFilter, reporting, startReport } = useConsole();
  const canReport = usePermission('incident:report');
  const now = useNow();

  const zoneName = new Map(zones.map((z: Zone) => [z.id, z.name]));
  const visible = (incidents ?? []).filter((incident) => matchesFilter(incident, filter));

  return (
    <aside className={styles.feed} aria-label="Incidents">
      {canReport && (
        <div className={styles.actions}>
          <button
            type="button"
            className={button.button}
            data-variant="primary"
            aria-expanded={reporting}
            aria-controls="report-incident-panel"
            onClick={startReport}
          >
            Report incident
          </button>
        </div>
      )}
      <div className={styles.tabs} role="tablist" aria-label="Filter incidents">
        {FEED_FILTERS.map(({ value, label }) => (
          <button
            key={value}
            role="tab"
            className={styles.tab}
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {isPending ? (
        <p className={text.empty}>Loading incidents…</p>
      ) : isError ? (
        <p className={text.empty}>Incidents could not be loaded. Check that the API is running.</p>
      ) : visible.length === 0 ? (
        <p className={text.empty}>{EMPTY_MESSAGE[filter]}</p>
      ) : (
        <ul className={styles.list}>
          {visible.map((incident) => (
            <li key={incident.id}>
              <IncidentRow incident={incident} zone={zoneName.get(incident.zoneId)} now={now} />
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function IncidentRow({ incident, zone, now }: { incident: Incident; zone?: string; now: number }) {
  const selected = useConsole((s) => s.selectedIncidentId === incident.id);
  const fresh = useConsole((s) => s.fresh.has(incident.id));
  const select = useConsole((s) => s.select);

  return (
    <button
      className={styles.row}
      data-severity={incident.severity}
      data-status={incident.status}
      data-fresh={fresh}
      aria-current={selected}
      onClick={() => select(selected ? null : incident.id)}
    >
      <span className={styles.edge} aria-hidden />
      <span className={styles.title}>{incident.title}</span>
      <time className={styles.age} dateTime={incident.reportedAt}>
        {formatAge(incident.reportedAt, now)}
      </time>
      <span className={styles.meta}>
        <span className={styles.statusTag} data-status={incident.status}>
          {statusLabel(incident.status)}
        </span>
        <span>{typeLabel(incident.type)}</span>
        {zone && <span>{zone}</span>}
      </span>
    </button>
  );
}
