import type {
  Incident,
  IncidentDetail,
  IncidentSeverity,
  IncidentSource,
  IncidentStatus,
  IncidentType,
} from '@occ/contracts';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { InvalidTransitionError } from '../common/domain-errors';
import { ZoneEntity } from '../zones/zone.entity';
import { IncidentEventEntity } from './incident-event.entity';

/**
 * An incident and its lifecycle rules. Status changes only happen through
 * `acknowledge()` and `resolve()`, which also append to the timeline.
 */
@Entity('incident')
@Index(['status', 'reportedAt'])
export class IncidentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Human-friendly reference, e.g. `INC-000042`. Assigned from a database sequence. */
  @Column({ type: 'varchar', length: 16, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 32 })
  type: IncidentType;

  @Column({ type: 'varchar', length: 16 })
  severity: IncidentSeverity;

  @Column({ type: 'varchar', length: 16 })
  status: IncidentStatus;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'zone_id', type: 'uuid' })
  zoneId: string;

  @ManyToOne(() => ZoneEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'zone_id' })
  zone?: ZoneEntity;

  @Column({ type: 'double precision' })
  lng: number;

  @Column({ type: 'double precision' })
  lat: number;

  @Column({ type: 'varchar', length: 16 })
  source: IncidentSource;

  @Column({ name: 'reported_at', type: 'timestamptz' })
  reportedAt: Date;

  @Column({ name: 'acknowledged_at', type: 'timestamptz', nullable: true })
  acknowledgedAt: Date | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  /** Loaded for reads only; new entries are written from `pendingEvents`. */
  @OneToMany(() => IncidentEventEntity, (event) => event.incident)
  timeline?: IncidentEventEntity[];

  /**
   * Timeline entries produced by transitions in the current unit of work.
   * Not a column: the service persists them in the same transaction as the incident.
   */
  pendingEvents: IncidentEventEntity[] = [];

  static report(props: {
    code: string;
    type: IncidentType;
    severity: IncidentSeverity;
    title: string;
    description?: string | null;
    zoneId: string;
    lng: number;
    lat: number;
    source: IncidentSource;
    at: Date;
  }): IncidentEntity {
    const incident = Object.assign(new IncidentEntity(), {
      ...props,
      description: props.description ?? null,
      status: 'open' as const,
      reportedAt: props.at,
      acknowledgedAt: null,
      resolvedAt: null,
    });
    incident.record('reported', props.at, null);
    return incident;
  }

  acknowledge(at: Date, note: string | null = null): void {
    if (this.status !== 'open') {
      throw new InvalidTransitionError(this.code, this.status, 'acknowledge');
    }
    this.status = 'acknowledged';
    this.acknowledgedAt = at;
    this.record('acknowledged', at, note);
  }

  resolve(at: Date, note: string | null = null): void {
    if (this.status === 'resolved') {
      throw new InvalidTransitionError(this.code, this.status, 'resolve');
    }
    this.status = 'resolved';
    this.resolvedAt = at;
    this.record('resolved', at, note);
  }

  private record(kind: IncidentEventEntity['kind'], at: Date, note: string | null): void {
    (this.pendingEvents ??= []).push(IncidentEventEntity.create(kind, at, note));
  }

  toContract(): Incident {
    return {
      id: this.id,
      code: this.code,
      type: this.type,
      severity: this.severity,
      status: this.status,
      title: this.title,
      description: this.description,
      zoneId: this.zoneId,
      position: [this.lng, this.lat],
      source: this.source,
      reportedAt: this.reportedAt.toISOString(),
      acknowledgedAt: this.acknowledgedAt?.toISOString() ?? null,
      resolvedAt: this.resolvedAt?.toISOString() ?? null,
    };
  }

  toDetailContract(): IncidentDetail {
    const timeline = [...(this.timeline ?? [])].sort((a, b) => a.at.getTime() - b.at.getTime());
    return { ...this.toContract(), timeline: timeline.map((event) => event.toContract()) };
  }
}
