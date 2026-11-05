import type { DisplayMode } from '../shell/useDisplayMode';
import { type SortDirection, TABLE_COLUMNS, type TableSort } from './incidentTable';

/*
 * The incident sidebar's view and the table's sort, remembered per browser (V3-24.3, frame 19, brief § Operations aids,
 * Table mode: "Sort and mode are remembered per browser"). Storage is optional (`.claude/rules/console.md`): every read
 * and write is in `try/catch`, and a console without storage starts from the defaults and keeps a choice until reload.
 *
 * Only a choice that differs from the default is stored, as `density.ts` does, so a cleared, blocked or unknown value
 * gives the default back. A stored value this build cannot read is left in storage rather than rewritten, as
 * `viewChoice.ts` does: a newer build may know it.
 */

/** The list (the default, the scan view for a quiet shift) or the table over the stage (V3-24.4). */
export type FeedView = 'list' | 'table';

const FEED_VIEW_KEY = 'occ.console.feedView';
const TABLE_SORT_KEY = 'occ.console.tableSort';

/** The view chosen in this browser: `table` only when exactly that is stored. */
export function readFeedView(): FeedView {
  try {
    return localStorage.getItem(FEED_VIEW_KEY) === 'table' ? 'table' : 'list';
  } catch {
    return 'list';
  }
}

export function writeFeedView(view: FeedView): void {
  try {
    if (view === 'table') localStorage.setItem(FEED_VIEW_KEY, view);
    else localStorage.removeItem(FEED_VIEW_KEY);
  } catch {
    // Not remembered: the choice still holds until the page reloads.
  }
}

const DIRECTIONS: readonly SortDirection[] = ['ascending', 'descending'];

/**
 * A stored sort, checked: an object whose `key` is a sortable column this build has and whose `direction` is one of the
 * two. A fresh object is returned, so a stored extra field never reaches the store. Anything else is `null`, the
 * feed's order (V3-24.1).
 */
function parseTableSort(value: unknown): TableSort | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { key, direction } = value as { key?: unknown; direction?: unknown };
  const column = TABLE_COLUMNS.find((candidate) => candidate.key === key);
  if (!column?.sortable) return null;
  const known = DIRECTIONS.find((candidate) => candidate === direction);
  return known ? { key: column.key, direction: known } : null;
}

/** The table's sort chosen in this browser, or `null` (the feed's order) when none is stored or it cannot be read. */
export function readTableSort(): TableSort | null {
  try {
    const stored = localStorage.getItem(TABLE_SORT_KEY);
    return stored === null ? null : parseTableSort(JSON.parse(stored));
  } catch {
    // Blocked storage or a value that is not JSON.
    return null;
  }
}

export function writeTableSort(sort: TableSort | null): void {
  try {
    if (sort === null) localStorage.removeItem(TABLE_SORT_KEY);
    else
      localStorage.setItem(
        TABLE_SORT_KEY,
        JSON.stringify({ key: sort.key, direction: sort.direction }),
      );
  } catch {
    // Not remembered: the choice still holds until the page reloads.
  }
}

/**
 * The view that is drawn: the list on a phone, whatever was stored, because the table covers the stage and a phone
 * width (≤ 720 px) stacks the stage above the feed, where it does not fit. The stored choice is kept for a wider screen.
 */
export function effectiveFeedView(view: FeedView, mode: DisplayMode): FeedView {
  return mode === 'phone' ? 'list' : view;
}
