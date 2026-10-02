import type { DataSourceOptions } from 'typeorm';
import { CameraEntity } from '../cameras/camera.entity';
import { IncidentEventEntity } from '../incidents/incident-event.entity';
import { IncidentEntity } from '../incidents/incident.entity';
import { OutboxEntity } from '../outbox/outbox.entity';
import { ZoneEntity } from '../zones/zone.entity';
import { InitialSchema1790800000000 } from './migrations/1790800000000-initial-schema';
import { IncidentVersion1790924435743 } from './migrations/1790924435743-incident-version';
import { Outbox1790929369576 } from './migrations/1790929369576-outbox';

/**
 * Per process, CLI included. Sized for the Compose demo: 2 replicas × 10 + a CLI run + admin ≈ 35
 * of PostgreSQL's default 100 `max_connections`. Re-check against the real ceiling before scaling.
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
];

/** Shared by the Nest app and the TypeORM CLI, so both see the same schema. */
export const typeormOptions = (databaseUrl: string): DataSourceOptions => ({
  type: 'postgres',
  url: databaseUrl,
  poolSize: POOL_SIZE,
  connectTimeoutMS: POOL_WAIT_MS,
  extra: SESSION_TIMEOUTS,
  entities,
  migrations: [InitialSchema1790800000000, IncidentVersion1790924435743, Outbox1790929369576],
  migrationsRun: true,
  synchronize: false,
  // Extensions belong in migrations; uuid ids come from the core `gen_random_uuid()` default.
  installExtensions: false,
});
