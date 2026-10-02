import { type Incident, type IncidentStatus, severityRank } from '@occ/contracts';

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
