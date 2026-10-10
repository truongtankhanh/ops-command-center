import {
  categoryOf,
  hasPermissionFor,
  INCIDENT_CATEGORIES,
  INCIDENT_TYPES,
  type Incident,
  type IncidentCategory,
  type IncidentEventKind,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentType,
  type Permission,
  type Role,
  severityRank,
  type Zone,
  type ZoneKind,
  type ZoneUse,
} from '@occ/contracts';

export type FeedFilter = 'active' | 'mine' | 'resolved' | 'all';

/** Every filter, in tab order. A user is offered a subset of it: see `feedFiltersFor`. */
export const FEED_FILTERS: { value: FeedFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'mine', label: 'Mine to handle' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

const ACTIVE: IncidentStatus[] = ['open', 'acknowledged'];

/** No categories: the default scope, under which "Mine to handle" matches nothing. */
const NO_SCOPE: readonly IncidentCategory[] = [];

export const isActive = (incident: Incident) => ACTIVE.includes(incident.status);

/**
 * Whether `incident` belongs in the tab. `scope` is the user's categories (`handlingScope`) and
 * only "Mine to handle" reads it: an active incident in one of them. A type this console does not
 * know has no category, so it is never in a scope (fail closed, like the sheet's footer).
 */
export function matchesFilter(
  incident: Incident,
  filter: FeedFilter,
  scope: readonly IncidentCategory[] = NO_SCOPE,
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'active':
      return isActive(incident);
    case 'resolved':
      return incident.status === 'resolved';
    case 'mine': {
      const category = categoryOfType(incident.type);
      return isActive(incident) && category !== null && scope.includes(category);
    }
  }
}

/** `null` is no severity filter: every incident matches. */
export const matchesSeverity = (incident: Incident, severity: IncidentSeverity | null): boolean =>
  severity === null || incident.severity === severity;

/**
 * Folds text for search: case- and accent-insensitive, so "chay" finds "Cháy". `đ` has no NFD
 * decomposition, so it is mapped by hand.
 */
const fold = (text: string): string =>
  text.replace(/[đĐ]/g, 'd').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The folded words of a search query; a blank query has none. */
export const searchTerms = (query: string): string[] => fold(query).split(/\s+/).filter(Boolean);

/**
 * Whether every search term appears in the incident's code, title or zone name. No terms match
 * every incident. Terms hold no whitespace, so the line breaks keep a term from spanning two
 * fields.
 */
export function matchesQuery(incident: Incident, terms: readonly string[], zoneName = ''): boolean {
  if (terms.length === 0) return true;
  const text = fold(`${incident.code}\n${incident.title}\n${zoneName}`);
  return terms.every((term) => text.includes(term));
}

/**
 * How many incidents each tab would list, given the filters that apply to every tab. Every filter
 * has a count, whether or not the user is offered its tab; `mine` is 0 without a `scope`.
 */
export function countByFilter(
  incidents: readonly Incident[],
  matches: (incident: Incident) => boolean,
  scope: readonly IncidentCategory[] = NO_SCOPE,
): Record<FeedFilter, number> {
  const counts: Record<FeedFilter, number> = { active: 0, mine: 0, resolved: 0, all: 0 };
  for (const incident of incidents) {
    if (!matches(incident)) continue;
    for (const { value } of FEED_FILTERS) {
      if (matchesFilter(incident, value, scope)) counts[value]++;
    }
  }
  return counts;
}

/** "Mine to handle" is not here: its message names the user's categories, so it is built below. */
const EMPTY_MESSAGES: Record<Exclude<FeedFilter, 'mine'>, string> = {
  active: 'No active incidents. New reports appear here as they come in.',
  resolved: 'Nothing resolved yet this shift.',
  all: 'No incidents recorded yet.',
};

/**
 * What the feed says when nothing matches its tab, severity filter and search. `scope` is the
 * user's categories, named by "Mine to handle" ("Nothing to handle in Facilities or Environment
 * right now."); without one the message names none.
 */
export function feedEmptyMessage(
  filter: FeedFilter,
  severity: IncidentSeverity | null,
  query = '',
  scope: readonly IncidentCategory[] = NO_SCOPE,
): string {
  const level = severity ? `${severityLabel(severity).toLowerCase()} ` : '';
  const where = scope.length > 0 ? ` in ${categoriesLabel(scope, 'or')}` : '';
  const search = query.trim();
  if (search !== '') {
    if (filter === 'mine') return `No ${level}incidents to handle match "${search}".`;
    const tab = filter === 'all' ? '' : `${filter} `;
    return `No ${tab}${level}incidents match "${search}".`;
  }
  if (severity === null) {
    return filter === 'mine' ? `Nothing to handle${where} right now.` : EMPTY_MESSAGES[filter];
  }
  switch (filter) {
    case 'active':
      return `No active ${level}incidents.`;
    case 'mine':
      return `No ${level}incidents to handle${where}.`;
    case 'resolved':
      return `No resolved ${level}incidents.`;
    case 'all':
      return `No ${level}incidents recorded yet.`;
  }
}

/** Same order as the API: unresolved first, then most severe, then newest. */
export function compareIncidents(a: Incident, b: Incident): number {
  const resolved = Number(a.status === 'resolved') - Number(b.status === 'resolved');
  if (resolved !== 0) return resolved;
  const severity = severityRank(b.severity) - severityRank(a.severity);
  if (severity !== 0) return severity;
  return b.reportedAt.localeCompare(a.reportedAt);
}

/**
 * Picks the copy to keep when two copies of the same incident meet. HTTP responses, live events and
 * refetches can arrive in any order, so the incoming copy wins only with a higher `version`.
 */
export function newerIncident<T extends Incident>(cached: T | undefined, incoming: T): T {
  return cached && cached.version >= incoming.version ? cached : incoming;
}

/**
 * Inserts or replaces an incident and keeps the list ordered. A copy that is not newer than the
 * cached one is ignored and the same list is returned. Never mutates its input.
 */
export function upsertIncident(list: Incident[] | undefined, incident: Incident): Incident[] {
  const current = list ?? [];
  const cached = current.find((item) => item.id === incident.id);
  if (newerIncident(cached, incident) !== incident) return current;
  const rest = current.filter((item) => item.id !== incident.id);
  return [...rest, incident].sort(compareIncidents);
}

/**
 * Merges a refetched list into the cached one, keeping the newer copy of each incident, so a
 * snapshot read before a live event cannot roll it back. Incidents are never deleted, so one
 * missing from the snapshot was most likely created after it was read: it is kept, not dropped.
 */
export function mergeIncidentLists(
  cached: Incident[] | undefined,
  fetched: Incident[],
): Incident[] {
  const byId = new Map((cached ?? []).map((incident) => [incident.id, incident]));
  for (const incident of fetched) {
    byId.set(incident.id, newerIncident(byId.get(incident.id), incident));
  }
  return [...byId.values()].sort(compareIncidents);
}

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export function countActiveBySeverity(incidents: Incident[]): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const incident of incidents) if (isActive(incident)) counts[incident.severity]++;
  return counts;
}

const MINUTE_MS = 60_000;

/**
 * How long an incident may stay open (not acknowledged) before the feed flags its age. Provisional
 * values from the design brief (Approved decision 3), still to be confirmed with operations.
 * Display only, not an SLA: nothing enforces it server-side, and OCC-26 replaces it with the
 * server's SLA.
 */
export const ATTENTION_THRESHOLD_MS: Readonly<Record<IncidentSeverity, number>> = {
  critical: 2 * MINUTE_MS,
  high: 5 * MINUTE_MS,
  medium: 15 * MINUTE_MS,
  low: 30 * MINUTE_MS,
};

/** An open incident waiting past its attention threshold. Acknowledging it clears the flag. */
export const isPastAttention = (incident: Incident, now: number): boolean =>
  incident.status === 'open' &&
  now - Date.parse(incident.reportedAt) >= ATTENTION_THRESHOLD_MS[incident.severity];

/** Compact age for scanning a list: `now`, `45s`, `12m`, `3h`, `2d`. */
export function formatAge(fromIso: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(fromIso)) / 1000));
  if (seconds < 10) return 'now';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Relative time for the detail's timeline: `formatAge` read as a sentence (`14m ago`, `just now`). */
export function formatAgo(fromIso: string, now: number): string {
  const age = formatAge(fromIso, now);
  return age === 'now' ? 'just now' : `${age} ago`;
}

/**
 * A duration with two units once minutes are not enough (`45s`, `14m`, `1h 35m`, `2d 3h`), for the
 * detail's metrics, where the precision a feed age drops still matters.
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`;
}

/**
 * Wall-clock time `HH:MM` (24 h, local), prefixed with the date (`6 Oct 14:07`) when it is not on
 * the same local day as `now`: an incident left open overnight would otherwise read as today.
 */
export function formatClock(iso: string, now: number): string {
  const at = new Date(iso);
  const clock = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  if (at.toDateString() === new Date(now).toDateString()) return clock;
  return `${at.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${clock}`;
}

/**
 * Where an incident is on Reported → Acknowledged → Resolved. `skipped`: resolved straight from open,
 * which the API allows, so the acknowledge step has no time.
 */
export type StepState = 'done' | 'current' | 'future' | 'skipped';

export interface LifecycleStep {
  kind: IncidentEventKind;
  state: StepState;
  /** Set on `done` steps only. */
  at: string | null;
}

export function lifecycleSteps(incident: Incident): LifecycleStep[] {
  const { reportedAt, acknowledgedAt, resolvedAt } = incident;
  return [
    { kind: 'reported', state: 'done', at: reportedAt },
    acknowledgedAt
      ? { kind: 'acknowledged', state: 'done', at: acknowledgedAt }
      : { kind: 'acknowledged', state: resolvedAt ? 'skipped' : 'current', at: null },
    resolvedAt
      ? { kind: 'resolved', state: 'done', at: resolvedAt }
      : { kind: 'resolved', state: acknowledgedAt ? 'current' : 'future', at: null },
  ];
}

/** How long the incident has been (or, once `final`, was) open, from report to resolution. */
export function openDuration(incident: Incident, now: number): { ms: number; final: boolean } {
  const end = incident.resolvedAt ? Date.parse(incident.resolvedAt) : now;
  return { ms: end - Date.parse(incident.reportedAt), final: incident.resolvedAt !== null };
}

/** Report to acknowledgement; `pending` while nobody has, `skipped` when resolved without it. */
export function acknowledgeDuration(incident: Incident): number | 'pending' | 'skipped' {
  if (incident.acknowledgedAt)
    return Date.parse(incident.acknowledgedAt) - Date.parse(incident.reportedAt);
  return incident.resolvedAt ? 'skipped' : 'pending';
}

const TYPE_LABELS: Record<Incident['type'], string> = {
  intrusion: 'Intrusion',
  fire_alarm: 'Fire alarm',
  equipment_fault: 'Equipment fault',
  // Not "Medical": that is its category's label, and the sheet shows both chips side by side.
  medical: 'Medical emergency',
  crowding: 'Crowding',
  suspicious_object: 'Suspicious object',
  theft: 'Theft',
  vandalism: 'Vandalism',
  suspicious_person: 'Suspicious person',
  assault: 'Assault',
  fire: 'Fire',
  gas_leak: 'Gas leak',
  hazmat_spill: 'Hazmat spill',
  injury: 'Injury',
  power_outage: 'Power outage',
  water_leak: 'Water leak',
  lift_entrapment: 'Lift entrapment',
  hvac_fault: 'HVAC fault',
  network_outage: 'Network outage',
  severe_weather: 'Severe weather',
  flooding: 'Flooding',
  fallen_tree: 'Fallen tree',
  traffic_accident: 'Traffic accident',
  blocked_access: 'Blocked access',
};

/**
 * Whether `type` is in this build's contract. An incident from a newer API can carry a type added
 * after this console was built (rolling deploys, ADR-0021); the type says it cannot, the data can.
 */
export const isKnownType = (type: string): type is IncidentType =>
  (INCIDENT_TYPES as readonly string[]).includes(type);

/** An unknown type reads as its raw id (`gas_leak`), never as an empty label. */
export const typeLabel = (type: Incident['type']): string => TYPE_LABELS[type] ?? type;

/**
 * The type's category, or `null` for a type this console does not know. Anything scoped by
 * category treats `null` as out of scope: a technician only views it, an `'all'` role still acts.
 */
export const categoryOfType = (type: Incident['type']): IncidentCategory | null =>
  isKnownType(type) ? categoryOf(type) : null;

const CATEGORY_LABELS: Record<IncidentCategory, string> = {
  security: 'Security',
  fire_safety: 'Fire & safety',
  medical: 'Medical',
  facilities: 'Facilities',
  environment: 'Environment',
  traffic: 'Traffic',
};

export const categoryLabel = (category: IncidentCategory) => CATEGORY_LABELS[category];

/**
 * The categories, in contract order, in which one of `roles` holds `permission`. It asks the same
 * `ROLE_PERMISSIONS` and `ROLE_CATEGORY_SCOPE` the API enforces (ADR-0011, ADR-0021), so a
 * permission that is not scoped by category (report) gives every category, and one no role holds
 * gives none. For describing or filtering what a user may do; the API's 403 is the control.
 */
export const categoriesInScope = (
  roles: readonly Role[],
  permission: Permission,
): IncidentCategory[] =>
  INCIDENT_CATEGORIES.filter((category) => hasPermissionFor(roles, permission, category));

/**
 * Category labels as a sentence list: "Facilities", "Facilities and Environment", "A, B and C".
 * `'or'` joins the last one with "or" instead, for a sentence about what is not there.
 */
export function categoriesLabel(
  categories: readonly IncidentCategory[],
  conjunction: 'and' | 'or' = 'and',
): string {
  const labels = categories.map(categoryLabel);
  const last = labels.pop();
  if (last === undefined) return '';
  return labels.length === 0 ? last : `${labels.join(', ')} ${conjunction} ${last}`;
}

/**
 * The categories in which the user may acknowledge or resolve, in contract order: the queue
 * "Mine to handle" lists. Read from the same maps the API enforces (ADR-0011, ADR-0021). For
 * presentation only: the API's 403 is the control.
 */
export function handlingScope(roles: readonly Role[]): IncidentCategory[] {
  const acknowledge = categoriesInScope(roles, 'incident:acknowledge');
  const resolve = categoriesInScope(roles, 'incident:resolve');
  return INCIDENT_CATEGORIES.filter(
    (category) => acknowledge.includes(category) || resolve.includes(category),
  );
}

/**
 * Some categories but not all (a technician). A role that acts on every category (operator) has
 * no queue narrower than the feed, and one that acts on none (viewer) has no queue at all, so
 * neither is offered "Mine to handle" nor gets tags.
 */
export function hasLimitedScope(roles: readonly Role[]): boolean {
  const { length } = handlingScope(roles);
  return length > 0 && length < INCIDENT_CATEGORIES.length;
}

/** The tabs the user is offered: "Mine to handle" in place of "Resolved" for a limited scope. */
export function feedFiltersFor(roles: readonly Role[]): { value: FeedFilter; label: string }[] {
  const left: FeedFilter = hasLimitedScope(roles) ? 'resolved' : 'mine';
  return FEED_FILTERS.filter((tab) => tab.value !== left);
}

/**
 * `filter` when the user is offered its tab, else Active. The filter lives in a store that does
 * not know the roles, which can change under a live session (token renewal), so what is shown is
 * resolved here, when the feed reads it, and never leaves the tabs with none selected.
 */
export const offeredFilter = (
  filter: FeedFilter,
  offered: readonly { value: FeedFilter }[],
): FeedFilter => (offered.some((tab) => tab.value === filter) ? filter : 'active');

/**
 * The incident's category label when it is in `scope`, for the feed row's tag; `undefined` out of
 * scope and for a type this console does not know.
 */
export function categoryTag(
  incident: Incident,
  scope: readonly IncidentCategory[],
): string | undefined {
  const category = categoryOfType(incident.type);
  return category !== null && scope.includes(category) ? categoryLabel(category) : undefined;
}

/**
 * `typeLabel` inside a sentence ("Suggested for lift entrapment"): the first letter lower-cased,
 * unless the label starts with an acronym ("HVAC fault").
 */
export function typeLabelInSentence(type: Incident['type']): string {
  const label = typeLabel(type);
  const firstWord = label.split(' ', 1)[0] ?? '';
  if (firstWord.length > 1 && firstWord === firstWord.toUpperCase()) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

const NO_TYPES: readonly IncidentType[] = [];
const UTILITY_TYPES: readonly IncidentType[] = ['power_outage', 'equipment_fault', 'intrusion'];

/**
 * The types most likely in a building, by its `use`, most typical first (brief § Zones of the demo
 * campus). Suggestions only: the report form lists them first and never hides a type (ADR-0021).
 */
const TYPES_LIKELY_BY_USE: Readonly<Record<ZoneUse, readonly IncidentType[]>> = {
  // The brief has two academic buildings with different rows; merged, the lecture hall's first.
  academic: ['crowding', 'medical', 'fire_alarm', 'intrusion', 'equipment_fault'],
  library: ['theft', 'fire_alarm'],
  laboratory: ['hazmat_spill', 'gas_leak', 'fire_alarm'],
  residential: ['water_leak', 'lift_entrapment', 'fire_alarm', 'theft'],
  dining: ['suspicious_object', 'crowding', 'injury'],
  healthcare: ['medical', 'power_outage'],
  sports_hall: ['injury', 'crowding'],
  administration: ['intrusion', 'network_outage'],
  data_center: ['equipment_fault', 'power_outage', 'intrusion'],
  security_post: NO_TYPES,
  // The brief has no row for it (its Utility Plant is a `utility` zone): a plant in a building
  // sees what a utility yard sees.
  utility_plant: UTILITY_TYPES,
};

/** The same for zones without a `use`, by `kind`. A `building` is read by its use instead. */
const TYPES_LIKELY_BY_KIND: Readonly<Partial<Record<ZoneKind, readonly IncidentType[]>>> = {
  utility: UTILITY_TYPES,
  outdoor: ['injury', 'severe_weather', 'fallen_tree'],
  water: ['medical', 'flooding'],
  parking: ['theft', 'vandalism', 'blocked_access', 'traffic_accident'],
  gate: ['crowding', 'traffic_accident', 'intrusion'],
};

/**
 * The types likely in `zone`, most typical first; none without a zone. A building is read by its
 * `use`, which an API before the `zone.use` column never sends (read as `null`: none). A `use` or
 * `kind` newer than this build has no row, so it suggests nothing rather than failing.
 */
export function typesLikelyIn(
  zone: Pick<Zone, 'kind' | 'use'> | undefined,
): readonly IncidentType[] {
  if (!zone) return NO_TYPES;
  if (zone.kind === 'building') {
    const use = zone.use ?? null;
    return use === null ? NO_TYPES : (TYPES_LIKELY_BY_USE[use] ?? NO_TYPES);
  }
  return TYPES_LIKELY_BY_KIND[zone.kind] ?? NO_TYPES;
}

/**
 * The report form's types for `category`: the ones in `likely` first, in its order, then the
 * others in contract order (`INCIDENT_TYPES`, which otherwise orders the form). It only reorders:
 * every type of the category is listed once, and a likely type of another category is ignored.
 */
export function typesInCategory(
  category: IncidentCategory,
  likely: readonly IncidentType[] = NO_TYPES,
): IncidentType[] {
  const inCategory = (type: IncidentType) => categoryOf(type) === category;
  const first = likely.filter(inCategory);
  const rest = INCIDENT_TYPES.filter((type) => inCategory(type) && !first.includes(type));
  return [...first, ...rest];
}

const STATUS_LABELS: Record<IncidentStatus, string> = {
  open: 'Open',
  acknowledged: 'Being handled',
  resolved: 'Resolved',
};

export const statusLabel = (status: IncidentStatus) => STATUS_LABELS[status];

const SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const severityLabel = (severity: IncidentSeverity) => SEVERITY_LABELS[severity];

const EVENT_LABELS: Record<IncidentEventKind, string> = {
  reported: 'Reported',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
};

/** A lifecycle step or timeline entry; the step names match the timeline's. */
export const eventLabel = (kind: IncidentEventKind) => EVENT_LABELS[kind];
