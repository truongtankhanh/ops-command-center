import type { DataSourceOptions } from 'typeorm';
import { CameraEntity } from '../cameras/camera.entity';
import { IncidentEventEntity } from '../incidents/incident-event.entity';
import { IncidentEntity } from '../incidents/incident.entity';
import { ZoneEntity } from '../zones/zone.entity';
import { InitialSchema1790800000000 } from './migrations/1790800000000-initial-schema';
import { IncidentVersion1790924435743 } from './migrations/1790924435743-incident-version';

export const entities = [ZoneEntity, CameraEntity, IncidentEntity, IncidentEventEntity];

/** Shared by the Nest app and the TypeORM CLI, so both see the same schema. */
export const typeormOptions = (databaseUrl: string): DataSourceOptions => ({
  type: 'postgres',
  url: databaseUrl,
  entities,
  migrations: [InitialSchema1790800000000, IncidentVersion1790924435743],
  migrationsRun: true,
  synchronize: false,
});
