import type { DataSourceOptions } from 'typeorm';
import { CameraEntity } from '../cameras/camera.entity';
import { IncidentEventEntity } from '../incidents/incident-event.entity';
import { IncidentEntity } from '../incidents/incident.entity';
import { OutboxEntity } from '../outbox/outbox.entity';
import { ZoneEntity } from '../zones/zone.entity';
import { InitialSchema1790800000000 } from './migrations/1790800000000-initial-schema';
import { IncidentVersion1790924435743 } from './migrations/1790924435743-incident-version';
import { Outbox1790929369576 } from './migrations/1790929369576-outbox';

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
  entities,
  migrations: [InitialSchema1790800000000, IncidentVersion1790924435743, Outbox1790929369576],
  migrationsRun: true,
  synchronize: false,
});
