import {
  type Incident,
  INCIDENT_STATUSES,
  type IncidentSource,
  severityRank,
} from '@occ/contracts';
import { attentionCountdown } from './attentionCountdown';
import { compareIncidents, fold } from './incidents';

/*
 * The incident table's model (V3-24.1, frame 19, brief § Operations aids, Table mode): its columns and the order of its rows
 * by any one of them, for the table (V3-24.4) to draw and the sort switch (V3-24.3) to remember. A view of the incidents the
 * feed already has: pure like `groupByZone.ts` and `alarmLoad.ts` beside it, with no React, no store and no `Date.now()`, so
 * every console sorts the same rows the same way.
 *
 * The sort is stable whatever the input order: equal keys keep the feed's order (`compareIncidents`), then the code, then the
 * id. A value that is missing or that this console does not know (a status or a source the API added first, an incident with
 * no countdown, a zone the loaded zones lack) goes last in **both** directions, so a reversed sort never puts the unreadable
 * rows on top. The Attention column is the V1 attention threshold, display only and never an SLA (V1 Approved decision 3).
 */

export type TableColumnKey =
  'severity' | 'incident' | 'place' | 'status' | 'source' | 'raised' | 'attention' | 'code';

/** The two tokens `aria-sort` takes for a sorted header. */
export type SortDirection = 'ascending' | 'descending';

export interface TableSort {
  readonly key: TableColumnKey;
  readonly direction: SortDirection;
}

export interface TableColumn {
  readonly key: TableColumnKey;
  /** The header's text (frame 19). */
  readonly label: string;
  readonly sortable: boolean;
  /** The direction of a header's first press: what an operator most often wants first from that column. */
  readonly defaultDirection: SortDirection;
}

export interface TableSortContext {
  /** Zone id → name, as `IncidentFeed` builds it from the loaded zones. */
  readonly zoneName: ReadonlyMap<string, string>;
  /** Epoch ms for the Attention column: the caller's `useCountdownNow`, so the order follows the same tick as the rows. */
  readonly now: number;
}

/**
 * Frame 19's header, in its order. Every column sorts. Severity starts most severe first and Raised newest first, as the feed
 * reads; Attention starts with the least time left (overdue on top); Code starts with the newest code.
 */
export const TABLE_COLUMNS: readonly TableColumn[] = [
  { key: 'severity', label: 'Severity', sortable: true, defaultDirection: 'descending' },
  { key: 'incident', label: 'Incident', sortable: true, defaultDirection: 'ascending' },
  { key: 'place', label: 'Place', sortable: true, defaultDirection: 'ascending' },
  { key: 'status', label: 'Status', sortable: true, defaultDirection: 'ascending' },
  { key: 'source', label: 'Source', sortable: true, defaultDirection: 'ascending' },
  { key: 'raised', label: 'Raised', sortable: true, defaultDirection: 'descending' },
  { key: 'attention', label: 'Attention', sortable: true, defaultDirection: 'ascending' },
  { key: 'code', label: 'Code', sortable: true, defaultDirection: 'descending' },
];

const COLUMN_BY_KEY: ReadonlyMap<TableColumnKey, TableColumn> = new Map(
  TABLE_COLUMNS.map((column) => [column.key, column]),
);

/**
 * The sources in the order the Source column reads them: a person's report, then a rule's, then the demo simulator's. Every
 * known source is listed, so only a value from a newer API is "unknown".
 */
const SOURCE_ORDER: readonly IncidentSource[] = ['operator', 'telemetry', 'simulator'];

/** A row's key for one column: a number or a folded text, or `null` when missing or unknown (always last). */
type SortKey = number | string | null;

/** An index from 0, or `null` for `-1`: what `indexOf` gives for a value not in the list. */
const rankOrNull = (index: number): number | null => (index < 0 ? null : index);

const finiteOrNull = (value: number): number | null => (Number.isFinite(value) ? value : null);

/** The number in a code such as `INC-000101` (its last run of digits); `null` for a code with none. */
function codeNumber(code: string): number | null {
  const digits = /(\d+)\D*$/.exec(code)?.[1];
  return digits === undefined ? null : Number(digits);
}

/*
 * One function per column: the exhaustive record makes a new column a type error until it has a key. Each is called once per
 * row (see `sortIncidents`), never inside the comparator, so the folding and the time parsing stay linear.
 */
const KEY_OF: Readonly<
  Record<TableColumnKey, (incident: Incident, context: TableSortContext) => SortKey>
> = {
  // `severityRank` of a severity this console does not know is -1: unknown, not "below low".
  severity: (incident) => rankOrNull(severityRank(incident.severity)),
  incident: (incident) => fold(incident.title),
  place: (incident, { zoneName }) => {
    const name = zoneName.get(incident.zoneId);
    return name === undefined ? null : fold(name);
  },
  status: (incident) => rankOrNull(INCIDENT_STATUSES.indexOf(incident.status)),
  source: (incident) => rankOrNull(SOURCE_ORDER.indexOf(incident.source)),
  // Parsed, not compared as text: a `+07:00` time and a `Z` time do not order as strings.
  raised: (incident) => finiteOrNull(Date.parse(incident.reportedAt)),
  // Signed: an overdue incident's time left is negative, so it comes first ascending. Only an open incident has one.
  attention: (incident, { now }) => attentionCountdown(incident, now)?.remainingMs ?? null,
  code: (incident) => codeNumber(incident.code),
};

/** Plain code-unit order, not `localeCompare`: the order must be the same on every console (as `groupByZone`'s). */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Two keys of the same column, so both numbers or both texts. */
const byValue = (a: number | string, b: number | string): number =>
  typeof a === 'number' && typeof b === 'number' ? a - b : byText(String(a), String(b));

/** `null` last whatever the direction; only a value is reversed. */
function byKey(a: SortKey, b: SortKey, sign: 1 | -1): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return sign * byValue(a, b);
}

interface Entry {
  readonly incident: Incident;
  readonly key: SortKey;
  readonly code: number | null;
}

/**
 * The tie chain, in the same direction whatever the column's: the feed's order, then the code's number, then the code as
 * text, then the id, so the order is total and never depends on the order the rows came in.
 */
function byFeedOrder(a: Entry, b: Entry): number {
  return (
    compareIncidents(a.incident, b.incident) ||
    byKey(a.code, b.code, 1) ||
    byText(a.incident.code, b.incident.code) ||
    byText(a.incident.id, b.incident.id)
  );
}

/**
 * `rows` in a new array, ordered by `sort`'s column and direction, ties in the feed's order; with `sort` `null`, in the feed's
 * order alone. The input is not changed. Each row's key is computed once before sorting, so 500 rows cost 500 folds or
 * parses, not one per comparison.
 */
export function sortIncidents(
  rows: readonly Incident[],
  sort: TableSort | null,
  context: TableSortContext,
): Incident[] {
  // A key from an older or edited store (V3-24.3 checks it) has no column: the feed's order, never a throw.
  const keyOf = sort === null ? undefined : KEY_OF[sort.key];
  const sign = sort?.direction === 'descending' ? -1 : 1;
  const entries: Entry[] = rows.map((incident) => ({
    incident,
    key: keyOf === undefined ? null : keyOf(incident, context),
    code: codeNumber(incident.code),
  }));
  entries.sort((a, b) => byKey(a.key, b.key, sign) || byFeedOrder(a, b));
  return entries.map((entry) => entry.incident);
}

/** What a header's `aria-sort` says: the direction on the sorted column, `none` on every other (and on all when unsorted). */
export function ariaSortOf(key: TableColumnKey, sort: TableSort | null): SortDirection | 'none' {
  return sort !== null && sort.key === key ? sort.direction : 'none';
}

const opposite = (direction: SortDirection): SortDirection =>
  direction === 'ascending' ? 'descending' : 'ascending';

/**
 * The sort after a press on `key`'s header: the column's default direction, then the opposite, then none (the feed's order).
 * A press on another column starts that column at its default. A column that does not sort leaves the sort as it was.
 */
export function nextSort(current: TableSort | null, key: TableColumnKey): TableSort | null {
  const column = COLUMN_BY_KEY.get(key);
  if (column === undefined || !column.sortable) return current;
  if (current === null || current.key !== key) return { key, direction: column.defaultDirection };
  if (current.direction === column.defaultDirection) {
    return { key, direction: opposite(column.defaultDirection) };
  }
  return null;
}
