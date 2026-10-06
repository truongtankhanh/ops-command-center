import type { Incident, Zone } from '@occ/contracts';
import { useRef } from 'react';
import { useIncidents, useZones } from '../api/queries';
import {
  FEED_FILTERS,
  feedEmptyMessage,
  formatAge,
  matchesFilter,
  matchesSeverity,
  severityLabel,
  typeLabel,
} from '../lib/incidents';
import { useNow } from '../lib/useNow';
import { useConsole } from '../store';
import { EmptyState } from '../ui/EmptyState';
import { FilterChip } from '../ui/FilterChip';
import { severityIcon } from '../ui/icons';
import { StatusChip } from '../ui/StatusChip';
import { Tabs } from '../ui/Tabs';
import styles from './IncidentFeed.module.css';

export function IncidentFeed() {
  const { data: incidents, isPending, isError } = useIncidents();
  const { data: zones = [] } = useZones();
  const filter = useConsole((s) => s.filter);
  const setFilter = useConsole((s) => s.setFilter);
  const severity = useConsole((s) => s.severity);
  const clearSeverity = useConsole((s) => s.clearSeverity);
  const now = useNow();
  const feedRef = useRef<HTMLElement>(null);

  const zoneName = new Map(zones.map((z: Zone) => [z.id, z.name]));
  const visible = (incidents ?? []).filter(
    (incident) => matchesFilter(incident, filter) && matchesSeverity(incident, severity),
  );

  // Clearing removes the chip and its focused button: focus goes to the selected tab, the nearest
  // stable control before it.
  const onClearSeverity = () => {
    clearSeverity();
    feedRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  };

  return (
    <aside ref={feedRef} className={styles.feed} aria-label="Incidents">
      <Tabs
        label="Filter incidents"
        tabs={FEED_FILTERS}
        value={filter}
        onChange={setFilter}
        className={styles.tabs}
        panelClassName={styles.panel}
      >
        {severity && (
          <FilterChip
            glyph={severityIcon(severity)}
            label={`${severityLabel(severity)} only`}
            clearLabel="Clear severity filter"
            onClear={onClearSeverity}
            data-severity={severity}
            className={styles.chip}
          />
        )}
        {isPending ? (
          <EmptyState>Loading incidents…</EmptyState>
        ) : isError ? (
          <EmptyState>Incidents could not be loaded. Check that the API is running.</EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState>{feedEmptyMessage(filter, severity)}</EmptyState>
        ) : (
          <ul className={styles.list}>
            {visible.map((incident) => (
              <li key={incident.id}>
                <IncidentRow incident={incident} zone={zoneName.get(incident.zoneId)} now={now} />
              </li>
            ))}
          </ul>
        )}
      </Tabs>
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
        <StatusChip status={incident.status} />
        <span>{typeLabel(incident.type)}</span>
        {zone && <span>{zone}</span>}
      </span>
    </button>
  );
}
