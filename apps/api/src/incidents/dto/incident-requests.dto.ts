import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentType,
  type ListIncidentsQuery,
  type LngLat,
  type ReportIncidentRequest,
  type TransitionIncidentRequest,
} from '@occ/contracts';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  isLatitude,
  isLongitude,
  registerDecorator,
} from 'class-validator';

/** Accepts `?status=open,acknowledged` as well as `?status=open&status=acknowledged`. */
const toList = ({ value }: { value: unknown }) =>
  (Array.isArray(value) ? value : String(value).split(','))
    .map((v) => String(v).trim())
    .filter(Boolean);

/** Page size when `limit` is not given. */
export const DEFAULT_INCIDENT_LIMIT = 100;

export class ListIncidentsQueryDto implements ListIncidentsQuery {
  /**
   * Only these statuses. Comma-separated (`open,acknowledged`) or repeated
   * (`status=open&status=acknowledged`).
   */
  @ApiPropertyOptional({
    enum: INCIDENT_STATUSES,
    isArray: true,
    example: ['open', 'acknowledged'],
  })
  @IsOptional()
  @Transform(toList)
  @IsIn(INCIDENT_STATUSES, { each: true })
  status?: IncidentStatus[];

  /** Only these severities: comma-separated or repeated, like `status`. */
  @ApiPropertyOptional({ enum: INCIDENT_SEVERITIES, isArray: true, example: ['high', 'critical'] })
  @IsOptional()
  @Transform(toList)
  @IsIn(INCIDENT_SEVERITIES, { each: true })
  severity?: IncidentSeverity[];

  /** Maximum number of incidents returned. */
  @ApiPropertyOptional({ default: DEFAULT_INCIDENT_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class ReportIncidentDto implements ReportIncidentRequest {
  /**
   * What happened.
   * @example 'fire_alarm'
   */
  @IsIn(INCIDENT_TYPES)
  type: IncidentType;

  /**
   * How urgent it is. Higher severities sort first in the incident list.
   * @example 'high'
   */
  @IsIn(INCIDENT_SEVERITIES)
  severity: IncidentSeverity;

  /**
   * One-line summary shown in the incident feed.
   * @example 'Smoke in the east stairwell'
   */
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title: string;

  /**
   * Free-text details for responders.
   * @example 'Alarm panel shows level 3. Night guard on the way.'
   */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /**
   * Zone the incident is in. Must exist (see `GET /api/zones`).
   * @example '00000000-0000-0000-0000-000000000000'
   */
  @IsUUID()
  zoneId: string;

  /** [lng, lat], longitude -180..180 and latitude -90..90. Defaults to the zone centre. */
  @ApiPropertyOptional({ type: [Number], minItems: 2, maxItems: 2, example: [108.4415, 11.953] })
  @IsOptional()
  @IsLngLat()
  position?: LngLat;
}

export class TransitionIncidentDto implements TransitionIncidentRequest {
  /**
   * Optional operator note recorded on the timeline.
   * @example 'Security team dispatched'
   */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/** `[lng, lat]` with each coordinate in range. */
function IsLngLat(): PropertyDecorator {
  return (target, propertyKey) =>
    registerDecorator({
      name: 'isLngLat',
      target: target.constructor,
      propertyName: propertyKey.toString(),
      options: { message: '$property must be [longitude, latitude]' },
      validator: {
        validate: (value: unknown) =>
          Array.isArray(value) &&
          value.length === 2 &&
          isLongitude(String(value[0])) &&
          isLatitude(String(value[1])) &&
          value.every((n) => typeof n === 'number'),
      },
    });
}
