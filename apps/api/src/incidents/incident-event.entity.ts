import type { IncidentEvent, IncidentEventKind } from '@occ/contracts';
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { IncidentEntity } from './incident.entity';

/** Append-only timeline entry. The timeline is the incident's audit log. */
@Entity('incident_event')
export class IncidentEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'incident_id', type: 'uuid' })
  incidentId: string;

  @ManyToOne('IncidentEntity', 'timeline', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'incident_id' })
  incident?: IncidentEntity;

  @Column({ type: 'varchar', length: 16 })
  kind: IncidentEventKind;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'timestamptz' })
  at: Date;

  static create(kind: IncidentEventKind, at: Date, note: string | null): IncidentEventEntity {
    return Object.assign(new IncidentEventEntity(), { kind, at, note });
  }

  toContract(): IncidentEvent {
    return { id: this.id, kind: this.kind, note: this.note, at: this.at.toISOString() };
  }
}
