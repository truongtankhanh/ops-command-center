import type { DataSourceOptions } from 'typeorm';
import { CameraEntity } from '../cameras/camera.entity';
import { IdempotencyKeyEntity } from '../incidents/idempotency-key.entity';
import { IncidentEventEntity } from '../incidents/incident-event.entity';
import { IncidentEntity } from '../incidents/incident.entity';
import { OutboxEntity } from '../outbox/outbox.entity';
import { ZoneEntity } from '../zones/zone.entity';
import { InitialSchema1790800000000 } from './migrations/1790800000000-initial-schema';
import { IncidentVersion1790924435743 } from './migrations/1790924435743-incident-version';
import { Outbox1790929369576 } from './migrations/1790929369576-outbox';
import { IdempotencyKey1791083081820 } from './migrations/1791083081820-idempotency-key';
import { IdempotencyKeySubject1791088055281 } from './migrations/1791088055281-idempotency-key-subject';
import { IncidentEventActor1791151300130 } from './migrations/1791151300130-incident-event-actor';

/**
 * Per process, CLI included. Sized for the Compose demo: 2 replicas × 10 + a CLI run + admin ≈ 35
 * of PostgreSQL's default 100 `max_connections`. Re-check against the real ceiling before scaling.
 * Up to 2 slots per replica are held for the process's lifetime (outbox listener, simulator
 * leader), so at least 8 stay free for requests.
 */
const POOL_SIZE = 10;
/** Waiting longer than this for a pool slot (or a new connection) fails instead of hanging. */
const POOL_WAIT_MS = 5_000;
/**
 * Session limits sent on every connection, so one stuck query or transaction cannot hold a pool
 * slot, its locks and autovacuum forever. Migrations inherit them too (ADR-0004).
 */
const SESSION_TIMEOUTS = {
  statement_timeout: 15_000,
  lock_timeout: 5_000,
  idle_in_transaction_session_timeout: 60_000,
};

export const entities = [
  ZoneEntity,
  CameraEntity,
  IncidentEntity,
  IncidentEventEntity,
  OutboxEntity,
  IdempotencyKeyEntity,
];

/** Shared by the Nest app and the TypeORM CLI, so both see the same schema. */
export const typeormOptions = (databaseUrl: string): DataSourceOptions => ({
  type: 'postgres',
  url: databaseUrl,
  poolSize: POOL_SIZE,
  connectTimeoutMS: POOL_WAIT_MS,
  extra: SESSION_TIMEOUTS,
  entities,
  migrations: [
    InitialSchema1790800000000,
    IncidentVersion1790924435743,
    Outbox1790929369576,
    IdempotencyKey1791083081820,
    IdempotencyKeySubject1791088055281,
    IncidentEventActor1791151300130,
  ],
  // The app applies migrations itself, under a lock shared by every replica (`migrate-on-boot.ts`).
  migrationsRun: false,
  synchronize: false,
  // Extensions belong in migrations; uuid ids come from the core `gen_random_uuid()` default.
  installExtensions: false,
});
