import type { Incident } from '@occ/contracts';
import { type KeyboardEvent, type Ref, useId, useRef, useState } from 'react';
import { isRateLimited } from '../../api/client';
import { attentionCountdown, formatCountdown } from '../../lib/incidents/attentionCountdown';
import {
  ariaSortOf,
  nextSort,
  sortIncidents,
  TABLE_COLUMNS,
  type TableColumnKey,
} from '../../lib/incidents/incidentTable';
import {
  CSV_BOM,
  csvFilename,
  type IncidentCsvContext,
  incidentsToCsv,
} from '../../lib/incidents/incidentCsv';
import { formatClock, sourceLabel, typeLabel } from '../../lib/incidents/incidents';
import { nextRowIndex } from '../../lib/incidents/rowNavigation';
import { useCountdownNow } from '../../lib/incidents/useCountdownNow';
import { useFeedRows } from '../../lib/incidents/useFeedRows';
import { INCIDENT_TABLE_ID } from '../../lib/incidents/useIncidentTableShown';
import { downloadText } from '../../lib/shared/download';
import { formatClockTime } from '../../lib/shared/time';
import { useConsole } from '../../store';
import { Button } from '../../ui/Button';
import { CountdownRing } from '../../ui/CountdownRing';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Clock, Download, incidentTypeIcon, Search, sortIcon } from '../../ui/icons';
import { SeverityBadge } from '../../ui/SeverityBadge';
import { Skeleton } from '../../ui/Skeleton';
import { StatusChip } from '../../ui/StatusChip';
import { LoadFailed, RateLimited } from '../shell/LoadStates';
import { FEED_VIEW_SWITCH_ID } from './FeedViewSwitch';
import styles from './IncidentTable.module.css';

/** As many placeholder rows as fill the stage's first screen at the table's row height. */
const SKELETON_ROWS = 8;

/** Why Export CSV does nothing: its title, and the description a keyboard or screen reader user hears. */
const NO_EXPORT = 'No incidents to export';

/** The toolbar's count: "1 incident", "37 incidents", "0 incidents". */
const incidentCount = (count: number): string =>
  `${count} ${count === 1 ? 'incident' : 'incidents'}`;

/**
 * Saves `rows` as CSV, named by the moment of the press. Outside the component, so reading the clock is plainly an event's
 * work and never a render's (the React Compiler's purity rule cannot tell a handler's closure from render code).
 */
function saveCsv(rows: readonly Incident[], zoneName: IncidentCsvContext['zoneName']): void {
  downloadText(
    csvFilename(Date.now()),
    CSV_BOM + incidentsToCsv(rows, { zoneName }),
    'text/csv;charset=utf-8',
  );
}

/**
 * The incident table over the stage (V3-24.4, frame 19, brief § Table mode): the same incidents the sidebar list shows, one
 * row each under eight sortable columns, for a supervisor with dozens of incidents or a flood. The list stays the default view
 * and the sidebar stays beside the table.
 *
 * - **The same rows as the list.** They come from `useFeedRows`, the hook the list reads, so the tab, the severity chip, the
 *   category and the search apply here exactly as there; the sidebar's chips and search box stay the controls.
 * - **The order** is `sortIncidents` (V3-24.1) by the sort remembered in this browser (`tableSort`, V3-24.3), or the list's own
 *   order when there is none. Each header is a button that steps that column through its first direction, the opposite and
 *   back to the list's order (`nextSort`); `aria-sort` on the header cell says which.
 * - **Placement** is `App`'s: an overlay over the stage that never resizes it (V1 principle 6), clear of an open inspector
 *   (`--sheet-inset`).
 * - **The states** are the list's, in its order: rate-limited, loading, failed with Retry, nothing to show, with the offline
 *   notice above. The loading rows say nothing to assistive tech, because the list's skeleton already says "Loading
 *   incidents…" and the table must not say it twice; the section is `aria-busy` instead. The empty state is the list's message
 *   with no button, the sidebar's chips being the way to widen the filter.
 * - **Clock.** `useCountdownNow(visible)`, like the list's: one timer for the table, every second only while an open incident is
 *   within ten minutes of its attention threshold. The Attention text is plain cell text and never a live region, so a screen
 *   reader reads it when the cell is visited, not every second. The threshold is display only, never an SLA (V1 Approved
 *   decision 3).
 *
 * - **Opening a row** (V3-24.5) is the list's: a click anywhere on the row, or Enter / Space on its button, calls the store's
 *   `select`, the action `IncidentRow` calls, so whatever follows a selection there (the inspector, the camera) follows it
 *   here and nothing is duplicated; a second press closes it. The selected row is `aria-current`, on the row for its look
 *   and on its button so the state is heard on focus.
 * - **Keys over the rows** are the list's too: one Tab stop for all of them (the row focused last, else the selected one,
 *   else the first; tracked by id, so a live insert, a re-sort or a tick does not move it), ↑ / ↓ / Home / End move focus
 *   and never select (opening flies the map, too heavy for every key press), Enter / Space open, Tab leaves. The sort
 *   buttons in the header are ordinary Tab stops before them.
 * - **Esc** with focus in the table and no sheet open moves focus to the List | Table switch and keeps the table: the table
 *   is a view, not a dialog. With a sheet open it does nothing here, as on a list row; the sheet's own Escape acts only while
 *   focus is in the sheet, and gives focus back to the row that opened it.
 *
 * - **The toolbar** (V3-24.6) is drawn in every state, above the rows. Its count is how many incidents the table lists, the
 *   same number as the rows and the file. The table's one live region is a hidden line beside it that says the count as of
 *   the last change of the tab, severity, category or search (or of the list arriving): a filter change is announced once
 *   (the list's own line is silent while the table shows), and an incident arriving in a flood is not queued for a screen
 *   reader. **Export CSV** saves exactly the rows shown, in their order, with the header, as CSV built in this browser
 *   (`incidentsToCsv`, after `CSV_BOM` so Excel reads UTF-8; no request, nothing stored, no audit). Every role may use it:
 *   the file holds only the table's fields, which every role already reads. With nothing to export it stays a Tab stop,
 *   `aria-disabled` with its reason, as the 3D option of the view switch does, and a press does nothing.
 *
 * Frame 19 also draws a head row (the tab chips, a search box, Export CSV, Close) and a foot line ("Esc closes the table").
 * They are left out on purpose: the sidebar's chips and search are the controls, the List | Table switch is the way in and
 * out, Esc keeps the table, and Export CSV is in the toolbar.
 */
export function IncidentTable() {
  const {
    error,
    failureReason,
    isPending,
    isFetching,
    refetch,
    loaded,
    zoneName,
    filter,
    severity,
    category,
    query,
    visible,
    emptyMessage,
  } = useFeedRows();
  const now = useCountdownNow(visible);
  const tableSort = useConsole((s) => s.tableSort);
  const setTableSort = useConsole((s) => s.setTableSort);
  const selectedId = useConsole((s) => s.selectedIncidentId);
  const select = useConsole((s) => s.select);
  // The rule `App` uses for drawing the sheet: an incident, an asset or the report form.
  const sheetOpen = useConsole(
    (s) => s.selectedIncidentId !== null || s.selectedAssetCode !== null || s.reporting,
  );
  const offlineSince = useConsole((s) => s.offlineSince);
  const [focusId, setFocusId] = useState<string | null>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const reasonId = useId();

  const rows = sortIncidents(visible, tableSort, { zoneName, now });
  const sortBy = (key: TableColumnKey) => setTableSort(nextSort(tableSort, key));
  const count = loaded ? incidentCount(rows.length) : '';

  // What the live line says: the count as of the last filter change, or of the list arriving. Adjusted during render when
  // that key changes (no effect, so it is never a render late); an arrival changes the visible count only.
  const filterKey = `${loaded}|${filter}|${severity ?? ''}|${category ?? ''}|${query}`;
  const [announced, setAnnounced] = useState({ key: filterKey, text: count });
  if (announced.key !== filterKey) setAnnounced({ key: filterKey, text: count });

  // The very rows the body draws, so the count, the table and the file agree. Built on the press only, never in render.
  const exportable = loaded && rows.length > 0;
  const exportRows = () => {
    if (exportable) saveCsv(rows, zoneName);
  };

  // One Tab stop for the rows, as `IncidentFeed`'s (without its grouping): in the drawn order, which is the sorted one.
  const rowIds = rows.map((incident) => incident.id);
  const isRow = (id: string | null) => id !== null && rowIds.includes(id);
  const tabStopId = isRow(focusId) ? focusId : isRow(selectedId) ? selectedId : rowIds[0];

  // Arrows move focus only; the row's own button activation (Enter / Space) opens. The sort buttons are not in `rowRefs`.
  const onRowsKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>) => {
    const current = rowRefs.current.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    const next = nextRowIndex(event.key, current, rowIds.length);
    if (next === null) return;
    event.preventDefault();
    rowRefs.current[next]?.focus();
  };

  // Esc keeps the table and hands focus to the switch, the way in and out of it; with a sheet open it is left alone.
  const onTableKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented) return;
    if (sheetOpen) return;
    event.preventDefault();
    document
      .querySelector<HTMLElement>(`#${FEED_VIEW_SWITCH_ID} [role="radio"][aria-checked="true"]`)
      ?.focus();
  };

  return (
    <section
      id={INCIDENT_TABLE_ID}
      className={styles.overlay}
      aria-label="Incident table"
      aria-busy={isPending || undefined}
      onKeyDown={onTableKeyDown}
    >
      <div className={styles.toolbar}>
        <p className={styles.count}>{count}</p>
        <p role="status" className={styles.hidden}>
          {announced.text}
        </p>
        <Button
          variant="ghost"
          size="dense"
          icon={Download}
          className={styles.export}
          title={exportable ? undefined : NO_EXPORT}
          aria-disabled={exportable ? undefined : true}
          aria-describedby={exportable ? undefined : reasonId}
          onClick={exportRows}
        >
          Export CSV
        </Button>
        {/* Always rendered, so the description is there the moment the button becomes unavailable. */}
        <span id={reasonId} className={styles.hidden}>
          {NO_EXPORT}
        </span>
      </div>
      {/* As the list says it (frame 05): while the live link is down, the rows may be stale. Not a live region. */}
      {loaded && offlineSince !== null && (
        <p className={styles.notice}>
          <Icon glyph={Clock} size={14} />
          Showing incidents as of {formatClockTime(offlineSince)}
        </p>
      )}
      {isPending ? (
        isRateLimited(failureReason) ? (
          <RateLimited className={styles.rateLimited} />
        ) : (
          <TableSkeleton />
        )
      ) : !loaded ? (
        <LoadFailed
          error={error}
          fallback="Incidents could not be loaded."
          isFetching={isFetching}
          onRetry={() => void refetch()}
          className={styles.state}
        />
      ) : rows.length === 0 ? (
        <EmptyState icon={query.trim() !== '' ? Search : undefined} className={styles.state}>
          {emptyMessage}
        </EmptyState>
      ) : (
        <div className={styles.scroller}>
          <table className={styles.table}>
            <caption className={styles.hidden}>Incidents</caption>
            <thead>
              <tr>
                {TABLE_COLUMNS.map((column) => {
                  const sorted = ariaSortOf(column.key, tableSort);
                  return (
                    <th key={column.key} scope="col" data-column={column.key} aria-sort={sorted}>
                      {column.sortable ? (
                        <button
                          type="button"
                          className={styles.sort}
                          onClick={() => sortBy(column.key)}
                        >
                          {column.label}
                          <Icon glyph={sortIcon(sorted)} size={14} />
                        </button>
                      ) : (
                        column.label
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody onKeyDown={onRowsKeyDown}>
              {rows.map((incident, index) => {
                const selected = incident.id === selectedId;
                return (
                  <TableRow
                    key={incident.id}
                    incident={incident}
                    zone={zoneName.get(incident.zoneId)}
                    selected={selected}
                    now={now}
                    rowRef={(element) => {
                      rowRefs.current[index] = element;
                    }}
                    tabIndex={incident.id === tabStopId ? 0 : -1}
                    onFocus={() => setFocusId(incident.id)}
                    onToggle={() => select(selected ? null : incident.id)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** An overdue time already reads "+m:ss over"; only a time still left needs its word, as the list row says it. */
const countdownLabel = (remainingMs: number): string =>
  remainingMs > 0 ? `${formatCountdown(remainingMs)} left` : formatCountdown(remainingMs);

/**
 * One incident as a table row: one cell per `TABLE_COLUMNS` entry, in that order. Each cell carries its column's key, so the
 * stylesheet can hide Place and Code on a narrow stage. The severity is its chip with the word (not decorative: the cell is
 * read on its own), the type a glyph whose word is read before the title, as the list row says it.
 *
 * The Incident cell is the row's button: its name is the type and title, and it is the row's one focusable element (the table
 * passes the roving `tabIndex`, `rowRef` and `onFocus`). The click is handled once, on the row: a mouse click anywhere on it,
 * and the click a button fires for Enter and Space, both reach it, so the button has no handler of its own and a press never
 * toggles twice.
 */
function TableRow({
  incident,
  zone,
  selected,
  now,
  rowRef,
  tabIndex,
  onFocus,
  onToggle,
}: {
  incident: Incident;
  zone: string | undefined;
  selected: boolean;
  now: number;
  rowRef: Ref<HTMLButtonElement>;
  tabIndex: number;
  onFocus: () => void;
  onToggle: () => void;
}) {
  // `null` for an acknowledged or resolved incident: no countdown, as the list shows none.
  const left = attentionCountdown(incident, now);
  // The button's name: the type and the title as one text node.
  const name = `${typeLabel(incident.type)}: ${incident.title}`;
  return (
    <tr
      data-severity={incident.severity}
      data-status={incident.status}
      aria-current={selected ? 'true' : undefined}
      onClick={onToggle}
    >
      <td data-column="severity">
        <SeverityBadge severity={incident.severity} size="s" />
      </td>
      <td data-column="incident">
        <button
          ref={rowRef}
          type="button"
          className={styles.open}
          tabIndex={tabIndex}
          onFocus={onFocus}
          aria-current={selected ? 'true' : undefined}
        >
          <span className={styles.incident}>
            <span className={styles.tile} aria-hidden="true">
              <Icon glyph={incidentTypeIcon(incident.type)} size={16} />
            </span>
            {/*
              The type and the title read as one text node: an accessible name trims each element's text, so a hidden
              "Fire: " beside a visible title would read "Fire:Smoke detector". The visible title is the duplicate, hidden.
            */}
            <span className={styles.hidden}>{name}</span>
            <span className={styles.title} title={incident.title} aria-hidden="true">
              {incident.title}
            </span>
          </span>
        </button>
      </td>
      {/* Empty for a zone the loaded zones lack, as the CSV writes it (V3-24.2). */}
      <td data-column="place">{zone}</td>
      <td data-column="status">
        <StatusChip status={incident.status} />
      </td>
      <td data-column="source">{sourceLabel(incident.source)}</td>
      <td data-column="raised">
        <time dateTime={incident.reportedAt} className={styles.figure}>
          {formatClock(incident.reportedAt, now)}
        </time>
      </td>
      <td data-column="attention">
        {left ? (
          <span className={styles.countdown} data-attention={left.state}>
            <CountdownRing fraction={left.fraction} state={left.state} />
            {countdownLabel(left.remainingMs)}
          </span>
        ) : (
          <>
            <span aria-hidden="true" className={styles.none}>
              —
            </span>
            <span className={styles.hidden}>No countdown</span>
          </>
        )}
      </td>
      <td data-column="code" className={styles.figure}>
        {incident.code}
      </td>
    </tr>
  );
}

/** Shaped like the table's rows (the sticky header is not drawn yet), so nothing jumps when the list arrives. */
function TableSkeleton() {
  return (
    <div className={styles.skeleton}>
      {Array.from({ length: SKELETON_ROWS }, (_, row) => (
        <div key={row} className={styles.skeletonRow}>
          <Skeleton className={styles.skeletonChip} />
          <Skeleton className={styles.skeletonTitle} />
          <Skeleton className={styles.skeletonMeta} />
        </div>
      ))}
    </div>
  );
}
