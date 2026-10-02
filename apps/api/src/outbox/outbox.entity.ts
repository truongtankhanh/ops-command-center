import type { Incident, IncidentEvents } from '@occ/contracts';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type OutboxEventName = (typeof IncidentEvents)[keyof typeof IncidentEvents];

/**
 * A domain event waiting to be published (ADR-0007). Written in the same transaction as the change
 * it describes, so the event exists exactly when the change committed. `OutboxRelay` publishes
 * pending rows and stamps `publishedAt`.
 */
@Entity('outbox')
export class OutboxEntity {
  /** Identity, so rows can be published in insertion order. `pg` returns bigint as a string. */
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'ALWAYS' })
  id: string;

  /** The incident the event is about. No foreign key: the outbox is a log, not a relation. */
  @Column({ name: 'aggregate_id', type: 'uuid' })
  aggregateId: string;

  @Column({ type: 'varchar', length: 32 })
  event: OutboxEventName;

  /** The exact payload clients receive, as it was at commit time. */
  @Column({ type: 'jsonb' })
  payload: Incident;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /** `null` while pending. */
  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  static create(event: OutboxEventName, incident: Incident): OutboxEntity {
    return Object.assign(new OutboxEntity(), {
      aggregateId: incident.id,
      event,
      payload: incident,
      publishedAt: null,
    });
  }
}
