import type { Incident, Zone } from '@occ/contracts';
import { type KeyboardEvent, useCallback, useRef, useState } from 'react';
import { isRateLimited } from '../../api/client';
import { useIncidents, useZones } from '../../api/queries';
import { useRoles } from '../../auth/usePermission';
import {
  categoryLabel,
  categoryTag,
  countByFilter,
  feedEmptyMessage,
  feedFiltersFor,
  handlingScope,
  hasLimitedScope,
  matchesCategory,
  matchesFilter,
  matchesQuery,
  matchesSeverity,
  offeredFilter,
  searchTerms,
  severityLabel,
} from '../../lib/incidents/incidents';
import { groupByZone, groupedEntries, groupIdOf } from '../../lib/incidents/groupByZone';
import { nextRowIndex } from '../../lib/incidents/rowNavigation';
import { useAlarmLoad } from '../../lib/incidents/useAlarmLoad';
import { formatClockTime } from '../../lib/shared/time';
import { useNow } from '../../lib/shared/useNow';
import { useShortcut } from '../../lib/shell/useShortcut';
import { useConsole } from '../../store';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { FilterChip } from '../../ui/FilterChip';
import { Icon } from '../../ui/Icon';
import { categoryIcon, Clock, Search, severityIcon } from '../../ui/icons';
import { Skeleton } from '../../ui/Skeleton';
import { Tabs } from '../../ui/Tabs';
import { CategoryFilter } from './CategoryFilter';
import { FeedSearch } from './FeedSearch';
import styles from './IncidentFeed.module.css';
import { IncidentRow } from './IncidentRow';
import { LoadFailed, RateLimited } from '../shell/LoadStates';
import { ZoneGroupRow } from './ZoneGroupRow';

/** As many placeholder rows as a short shift's list, enough to fill the column's first screen. */
const SKELETON_ROWS = 5;

export function IncidentFeed() {
  const { data: incidents, error, failureReason, isPending, isFetching, refetch } = useIncidents();
  const { data: zoneList } = useZones();
  const zones = zoneList ?? [];
  const storedFilter = useConsole((s) => s.filter);
  const setFilter = useConsole((s) => s.setFilter);
  const roles = useRoles();
  const severity = useConsole((s) => s.severity);
  const clearSeverity = useConsole((s) => s.clearSeverity);
  const category = useConsole((s) => s.category);
  const setCategory = useConsole((s) => s.setCategory);
  const offlineSince = useConsole((s) => s.offlineSince);
  // The operator's choice to see one row per zone (V3-21.4); it groups only while a flood lasts, see `grouping` below.
  const groupingChosen = useConsole((s) => s.groupByZone);
  const setGroupByZone = useConsole((s) => s.setGroupByZone);
  const { flood } = useAlarmLoad();
  const selectedId = useConsole((s) => s.selectedIncidentId);
  const now = useNow();
  const [query, setQuery] = useState('');
  const [focusId, setFocusId] = useState<string | null>(null);
  // The zones the operator opened in the grouped list. Feed-local and kept when grouping is switched off and on again.
  const [expandedZones, setExpandedZones] = useState<ReadonlySet<string>>(() => new Set());
  // Both panels stay mounted (`SidePanel`), so the key belongs to the visible one only.
  const visiblePanel = useConsole((s) => s.sidePanel === 'incidents');
  const feedRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const categoryButtonRef = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusSearch = useCallback(() => {
    searchRef.current?.focus();
    searchRef.current?.select();
  }, []);
  useShortcut('/', focusSearch, visiblePanel);

  // A technician's tabs are Active · Mine to handle · All, everyone else's Active · Resolved · All.
  // The stored filter may be one the user is not offered (roles change on token renewal): show
  // Active then, rather than a list under no selected tab.
  const offered = feedFiltersFor(roles);
  const filter = offeredFilter(storedFilter, offered);
  const scope = handlingScope(roles);
  const tagged = hasLimitedScope(roles);

  const zoneName = new Map(zones.map((z: Zone) => [z.id, z.name]));
  const terms = searchTerms(query);
  // Severity, category and search apply to every tab, so the tab counts use them too: each count is the
  // number of rows that tab would list.
  const matches = (incident: Incident) =>
    matchesSeverity(incident, severity) &&
    matchesCategory(incident, category) &&
    matchesQuery(incident, terms, zoneName.get(incident.zoneId));
  // Data first: a failed background refetch keeps the list (TanStack keeps it), so only a list that
  // never arrived counts as not loaded.
  const loaded = incidents !== undefined;
  const visible = (incidents ?? []).filter(
    (incident) => matchesFilter(incident, filter, scope) && matches(incident),
  );
  const counts = loaded && incidents ? countByFilter(incidents, matches, scope) : null;
  const tabs = counts ? offered.map((tab) => ({ ...tab, count: counts[tab.value] })) : offered;
  const matchStatus =
    loaded && terms.length > 0
      ? `${visible.length} ${visible.length === 1 ? 'incident matches' : 'incidents match'}`
      : '';

  // Grouped by zone (V3-21.4) only while the operator asked for it, a flood lasts, the zones are known (before that every incident
  // would be "Other zone") and there is something to list. Made from `visible`, so the tab, severity, category and search keep
  // working on the rows. When the flood ends the plain list is back whatever the stored choice says.
  const grouping =
    groupingChosen && flood.flooding && zoneList !== undefined && loaded && visible.length > 0;
  const groups = grouping ? groupByZone(visible, zones) : [];
  const entries = groupedEntries(groups, expandedZones);
  const toggleZone = (zoneId: string) =>
    setExpandedZones((current) => {
      const next = new Set(current);
      if (!next.delete(zoneId)) next.add(zoneId);
      return next;
    });

  // One Tab stop for the whole list (roving tabindex): the row focused last, else the selected
  // one, else the first. Tracked by id, so a live insert or re-sort does not move it. The ids are
  // those of the rows that are drawn: while grouped they are the groups' and the opened groups'
  // incidents, and a selected incident inside a closed group puts the tab stop on its group.
  const rowIds = grouping ? entries.map((entry) => entry.id) : visible.map((i) => i.id);
  const isRow = (id: string | null) => id !== null && rowIds.includes(id);
  const selectedRow =
    selectedId === null ? null : isRow(selectedId) ? selectedId : groupIdOf(groups, selectedId);
  const tabStopId = isRow(focusId) ? focusId : (selectedRow ?? rowIds[0]);

  // Arrows move focus only. Opening an incident flies the map, too heavy for every key press, so
  // Enter / Space (the row's own button activation) select it.
  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const current = rowRefs.current.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    const next = nextRowIndex(event.key, current, rowIds.length);
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

  // "Show all" removes its own button: focus goes to the selected tab, the nearest stable control before it.
  const onShowAll = () => {
    setGroupByZone(false);
    feedRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  };

  // Clearing removes the chip and its focused button: focus goes to the filter button, which stays (V3-07.3).
  const onClearCategory = () => {
    setCategory(null);
    categoryButtonRef.current?.focus();
  };

  return (
    <section ref={feedRef} id="incident-feed" className={styles.feed} aria-label="Incidents">
      <div className={styles.top}>
        <FeedSearch value={query} onChange={setQuery} ref={searchRef} className={styles.search} />
        <CategoryFilter category={category} onChange={setCategory} triggerRef={categoryButtonRef} />
      </div>
      {/* Always mounted: screen readers announce a change in an existing live region. */}
      <p role="status" className={styles.hidden}>
        {matchStatus}
      </p>
      <Tabs
        label="Filter incidents"
        tabs={tabs}
        value={filter}
        onChange={setFilter}
        appearance="chips"
        panelClassName={styles.panel}
      >
        {(severity || category) && (
          <div className={styles.chips}>
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
            {category && (
              <FilterChip
                glyph={categoryIcon(category)}
                label={`${categoryLabel(category)} only`}
                clearLabel="Clear category filter"
                onClear={onClearCategory}
                className={styles.chip}
              />
            )}
          </div>
        )}
        {/* Frame 05: while the live link is down, the list may be stale; the stage's banner says so. */}
        {loaded && offlineSince !== null && (
          <p className={styles.notice}>
            <Icon glyph={Clock} size={14} />
            Showing incidents as of {formatClockTime(offlineSince)}
          </p>
        )}
        {/* Not a live region: the flood banner (V3-21.4) announces the flood, and the switch says its own state. */}
        {grouping && (
          <div className={styles.notice}>
            <span>Grouped by zone ·</span>
            <Button size="sm" variant="ghost" onClick={onShowAll}>
              Show all
            </Button>
          </div>
        )}
        {isPending ? (
          isRateLimited(failureReason) ? (
            <RateLimited className={styles.rateLimited} />
          ) : (
            <FeedSkeleton />
          )
        ) : !loaded ? (
          <LoadFailed
            error={error}
            fallback="Incidents could not be loaded."
            isFetching={isFetching}
            onRetry={() => void refetch()}
            className={styles.state}
          />
        ) : visible.length === 0 ? (
          <FeedEmpty
            message={feedEmptyMessage(filter, severity, query, scope, category)}
            searching={query.trim() !== ''}
            bySeverity={severity !== null}
            byCategory={category !== null}
            onClearSeverity={onClearSeverity}
            onClearCategory={onClearCategory}
          />
        ) : (
          <ul className={styles.list} onKeyDown={onListKeyDown}>
            {grouping
              ? entries.map((entry, index) => (
                  <li key={entry.id} data-grouped={entry.kind === 'incident' ? true : undefined}>
                    {entry.kind === 'group' ? (
                      <ZoneGroupRow
                        group={entry.group}
                        expanded={expandedZones.has(entry.group.zoneId)}
                        onToggle={() => toggleZone(entry.group.zoneId)}
                        ref={(element) => {
                          rowRefs.current[index] = element;
                        }}
                        tabIndex={entry.id === tabStopId ? 0 : -1}
                        onFocus={() => setFocusId(entry.id)}
                      />
                    ) : (
                      <IncidentRow
                        incident={entry.incident}
                        zone={zoneName.get(entry.incident.zoneId)}
                        tag={tagged ? categoryTag(entry.incident, scope) : undefined}
                        now={now}
                        ref={(element) => {
                          rowRefs.current[index] = element;
                        }}
                        tabIndex={entry.id === tabStopId ? 0 : -1}
                        onFocus={() => setFocusId(entry.id)}
                      />
                    )}
                  </li>
                ))
              : visible.map((incident, index) => (
                  <li key={incident.id}>
                    <IncidentRow
                      incident={incident}
                      zone={zoneName.get(incident.zoneId)}
                      tag={tagged ? categoryTag(incident, scope) : undefined}
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
    </section>
  );
}

/** Shaped like `IncidentRow` (tile, title, chip line, foot line), so the list does not jump when it arrives. */
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
          <Skeleton className={styles.skeletonChip} />
          <Skeleton className={styles.skeletonMeta} />
        </div>
      ))}
    </div>
  );
}

/**
 * Nothing to list (Q4): the message always says why. A search gets the search glyph and no action:
 * the search box's own "Clear search" sits right above it. Otherwise each filter that is on offers to
 * show everything again: every severity, every category, or both buttons when both are on. Only the
 * search gets a glyph: the severity and status glyphs mean something else in this console.
 */
function FeedEmpty({
  message,
  searching,
  bySeverity,
  byCategory,
  onClearSeverity,
  onClearCategory,
}: {
  message: string;
  searching: boolean;
  bySeverity: boolean;
  byCategory: boolean;
  onClearSeverity: () => void;
  onClearCategory: () => void;
}) {
  if (searching) {
    return (
      <EmptyState icon={Search} className={styles.state}>
        {message}
      </EmptyState>
    );
  }
  if (bySeverity || byCategory) {
    return (
      <EmptyState
        className={styles.state}
        action={
          <>
            {bySeverity && <Button onClick={onClearSeverity}>Show all severities</Button>}
            {byCategory && <Button onClick={onClearCategory}>Show all categories</Button>}
          </>
        }
      >
        {message}
      </EmptyState>
    );
  }
  return <EmptyState className={styles.state}>{message}</EmptyState>;
}
