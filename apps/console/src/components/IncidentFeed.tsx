import type { Incident, Zone } from '@occ/contracts';
import { type KeyboardEvent, useCallback, useRef, useState } from 'react';
import { useIncidents, useZones } from '../api/queries';
import {
  countByFilter,
  FEED_FILTERS,
  feedEmptyMessage,
  matchesFilter,
  matchesQuery,
  matchesSeverity,
  searchTerms,
  severityLabel,
} from '../lib/incidents';
import { nextRowIndex } from '../lib/rowNavigation';
import { useNow } from '../lib/useNow';
import { useShortcut } from '../lib/useShortcut';
import { useConsole } from '../store';
import { EmptyState } from '../ui/EmptyState';
import { FilterChip } from '../ui/FilterChip';
import { severityIcon } from '../ui/icons';
import { Tabs } from '../ui/Tabs';
import { FeedSearch } from './FeedSearch';
import styles from './IncidentFeed.module.css';
import { IncidentRow } from './IncidentRow';

export function IncidentFeed() {
  const { data: incidents, isPending, isError } = useIncidents();
  const { data: zones = [] } = useZones();
  const filter = useConsole((s) => s.filter);
  const setFilter = useConsole((s) => s.setFilter);
  const severity = useConsole((s) => s.severity);
  const clearSeverity = useConsole((s) => s.clearSeverity);
  const selectedId = useConsole((s) => s.selectedIncidentId);
  const now = useNow();
  const [query, setQuery] = useState('');
  const [focusId, setFocusId] = useState<string | null>(null);
  const feedRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusSearch = useCallback(() => {
    searchRef.current?.focus();
    searchRef.current?.select();
  }, []);
  useShortcut('/', focusSearch, true);

  const zoneName = new Map(zones.map((z: Zone) => [z.id, z.name]));
  const terms = searchTerms(query);
  // Severity and search apply to every tab, so the tab counts use them too: each count is the
  // number of rows that tab would list.
  const matches = (incident: Incident) =>
    matchesSeverity(incident, severity) &&
    matchesQuery(incident, terms, zoneName.get(incident.zoneId));
  const loaded = !isPending && !isError;
  const visible = (incidents ?? []).filter(
    (incident) => matchesFilter(incident, filter) && matches(incident),
  );
  const counts = loaded && incidents ? countByFilter(incidents, matches) : null;
  const tabs = counts
    ? FEED_FILTERS.map((tab) => ({ ...tab, count: counts[tab.value] }))
    : FEED_FILTERS;
  const matchStatus =
    loaded && terms.length > 0
      ? `${visible.length} ${visible.length === 1 ? 'incident matches' : 'incidents match'}`
      : '';

  // One Tab stop for the whole list (roving tabindex): the row focused last, else the selected
  // one, else the first. Tracked by id, so a live insert or re-sort does not move it.
  const isVisible = (id: string | null) => id !== null && visible.some((i) => i.id === id);
  const tabStopId = isVisible(focusId)
    ? focusId
    : isVisible(selectedId)
      ? selectedId
      : visible[0]?.id;

  // Arrows move focus only. Opening an incident flies the map, too heavy for every key press, so
  // Enter / Space (the row's own button activation) select it.
  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const current = rowRefs.current.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    const next = nextRowIndex(event.key, current, visible.length);
    if (next === null) return;
    event.preventDefault();
    rowRefs.current[next]?.focus();
  };

  // Clearing removes the chip and its focused button: focus goes to the selected tab, the nearest
  // stable control before it.
  const onClearSeverity = () => {
    clearSeverity();
    feedRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  };

  return (
    <aside ref={feedRef} className={styles.feed} aria-label="Incidents">
      <FeedSearch value={query} onChange={setQuery} ref={searchRef} className={styles.search} />
      {/* Always mounted: screen readers announce a change in an existing live region. */}
      <p role="status" className={styles.hidden}>
        {matchStatus}
      </p>
      <Tabs
        label="Filter incidents"
        tabs={tabs}
        value={filter}
        onChange={setFilter}
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
          <EmptyState>{feedEmptyMessage(filter, severity, query)}</EmptyState>
        ) : (
          <ul className={styles.list} onKeyDown={onListKeyDown}>
            {visible.map((incident, index) => (
              <li key={incident.id}>
                <IncidentRow
                  incident={incident}
                  zone={zoneName.get(incident.zoneId)}
                  now={now}
                  ref={(element) => {
                    rowRefs.current[index] = element;
                  }}
                  tabIndex={incident.id === tabStopId ? 0 : -1}
                  onFocus={() => setFocusId(incident.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </Tabs>
    </aside>
  );
}
