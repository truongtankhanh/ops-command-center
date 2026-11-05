import type { Incident, IncidentCategory, IncidentSeverity, Zone } from '@occ/contracts';
import { useIncidents, useZones } from '../../api/queries';
import { useRoles } from '../../auth/usePermission';
import { useConsole } from '../../store';
import {
  countByFilter,
  type FeedFilter,
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
} from './incidents';

type IncidentsQuery = ReturnType<typeof useIncidents>;

/** A feed tab as `ui/Tabs` draws it: the filter, its word and, once the list is loaded, how many rows it would list. */
export interface FeedTab {
  value: FeedFilter;
  label: string;
  count?: number;
}

export interface FeedRows {
  /** The incident list as the cache holds it, `undefined` until it first arrives. */
  incidents: IncidentsQuery['data'];
  error: IncidentsQuery['error'];
  failureReason: IncidentsQuery['failureReason'];
  isPending: boolean;
  isFetching: boolean;
  refetch: IncidentsQuery['refetch'];
  /** The list has arrived once. A failed background refetch keeps it (TanStack keeps the data), so this stays true. */
  loaded: boolean;
  /** The zones, `undefined` until they arrive: grouping by zone (V3-21.4) waits for them. */
  zoneList: Zone[] | undefined;
  zoneName: ReadonlyMap<string, string>;
  /** The tab shown: the stored one when the user is offered it, else Active. */
  filter: FeedFilter;
  tabs: FeedTab[];
  /** The categories the user handles, empty for a role with no limited scope. */
  scope: IncidentCategory[];
  /** Whether rows carry the "Mine to handle" category tag (frame 09). */
  tagged: boolean;
  severity: IncidentSeverity | null;
  category: IncidentCategory | null;
  query: string;
  terms: string[];
  /** The rows the tab, severity, category and search leave, in the feed's order. */
  visible: Incident[];
  /** "3 incidents match" while searching, else empty: the feed's hidden status line. */
  matchStatus: string;
  /** Why nothing is listed, for the empty state. */
  emptyMessage: string;
}

/**
 * The incident rows the sidebar list and the table over the stage both draw (V3-24.4, brief § Table mode: "search and the
 * All / Open / Resolved chips are the same state as the list"). It is the one place the tab, the severity chip, the category
 * and the search are applied, so the two views can never list different incidents. Moved out of `IncidentFeed` unchanged.
 *
 * Only the shared derivation lives here. What one view alone needs stays with it: the list's grouping by zone, the roving
 * tab stop and each view's clock (`useCountdownNow(visible)`), so the table does not pay for grouping and each view ticks
 * for the rows it draws.
 */
export function useFeedRows(): FeedRows {
  const { data: incidents, error, failureReason, isPending, isFetching, refetch } = useIncidents();
  const { data: zoneList } = useZones();
  const storedFilter = useConsole((s) => s.filter);
  const severity = useConsole((s) => s.severity);
  const category = useConsole((s) => s.category);
  const query = useConsole((s) => s.feedQuery);
  const roles = useRoles();

  // A technician's tabs are Active · Mine to handle · All, everyone else's Active · Resolved · All.
  // The stored filter may be one the user is not offered (roles change on token renewal): show
  // Active then, rather than a list under no selected tab.
  const offered = feedFiltersFor(roles);
  const filter = offeredFilter(storedFilter, offered);
  const scope = handlingScope(roles);
  const tagged = hasLimitedScope(roles);

  const zoneName = new Map((zoneList ?? []).map((z: Zone) => [z.id, z.name]));
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

  return {
    incidents,
    error,
    failureReason,
    isPending,
    isFetching,
    refetch,
    loaded,
    zoneList,
    zoneName,
    filter,
    tabs,
    scope,
    tagged,
    severity,
    category,
    query,
    terms,
    visible,
    matchStatus,
    emptyMessage: feedEmptyMessage(filter, severity, query, scope, category),
  };
}
