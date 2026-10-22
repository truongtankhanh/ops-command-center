import type { IncidentSeverity, IncidentType } from './incident';

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
