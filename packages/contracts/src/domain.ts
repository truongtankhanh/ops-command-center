/**
 * Domain vocabulary shared by the API and every client.
 * Enum-like values are `as const` tuples so they can be iterated at runtime
 * (validation, filters) and narrowed at compile time.
 */

/** How a zone is drawn, not what it is used for (that is `ZoneUse`, ADR-0021). */
export const ZONE_KINDS = [
  'building',
  'parking',
  'gate',
  'outdoor',
  'sports',
  'utility',
  'water',
] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

/** What a `building` zone is used for (ADR-0021). Other kinds have no use. */
export const ZONE_USES = [
  'academic',
  'library',
  'laboratory',
  'residential',
  'dining',
  'healthcare',
  'sports_hall',
  'administration',
  'data_center',
  'security_post',
  'utility_plant',
] as const;
export type ZoneUse = (typeof ZONE_USES)[number];

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

export const INCIDENT_SOURCES = ['operator', 'simulator'] as const;
export type IncidentSource = (typeof INCIDENT_SOURCES)[number];

/**
 * `user`: a signed-in person. `system`: the API itself, e.g. the simulator, the demo seed, or
 * timeline entries recorded before actors existed.
 */
export const ACTOR_KINDS = ['user', 'system'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

/** [longitude, latitude] — GeoJSON order. */
export type LngLat = [number, number];

export interface Zone {
  id: string;
  code: string;
  name: string;
  kind: ZoneKind;
  /**
   * Buildings only; drives report-form suggestions and restricts nothing. A client reads a missing
   * `use` as `null`: an API before the `zone.use` column never sends it.
   */
  use?: ZoneUse | null;
  /** Closed ring of [lng, lat] points. */
  polygon: LngLat[];
  center: LngLat;
}

/** What a camera sees: a circular sector from its `position`. */
export interface CameraFieldOfView {
  /** Direction of the view's centre line, in degrees clockwise from true north: 0 ≤ heading < 360. */
  heading: number;
  /** Width of the view in degrees: 0 < angle ≤ 360. */
  angle: number;
  /** How far the camera sees, in metres: > 0. */
  range: number;
}

export interface Camera {
  id: string;
  code: string;
  name: string;
  zoneId: string;
  position: LngLat;
  online: boolean;
  /** `null` when the camera's orientation is not known; clients then draw no view. */
  fieldOfView: CameraFieldOfView | null;
}

/**
 * Parts of a site plan drawn under the zones: the site `boundary`, `road`s, and `field` markings.
 * Building footprints and parking rows are not here — clients derive them from the zones.
 */
export const SITE_FEATURE_PARTS = ['boundary', 'road', 'field'] as const;
export type SiteFeaturePart = (typeof SITE_FEATURE_PARTS)[number];

/** A GeoJSON `Polygon` (closed rings, outer first) or `LineString`, in [lng, lat]. */
export type SiteGeometry =
  { type: 'Polygon'; coordinates: LngLat[][] } | { type: 'LineString'; coordinates: LngLat[] };

export interface SiteFeature {
  part: SiteFeaturePart;
  geometry: SiteGeometry;
}

/** Everything drawn under and between the zones of one site, in drawing order. */
export interface SitePlan {
  id: string;
  code: string;
  name: string;
  center: LngLat;
  features: SiteFeature[];
}

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
