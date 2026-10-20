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

/** The element id of the hidden sentence that names the view's keys: the group's `aria-describedby` (V2-18.3). */
export const TWIN_VIEW_KEYS_ID = 'twin-view-keys';

/**
 * The 3D view's keys, said once as the group's description, so a screen-reader user who lands on the stage hears them
 * after its name. The same keys as the help's group "3D view, while it has focus" (`lib/shortcuts.ts`); a test keeps
 * the two from drifting. It is a description, not part of the name: the name stays the summary of the site.
 */
export const TWIN_VIEW_KEYS =
  'Arrow keys turn and tilt the view. Shift with an arrow pans. Plus and minus zoom. Home resets to the campus view. Escape goes up one level.';

interface TwinSummaryInput {
  /** The site plan's name; `undefined` while the plan is on its way or when none is served. */
  siteName: string | undefined;
  /** `null` while the incident list has not loaded: the summary then says nothing about a count. */
  activeIncidents: number | null;
  /**
   * The heat overlay while it is shown (V2-17.3), `null` or absent otherwise: the names of the buildings with no
   * reading and the scale's ends. The domain is handed in, not imported, because this module is main-chunk code (the
   * breadcrumb reads `TWIN_VIEW_ID`) and `lib/twinHeat.ts` is not.
   */
  heat?: { silentNames: readonly string[]; domain: readonly [number, number] } | null;
}

/** Where the picture's content is as text, said once: the lists are the accessible twin (ADR-0020). */
const POINTER = 'Drag to rotate. The incident list and the Assets tab list everything shown here.';

function incidentsClause(count: number | null): string {
  if (count === null) return '';
  if (count === 0) return ' with no active incidents';
  return ` with ${count} active incident${count === 1 ? '' : 's'}`;
}

/** "A", "A and B", "A, B and C". */
function listOf(names: readonly string[]): string {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * What the colours mean, said once (ADR-0020 "Settled in V2-17.3"): the ramp and its scale, and which buildings are
 * faded because their sensor is silent. The number agrees with the count ("its" for one, "their" for several); the
 * sentence about the faded ones is left out when every building reports.
 */
function heatSentence({ silentNames, domain }: NonNullable<TwinSummaryInput['heat']>): string {
  const scale = `Campus coloured by indoor temperature per building, ${domain[0]} to ${domain[1]} °C; lighter is warmer.`;
  if (silentNames.length === 0) return scale;
  const possessive = silentNames.length === 1 ? 'its' : 'their';
  return `${scale} ${listOf(silentNames)} faded: ${possessive} sensor is silent.`;
}

/**
 * The text a screen reader gets for the 3D view (the label of its focusable group): a WebGL canvas is
 * opaque to assistive technology, so the summary names the site and the active incidents and points to the
 * lists that hold everything the picture shows (brief § Accessibility). With the heat overlay shown it also says
 * what the colours mean, between the incidents and the pointer (V2-17.3).
 *
 * An unknown count is left out and never read as 0, which would tell an operator the campus is quiet.
 * A site without a name reads as "the campus".
 */
export function twinSummary({ siteName, activeIncidents, heat = null }: TwinSummaryInput): string {
  const site = siteName?.trim() || 'the campus';
  const colours = heat === null ? '' : `${heatSentence(heat)} `;
  return `3D view of ${site}${incidentsClause(activeIncidents)}. ${colours}${POINTER}`;
}
