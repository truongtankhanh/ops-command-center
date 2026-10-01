import { ApiProperty } from '@nestjs/swagger';
import {
  INCIDENT_EVENT_KINDS,
  INCIDENT_SEVERITIES,
  INCIDENT_SOURCES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  type Incident,
  type IncidentDetail,
  type IncidentEvent,
  type IncidentEventKind,
  type IncidentSeverity,
  type IncidentSource,
  type IncidentStatus,
  type IncidentType,
  type LngLat,
} from '@occ/contracts';

/** OpenAPI response shapes. `implements` keeps them in lockstep with `@occ/contracts`. */

export class IncidentDto implements Incident {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'INC-000042' })
  code: string;

  @ApiProperty({ enum: INCIDENT_TYPES })
  type: IncidentType;

  @ApiProperty({ enum: INCIDENT_SEVERITIES })
  severity: IncidentSeverity;

  @ApiProperty({ enum: INCIDENT_STATUSES })
  status: IncidentStatus;

  @ApiProperty({ example: 'Door forced open — service corridor' })
  title: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ format: 'uuid' })
  zoneId: string;

  @ApiProperty({ description: '[lng, lat]', type: [Number], minItems: 2, maxItems: 2 })
  position: LngLat;

  @ApiProperty({ enum: INCIDENT_SOURCES })
  source: IncidentSource;

  @ApiProperty({ format: 'date-time' })
  reportedAt: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  acknowledgedAt: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  resolvedAt: string | null;
}

export class IncidentEventDto implements IncidentEvent {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: INCIDENT_EVENT_KINDS })
  kind: IncidentEventKind;

  @ApiProperty({ type: String, nullable: true })
  note: string | null;

  @ApiProperty({ format: 'date-time' })
  at: string;
}

export class IncidentDetailDto extends IncidentDto implements IncidentDetail {
  @ApiProperty({ type: [IncidentEventDto] })
  timeline: IncidentEventDto[];
}
