import type { Incident, Zone } from '@occ/contracts';
import { type KeyboardEvent, useCallback, useRef, useState } from 'react';
import { isRateLimited } from '../api/client';
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
import { formatClockTime } from '../lib/time';
import { useNow } from '../lib/useNow';
import { useShortcut } from '../lib/useShortcut';
import { useConsole } from '../store';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { FilterChip } from '../ui/FilterChip';
import { Icon } from '../ui/Icon';
import { Clock, Search, severityIcon } from '../ui/icons';
import { Skeleton } from '../ui/Skeleton';
import { Tabs } from '../ui/Tabs';
import { FeedSearch } from './FeedSearch';
import styles from './IncidentFeed.module.css';
import { IncidentRow } from './IncidentRow';
import { LoadFailed, RateLimited } from './LoadStates';

/** As many placeholder rows as a short shift's list, enough to fill the column's first screen. */
const SKELETON_ROWS = 5;

export function IncidentFeed() {
  const { data: incidents, error, failureReason, isPending, isFetching, refetch } = useIncidents();
  const { data: zones = [] } = useZones();
  const filter = useConsole((s) => s.filter);
  const setFilter = useConsole((s) => s.setFilter);
  const severity = useConsole((s) => s.severity);
  const clearSeverity = useConsole((s) => s.clearSeverity);
  const offlineSince = useConsole((s) => s.offlineSince);
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
  // Data first: a failed background refetch keeps the list (TanStack keeps it), so only a list that
  // never arrived counts as not loaded.
  const loaded = incidents !== undefined;
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
    <aside ref={feedRef} id="incident-feed" className={styles.feed} aria-label="Incidents">
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
        {/* Frame 05: while the live link is down, the list may be stale; the stage's banner says so. */}
        {loaded && offlineSince !== null && (
          <p className={styles.notice}>
            <Icon glyph={Clock} size={14} />
            Showing incidents as of {formatClockTime(offlineSince)}
          </p>
        )}
        {isPending ? (
          isRateLimited(failureReason) ? (
            <RateLimited />
          ) : (
            <FeedSkeleton />
          )
        ) : !loaded ? (
          <LoadFailed
            error={error}
            fallback="Incidents could not be loaded."
            isFetching={isFetching}
            onRetry={() => void refetch()}
          />
        ) : visible.length === 0 ? (
          <FeedEmpty
            message={feedEmptyMessage(filter, severity, query)}
            searching={query.trim() !== ''}
            filtered={severity !== null}
            onClearSeverity={onClearSeverity}
          />
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

/** Shaped like `IncidentRow` (tile, title, meta line), so the list does not jump when it arrives. */
function FeedSkeleton() {
  return (
    <div className={styles.list} aria-busy="true">
      <p role="status" className={styles.hidden}>
        Loading incidents…
      </p>
      {Array.from({ length: SKELETON_ROWS }, (_, row) => (
        <div key={row} className={styles.skeletonRow}>
          <Skeleton className={styles.skeletonTile} />
          <Skeleton className={styles.skeletonTitle} />
          <Skeleton className={styles.skeletonMeta} />
        </div>
      ))}
    </div>
  );
}

/**
 * Nothing to list (Q4): the message always says why. A search gets the search glyph and no action:
 * the search box's own "Clear search" sits right above it. Otherwise a severity filter offers to
 * show every severity. Only the search gets a glyph: the severity and status glyphs mean something
 * else in this console.
 */
function FeedEmpty({
  message,
  searching,
  filtered,
  onClearSeverity,
}: {
  message: string;
  searching: boolean;
  filtered: boolean;
  onClearSeverity: () => void;
}) {
  if (searching) return <EmptyState icon={Search}>{message}</EmptyState>;
  if (filtered) {
    return (
      <EmptyState action={<Button onClick={onClearSeverity}>Show all severities</Button>}>
        {message}
      </EmptyState>
    );
  }
  return <EmptyState>{message}</EmptyState>;
}
