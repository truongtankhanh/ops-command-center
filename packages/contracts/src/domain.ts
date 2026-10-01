/**
 * Domain vocabulary shared by the API and every client.
 * Enum-like values are `as const` tuples so they can be iterated at runtime
 * (validation, filters) and narrowed at compile time.
 */

export const ZONE_KINDS = ['building', 'parking', 'gate', 'outdoor'] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

export const INCIDENT_TYPES = [
  'intrusion',
  'fire_alarm',
  'equipment_fault',
  'medical',
  'crowding',
  'suspicious_object',
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

/** Ordered from least to most severe — index is used for sorting. */
export const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_STATUSES = ['open', 'acknowledged', 'resolved'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_EVENT_KINDS = ['reported', 'acknowledged', 'resolved'] as const;
export type IncidentEventKind = (typeof INCIDENT_EVENT_KINDS)[number];

export const INCIDENT_SOURCES = ['operator', 'simulator'] as const;
export type IncidentSource = (typeof INCIDENT_SOURCES)[number];

/** [longitude, latitude] — GeoJSON order. */
export type LngLat = [number, number];

export interface Zone {
  id: string;
  code: string;
  name: string;
  kind: ZoneKind;
  /** Closed ring of [lng, lat] points. */
  polygon: LngLat[];
  center: LngLat;
}

export interface Camera {
  id: string;
  code: string;
  name: string;
  zoneId: string;
  position: LngLat;
  online: boolean;
}

export interface IncidentEvent {
  id: string;
  kind: IncidentEventKind;
  note: string | null;
  at: string;
}

export interface Incident {
  id: string;
  code: string;
  type: IncidentType;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  description: string | null;
  zoneId: string;
  position: LngLat;
  source: IncidentSource;
  reportedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

export interface IncidentDetail extends Incident {
  timeline: IncidentEvent[];
}

export const severityRank = (severity: IncidentSeverity): number =>
  INCIDENT_SEVERITIES.indexOf(severity);
