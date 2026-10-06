import {
  type Incident,
  type IncidentSeverity,
  type IncidentStatus,
  severityRank,
} from '@occ/contracts';

export type FeedFilter = 'active' | 'resolved' | 'all';

export const FEED_FILTERS: { value: FeedFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

const ACTIVE: IncidentStatus[] = ['open', 'acknowledged'];

export const isActive = (incident: Incident) => ACTIVE.includes(incident.status);

export function matchesFilter(incident: Incident, filter: FeedFilter): boolean {
  if (filter === 'all') return true;
  return filter === 'active' ? isActive(incident) : incident.status === 'resolved';
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

/** How many incidents each tab would list, given the filters that apply to every tab. */
export function countByFilter(
  incidents: readonly Incident[],
  matches: (incident: Incident) => boolean,
): Record<FeedFilter, number> {
  const counts: Record<FeedFilter, number> = { active: 0, resolved: 0, all: 0 };
  for (const incident of incidents) {
    if (!matches(incident)) continue;
    for (const { value } of FEED_FILTERS) if (matchesFilter(incident, value)) counts[value]++;
  }
  return counts;
}

const EMPTY_MESSAGES: Record<FeedFilter, string> = {
  active: 'No active incidents. New reports appear here as they come in.',
  resolved: 'Nothing resolved yet this shift.',
  all: 'No incidents recorded yet.',
};

/** What the feed says when nothing matches its tab, severity filter and search. */
export function feedEmptyMessage(
  filter: FeedFilter,
  severity: IncidentSeverity | null,
  query = '',
): string {
  const search = query.trim();
  if (search !== '') {
    const tab = filter === 'all' ? '' : `${filter} `;
    const level = severity ? `${severityLabel(severity).toLowerCase()} ` : '';
    return `No ${tab}${level}incidents match "${search}".`;
  }
  if (severity === null) return EMPTY_MESSAGES[filter];
  const label = severityLabel(severity).toLowerCase();
  switch (filter) {
    case 'active':
      return `No active ${label} incidents.`;
    case 'resolved':
      return `No resolved ${label} incidents.`;
    case 'all':
      return `No ${label} incidents recorded yet.`;
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

const TYPE_LABELS: Record<Incident['type'], string> = {
  intrusion: 'Intrusion',
  fire_alarm: 'Fire alarm',
  equipment_fault: 'Equipment fault',
  medical: 'Medical',
  crowding: 'Crowding',
  suspicious_object: 'Suspicious object',
};

export const typeLabel = (type: Incident['type']) => TYPE_LABELS[type];

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
