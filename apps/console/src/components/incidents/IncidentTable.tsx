import type { Incident } from '@occ/contracts';
import { isRateLimited } from '../../api/client';
import { attentionCountdown, formatCountdown } from '../../lib/incidents/attentionCountdown';
import {
  ariaSortOf,
  nextSort,
  sortIncidents,
  TABLE_COLUMNS,
  type TableColumnKey,
} from '../../lib/incidents/incidentTable';
import { formatClock, sourceLabel, typeLabel } from '../../lib/incidents/incidents';
import { useCountdownNow } from '../../lib/incidents/useCountdownNow';
import { useFeedRows } from '../../lib/incidents/useFeedRows';
import { formatClockTime } from '../../lib/shared/time';
import { useConsole } from '../../store';
import { CountdownRing } from '../../ui/CountdownRing';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Clock, incidentTypeIcon, Search, sortIcon } from '../../ui/icons';
import { SeverityBadge } from '../../ui/SeverityBadge';
import { Skeleton } from '../../ui/Skeleton';
import { StatusChip } from '../../ui/StatusChip';
import { LoadFailed, RateLimited } from '../shell/LoadStates';
import styles from './IncidentTable.module.css';

/** As many placeholder rows as fill the stage's first screen at the table's row height. */
const SKELETON_ROWS = 8;

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
 * Frame 19 also draws a head row (the tab chips, a search box, Export CSV, Close) and a foot line ("Esc closes the table").
 * They are left out on purpose: the sidebar's chips and search are the controls, the List | Table switch is the way in and
 * out, Esc keeps the table (V3-24.5), and the count and Export CSV are V3-24.6's toolbar. Opening a row and the keys over the
 * rows are V3-24.5's; the selected row is drawn here.
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
    query,
    visible,
    emptyMessage,
  } = useFeedRows();
  const now = useCountdownNow(visible);
  const tableSort = useConsole((s) => s.tableSort);
  const setTableSort = useConsole((s) => s.setTableSort);
  const selectedId = useConsole((s) => s.selectedIncidentId);
  const offlineSince = useConsole((s) => s.offlineSince);

  const rows = sortIncidents(visible, tableSort, { zoneName, now });
  const sortBy = (key: TableColumnKey) => setTableSort(nextSort(tableSort, key));

  return (
    <section
      className={styles.overlay}
      aria-label="Incident table"
      aria-busy={isPending || undefined}
    >
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
            <tbody>
              {rows.map((incident) => (
                <TableRow
                  key={incident.id}
                  incident={incident}
                  zone={zoneName.get(incident.zoneId)}
                  selected={incident.id === selectedId}
                  now={now}
                />
              ))}
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
 */
function TableRow({
  incident,
  zone,
  selected,
  now,
}: {
  incident: Incident;
  zone: string | undefined;
  selected: boolean;
  now: number;
}) {
  // `null` for an acknowledged or resolved incident: no countdown, as the list shows none.
  const left = attentionCountdown(incident, now);
  return (
    <tr
      data-severity={incident.severity}
      data-status={incident.status}
      aria-current={selected ? 'true' : undefined}
    >
      <td data-column="severity">
        <SeverityBadge severity={incident.severity} size="s" />
      </td>
      <td data-column="incident">
        <span className={styles.incident}>
          <span className={styles.tile} aria-hidden="true">
            <Icon glyph={incidentTypeIcon(incident.type)} size={16} />
          </span>
          {/*
            The type and the title read as one text node: an accessible name trims each element's text, so a hidden
            "Fire: " beside a visible title would read "Fire:Smoke detector". The visible title is the duplicate, hidden.
          */}
          <span className={styles.hidden}>{`${typeLabel(incident.type)}: ${incident.title}`}</span>
          <span className={styles.title} title={incident.title} aria-hidden="true">
            {incident.title}
          </span>
        </span>
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
