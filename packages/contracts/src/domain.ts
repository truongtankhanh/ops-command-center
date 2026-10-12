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
  /**
   * Metres above ground of a building's shell; `null` is the client's default. A client reads a
   * missing `heightM` as `null`: an API before the `zone.height_m` column never sends it.
   */
  heightM?: number | null;
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

/**
 * What a telemetry point carries (ADR-0018): a `number` in the point's `unit`, an on/off
 * `boolean`, or one of the point's `enumValues`.
 */
export const TELEMETRY_POINT_KINDS = ['number', 'boolean', 'enum'] as const;
export type TelemetryPointKind = (typeof TELEMETRY_POINT_KINDS)[number];

/** Which side of a rule's `limit` is a breach: a reading `above` it or `below` it. */
export const TELEMETRY_COMPARATORS = ['above', 'below'] as const;
export type TelemetryComparator = (typeof TELEMETRY_COMPARATORS)[number];

/** One reading of one point: a number, a boolean, or one of an `enum` point's values. */
export type TelemetryValue = number | boolean | string;

/** One thing an asset class measures or reports, as described by the class, not by one asset. */
export interface TelemetryPoint {
  /** camelCase and unique within the asset class: `motorTempC`. */
  key: string;
  label: string;
  /** `null` for a point with no unit (a boolean or an enum). */
  unit: string | null;
  kind: TelemetryPointKind;
  /**
   * Lowest valid value of a `number` point. `null` when there is no lower bound, and for booleans
   * and enums. A reading outside `min`/`max` is dropped by the API, never clamped.
   */
  min: number | null;
  /** Highest valid value of a `number` point. `null` when there is no upper bound, and as `min`. */
  max: number | null;
  /** The values an `enum` point can take. `null` for every other kind. */
  enumValues: string[] | null;
  /** How often a device sends this point, in seconds: > 0. A client judges freshness against it. */
  expectedIntervalS: number;
  /**
   * Rank among the class's headline points: 1 or 2. `null` when the point is not a headline, so
   * it appears in neither the tooltip nor the Assets list.
   */
  headline: 1 | 2 | null;
}

/** The box a neutral placeholder is drawn from, in metres: all three are > 0. */
export interface AssetFootprint {
  width: number;
  depth: number;
  height: number;
}

export interface AssetClass {
  id: string;
  /** Lower snake case: `cooling_tower`. */
  code: string;
  name: string;
  /**
   * `/models/<model_key>` of the class's 3D model file (ADR-0020). `null` when the class has no
   * model: clients draw a neutral box from `footprintM`.
   */
  modelUrl: string | null;
  footprintM: AssetFootprint;
}

/** A piece of equipment or a sensor at a fixed place on the site. Its readings are not here. */
export interface Asset {
  id: string;
  /** The operators' tag: `CT-01`, `AHU-C1`, `ICS-DC`. */
  code: string;
  name: string;
  class: AssetClass;
  zoneId: string;
  position: LngLat;
  /** Metres of the asset's base above ground: ≥ 0. A roof is the building's `heightM`. */
  elevationM: number;
  /**
   * Degrees clockwise from true north, 0 ≤ heading < 360, as `CameraFieldOfView.heading`. For a
   * model, the direction its front faces.
   */
  headingDeg: number;
  /** The class's headline points, ordered by `headline` rank: at most two. */
  headline: TelemetryPoint[];
}

/**
 * A threshold rule as one asset sees it: only enabled rules, with an asset's own override
 * already replacing the class rule of the same `name`.
 */
export interface TelemetryRule {
  name: string;
  /** The `key` of one of the asset's `number` or `boolean` points. */
  key: string;
  comparator: TelemetryComparator;
  /** The reading that is a breach once passed. A boolean point uses 0.5. */
  limit: number;
  /**
   * The level a reading must pass back before the rule can raise again, on the safe side of
   * `limit`: `clear ≤ limit` for `above`, `clear ≥ limit` for `below`.
   */
  clear: number;
  /** Seconds a breach must last before it raises an incident: ≥ 0. */
  forS: number;
  severity: IncidentSeverity;
  /** A `facilities` or `environment` type (ADR-0021). The type does not enforce it. */
  incidentType: IncidentType;
}

export interface AssetDetail extends Asset {
  /** Every point of the class, headline or not. */
  points: TelemetryPoint[];
  rules: TelemetryRule[];
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
