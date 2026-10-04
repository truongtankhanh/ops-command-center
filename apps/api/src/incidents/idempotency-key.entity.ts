import type { IncidentDetail } from '@occ/contracts';
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * One `Idempotency-Key` sent with `POST /incidents` and the response it produced (ADR-0009).
 * Inserted in the same transaction that creates the incident, so a committed row always has its
 * response; the `null`s exist only inside that transaction. Expired rows count as absent.
 */
@Entity('idempotency_key')
export class IdempotencyKeyEntity {
  /** As the client sent it; case-sensitive. */
  @PrimaryColumn({ type: 'varchar', length: 255 })
  key: string;

  /** Hex SHA-256 of the request body, to tell a retry from a reused key. */
  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash: string;

  @Column({ name: 'response_status', type: 'smallint', nullable: true })
  responseStatus: number | null;

  /** `json`, not `jsonb`: keeps key order, so a replay is byte-identical to the first response. */
  @Column({ name: 'response_body', type: 'json', nullable: true })
  responseBody: IncidentDetail | null;

  /** The incident created. No foreign key: like the outbox, this is a log, not a relation. */
  @Column({ name: 'incident_id', type: 'uuid', nullable: true })
  incidentId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Index('idx_idempotency_key_expires_at')
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;
}
