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
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  isLatitude,
  isLongitude,
  registerDecorator,
} from 'class-validator';

/** Accepts `?status=open,acknowledged` as well as `?status=open&status=acknowledged`. */
const toList = ({ value }: { value: unknown }) =>
  (Array.isArray(value) ? value : String(value).split(','))
    .map((v) => String(v).trim())
    .filter(Boolean);

export class ListIncidentsQueryDto implements ListIncidentsQuery {
  @ApiPropertyOptional({ enum: INCIDENT_STATUSES, isArray: true, example: 'open,acknowledged' })
  @IsOptional()
  @Transform(toList)
  @IsIn(INCIDENT_STATUSES, { each: true })
  status?: IncidentStatus[];

  @ApiPropertyOptional({ enum: INCIDENT_SEVERITIES, isArray: true, example: 'high,critical' })
  @IsOptional()
  @Transform(toList)
  @IsIn(INCIDENT_SEVERITIES, { each: true })
  severity?: IncidentSeverity[];

  @ApiPropertyOptional({ minimum: 1, maximum: 500, default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class ReportIncidentDto implements ReportIncidentRequest {
  @IsIn(INCIDENT_TYPES)
  type: IncidentType;

  @IsIn(INCIDENT_SEVERITIES)
  severity: IncidentSeverity;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsUUID()
  zoneId: string;

  /** [lng, lat]. Defaults to the zone centre. */
  @ApiPropertyOptional({ type: [Number], minItems: 2, maxItems: 2, example: [108.4415, 11.953] })
  @IsOptional()
  @IsLngLat()
  position?: LngLat;
}

export class TransitionIncidentDto implements TransitionIncidentRequest {
  /** Optional operator note recorded on the timeline. */
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
