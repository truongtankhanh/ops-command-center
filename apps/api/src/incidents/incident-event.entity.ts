import type { Actor, ActorKind, IncidentEvent, IncidentEventKind } from '@occ/contracts';
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

  /** Who caused this entry; the three `actor_*` columns are one `Actor` (ADR-0011). */
  @Column({ name: 'actor_kind', type: 'varchar', length: 16 })
  actorKind: ActorKind;

  @Column({ name: 'actor_subject', type: 'varchar', length: 255 })
  actorSubject: string;

  /** A snapshot: renaming the account later does not rewrite the audit log. */
  @Column({ name: 'actor_name', type: 'varchar', length: 255 })
  actorName: string;

  static create(
    kind: IncidentEventKind,
    at: Date,
    actor: Actor,
    note: string | null,
  ): IncidentEventEntity {
    return Object.assign(new IncidentEventEntity(), {
      kind,
      at,
      note,
      actorKind: actor.kind,
      actorSubject: actor.subject,
      actorName: actor.displayName,
    });
  }

  toContract(): IncidentEvent {
    return {
      id: this.id,
      kind: this.kind,
      note: this.note,
      at: this.at.toISOString(),
      actor: { kind: this.actorKind, subject: this.actorSubject, displayName: this.actorName },
    };
  }
}
