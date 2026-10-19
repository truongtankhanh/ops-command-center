import type { Incident } from '@occ/contracts';
import { isActive } from './incidents';

/**
 * How many incidents are active (`open` or `acknowledged`): the rule the feed's Active tab and the KPI tiles
 * use, so the 3D view's summary and those lists cannot disagree. Not narrowed by role, like the tiles.
 */
export const activeIncidentCount = (incidents: readonly Incident[]): number =>
  incidents.filter(isActive).length;

/**
 * The element id of the 3D view's one tab stop (`twin/TwinView`), as `VIEW_SWITCH_3D_ID` is the switch's. The
 * breadcrumb, which is main-chunk code and so cannot import `src/twin/`, hands focus to it after a press that
 * may have removed the control that had it (V2-15.6). The keys of V2-18.3 work on this element.
 */
export const TWIN_VIEW_ID = 'twin-view';

interface TwinSummaryInput {
  /** The site plan's name; `undefined` while the plan is on its way or when none is served. */
  siteName: string | undefined;
  /** `null` while the incident list has not loaded: the summary then says nothing about a count. */
  activeIncidents: number | null;
}

/** Where the picture's content is as text, said once: the lists are the accessible twin (ADR-0020). */
const POINTER = 'Drag to rotate. The incident list and the Assets tab list everything shown here.';

function incidentsClause(count: number | null): string {
  if (count === null) return '';
  if (count === 0) return ' with no active incidents';
  return ` with ${count} active incident${count === 1 ? '' : 's'}`;
}

/**
 * The text a screen reader gets for the 3D view (the label of its focusable group): a WebGL canvas is
 * opaque to assistive technology, so the summary names the site and the active incidents and points to the
 * lists that hold everything the picture shows (brief § Accessibility).
 *
 * An unknown count is left out and never read as 0, which would tell an operator the campus is quiet.
 * A site without a name reads as "the campus".
 */
export function twinSummary({ siteName, activeIncidents }: TwinSummaryInput): string {
  const site = siteName?.trim() || 'the campus';
  return `3D view of ${site}${incidentsClause(activeIncidents)}. ${POINTER}`;
}
