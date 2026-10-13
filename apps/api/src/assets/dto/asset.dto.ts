import { ApiProperty } from '@nestjs/swagger';
import {
  type Asset,
  type AssetClass,
  type AssetDetail,
  type AssetFootprint,
  INCIDENT_SEVERITIES,
  INCIDENT_TYPES,
  type IncidentSeverity,
  type IncidentType,
  type LngLat,
  TELEMETRY_COMPARATORS,
  TELEMETRY_POINT_KINDS,
  type TelemetryComparator,
  type TelemetryPoint,
  type TelemetryPointKind,
  type TelemetryRule,
} from '@occ/contracts';

// Strict bounds are in the descriptions, not `exclusiveMinimum`: @nestjs/swagger types it as an
// OpenAPI 3.0 boolean, which 3.1 replaced with a number (as in `CameraFieldOfViewDto`).

/** OpenAPI shape of `AssetFootprint`. `implements` keeps it in lockstep with the contract. */
export class AssetFootprintDto implements AssetFootprint {
  @ApiProperty({ description: 'Metres, > 0', minimum: 0, example: 4 })
  width: number;

  @ApiProperty({ description: 'Metres, > 0', minimum: 0, example: 4 })
  depth: number;

  @ApiProperty({ description: 'Metres, > 0', minimum: 0, example: 5 })
  height: number;
}

export class AssetClassDto implements AssetClass {
  /** Asset class id. */
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'Lower snake case', example: 'cooling_tower' })
  code: string;

  @ApiProperty({ example: 'Cooling tower' })
  name: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "`/models/<model_key>` of the class's 3D model file. `null` when the class has no model: " +
      'clients then draw a neutral box from `footprintM`.',
    example: '/models/cooling_tower.glb',
  })
  modelUrl: string | null;

  @ApiProperty({
    type: () => AssetFootprintDto,
    description: 'The box a neutral placeholder is drawn from',
  })
  footprintM: AssetFootprint;
}

/** One thing an asset class measures or reports, as described by the class. */
export class TelemetryPointDto implements TelemetryPoint {
  @ApiProperty({
    description: 'camelCase and unique within the asset class',
    example: 'motorTempC',
  })
  key: string;

  @ApiProperty({ example: 'Motor temperature' })
  label: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '`null` for a point with no unit (a boolean or an enum)',
    example: '°C',
  })
  unit: string | null;

  @ApiProperty({ enum: TELEMETRY_POINT_KINDS })
  kind: TelemetryPointKind;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Lowest valid value of a `number` point. `null` when there is no lower bound, and for ' +
      'booleans and enums. A reading outside `min`/`max` is dropped, never clamped.',
    example: -20,
  })
  min: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Highest valid value of a `number` point. `null` when there is no upper bound, and as `min`.',
    example: 150,
  })
  max: number | null;

  @ApiProperty({
    type: [String],
    nullable: true,
    description: 'The values an `enum` point can take. `null` for every other kind.',
    example: ['off', 'auto', 'hand'],
  })
  enumValues: string[] | null;

  @ApiProperty({
    description:
      'How often a device sends this point, in seconds (> 0). A client judges freshness ' +
      'against it.',
    minimum: 0,
    example: 5,
  })
  expectedIntervalS: number;

  @ApiProperty({
    type: Number,
    enum: [1, 2],
    nullable: true,
    description:
      "Rank among the class's headline points. `null` when the point is not a headline, so it " +
      'appears in neither the tooltip nor the Assets list.',
    example: 2,
  })
  headline: 1 | 2 | null;
}

/**
 * A threshold rule as one asset sees it. It carries neither an `id` nor whether it is enabled:
 * only enabled rules are served, and an asset's own rule has already replaced the class rule of
 * the same `name`.
 */
export class TelemetryRuleDto implements TelemetryRule {
  @ApiProperty({ example: 'Motor over-temperature' })
  name: string;

  @ApiProperty({ description: "The `key` of one of the asset's points", example: 'motorTempC' })
  key: string;

  @ApiProperty({
    enum: TELEMETRY_COMPARATORS,
    description: 'Which side of `limit` is a breach',
  })
  comparator: TelemetryComparator;

  @ApiProperty({
    description: 'The reading that is a breach once passed. A boolean point uses 0.5.',
    example: 85,
  })
  limit: number;

  @ApiProperty({
    description:
      'The level a reading must pass back before the rule can raise again, on the safe side of ' +
      '`limit`: `clear` ≤ `limit` for `above`, `clear` ≥ `limit` for `below`',
    example: 80,
  })
  clear: number;

  @ApiProperty({
    description: 'Seconds a breach must last before it raises an incident (≥ 0)',
    minimum: 0,
    example: 60,
  })
  forS: number;

  @ApiProperty({ enum: INCIDENT_SEVERITIES })
  severity: IncidentSeverity;

  @ApiProperty({
    enum: INCIDENT_TYPES,
    description: 'A `facilities` or `environment` type of the incident a sustained breach raises',
  })
  incidentType: IncidentType;
}

/** A piece of equipment or a sensor at a fixed place on the site. Its readings are not here. */
export class AssetDto implements Asset {
  /** Asset id. */
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ description: "The operators' tag", example: 'CT-01' })
  code: string;

  @ApiProperty({ example: 'Cooling tower 1' })
  name: string;

  @ApiProperty({ type: () => AssetClassDto })
  class: AssetClass;

  /** Zone the asset stands in. */
  @ApiProperty({ format: 'uuid' })
  zoneId: string;

  @ApiProperty({
    description: 'Position as [lng, lat]',
    type: [Number],
    minItems: 2,
    maxItems: 2,
  })
  position: LngLat;

  @ApiProperty({
    description: "Metres of the asset's base above ground (≥ 0). A roof is the building's height.",
    minimum: 0,
    example: 14,
  })
  elevationM: number;

  @ApiProperty({
    description:
      'Degrees clockwise from true north (0 ≤ heading < 360); for a model, the direction its ' +
      'front faces',
    minimum: 0,
    maximum: 360,
    example: 0,
  })
  headingDeg: number;

  @ApiProperty({
    type: () => [TelemetryPointDto],
    description: "The class's headline points, ordered by `headline` rank: at most two",
  })
  headline: TelemetryPoint[];
}

export class AssetDetailDto extends AssetDto implements AssetDetail {
  @ApiProperty({
    type: () => [TelemetryPointDto],
    description:
      'Every point of the class, headline or not: the headline points by rank, then the rest by ' +
      '`key`',
  })
  points: TelemetryPoint[];

  @ApiProperty({
    type: () => [TelemetryRuleDto],
    description:
      'The enabled rules that apply to this asset, by `name`. An asset-level rule replaces the ' +
      'class rule of the same `name`; a disabled rule is left out, so a disabled asset-level ' +
      'rule turns that rule off for this asset only.',
  })
  rules: TelemetryRule[];
}
