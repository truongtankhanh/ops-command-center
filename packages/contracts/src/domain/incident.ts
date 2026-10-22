import type { LngLat } from './geo';

/** Every incident type belongs to exactly one category (`INCIDENT_TYPE_CATEGORY`, ADR-0021). */
export const INCIDENT_CATEGORIES = [
  'security',
  'fire_safety',
  'medical',
  'facilities',
  'environment',
  'traffic',
] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

/**
 * Values are only ever appended, never reordered: the index orders the report form and the map
 * images. The first six are the V1 types; the rest follow ADR-0021's table, category by category.
 */
export const INCIDENT_TYPES = [
  'intrusion',
  'fire_alarm',
  'equipment_fault',
  'medical',
  'crowding',
  'suspicious_object',
  'theft',
  'vandalism',
  'suspicious_person',
  'assault',
  'fire',
  'gas_leak',
  'hazmat_spill',
  'injury',
  'power_outage',
  'water_leak',
  'lift_entrapment',
  'hvac_fault',
  'network_outage',
  'severe_weather',
  'flooding',
  'fallen_tree',
  'traffic_accident',
  'blocked_access',
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

/** Ordered from least to most severe — index is used for sorting. */
export const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

/** Derived from the type and never stored, so the two cannot disagree (ADR-0021). */
export const INCIDENT_TYPE_CATEGORY: Readonly<Record<IncidentType, IncidentCategory>> = {
  intrusion: 'security',
  fire_alarm: 'fire_safety',
  equipment_fault: 'facilities',
  medical: 'medical',
  crowding: 'security',
  suspicious_object: 'security',
  theft: 'security',
  vandalism: 'security',
  suspicious_person: 'security',
  assault: 'security',
  fire: 'fire_safety',
  gas_leak: 'fire_safety',
  hazmat_spill: 'fire_safety',
  injury: 'medical',
  power_outage: 'facilities',
  water_leak: 'facilities',
  lift_entrapment: 'facilities',
  hvac_fault: 'facilities',
  network_outage: 'facilities',
  severe_weather: 'environment',
  flooding: 'environment',
  fallen_tree: 'environment',
  traffic_accident: 'traffic',
  blocked_access: 'traffic',
};

export const categoryOf = (type: IncidentType): IncidentCategory => INCIDENT_TYPE_CATEGORY[type];

/**
 * The severity the report form suggests for each type (ADR-0021's table). The reporter can change
 * it, and the API does not enforce it.
 */
export const INCIDENT_TYPE_DEFAULT_SEVERITY: Readonly<Record<IncidentType, IncidentSeverity>> = {
  intrusion: 'high',
  fire_alarm: 'high',
  equipment_fault: 'medium',
  medical: 'high',
  crowding: 'low',
  suspicious_object: 'medium',
  theft: 'medium',
  vandalism: 'low',
  suspicious_person: 'medium',
  assault: 'high',
  fire: 'critical',
  gas_leak: 'critical',
  hazmat_spill: 'high',
  injury: 'medium',
  power_outage: 'high',
  water_leak: 'medium',
  lift_entrapment: 'high',
  hvac_fault: 'medium',
  network_outage: 'medium',
  severe_weather: 'high',
  flooding: 'high',
  fallen_tree: 'medium',
  traffic_accident: 'high',
  blocked_access: 'low',
};

export const INCIDENT_STATUSES = ['open', 'acknowledged', 'resolved'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_EVENT_KINDS = ['reported', 'acknowledged', 'resolved'] as const;
export type IncidentEventKind = (typeof INCIDENT_EVENT_KINDS)[number];

export const INCIDENT_SOURCES = ['operator', 'simulator', 'telemetry'] as const;
export type IncidentSource = (typeof INCIDENT_SOURCES)[number];

/**
 * `user`: a signed-in person. `system`: the API itself, e.g. the simulator, the demo seed, or
 * timeline entries recorded before actors existed.
 */
export const ACTOR_KINDS = ['user', 'system'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

/** Who caused a timeline entry. */
export interface Actor {
  kind: ActorKind;
  /** The identity provider's `sub` for a user; a fixed name such as `simulator` for the system. */
  subject: string;
  /** As it was when the entry was written: renaming the account later does not rewrite history. */
  displayName: string;
}

export interface IncidentEvent {
  id: string;
  kind: IncidentEventKind;
  note: string | null;
  at: string;
  actor: Actor;
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
  /**
   * The asset whose telemetry rule raised the incident (ADR-0018); `null` for operator and simulator
   * incidents. A client reads a missing `assetId` as `null`: an API before `incident.asset_id` never
   * sends it.
   */
  assetId?: string | null;
  /**
   * The level of the zone it is on (ADR-0023); `null` when none was stated. It is a coarse field,
   * not a height: `position` stays [lng, lat]. A client reads a missing `levelCode` as `null`: an API
   * before `incident.level_code` never sends it.
   */
  levelCode?: string | null;
  reportedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  /**
   * Starts at 1 and goes up by one on every change. REST responses and live events can
   * arrive out of order, so a client keeps a copy unless the incoming one has a higher version.
   */
  version: number;
}

export interface IncidentDetail extends Incident {
  timeline: IncidentEvent[];
}

export const severityRank = (severity: IncidentSeverity): number =>
  INCIDENT_SEVERITIES.indexOf(severity);
