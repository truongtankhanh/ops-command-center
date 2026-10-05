import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthModule } from './auth/auth.module';
import { CamerasModule } from './cameras/cameras.module';
import { envFilePath } from './config/env-files';
import { type Env, validateEnv } from './config/env.validation';
import { runMigrationsOnBoot } from './database/migrate-on-boot';
import { SeedService } from './database/seed/seed.service';
import { typeormOptions } from './database/typeorm-options';
import { HealthModule } from './health/health.module';
import { IncidentsModule } from './incidents/incidents.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SimulatorModule } from './simulator/simulator.module';
import { ZonesModule } from './zones/zones.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: envFilePath(),
      validate: validateEnv,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        typeormOptions(config.get('DATABASE_URL', { infer: true })),
      dataSourceFactory: async (options) => {
        const dataSource = await new DataSource(options!).initialize();
        try {
          await runMigrationsOnBoot(dataSource);
        } catch (error) {
          // @nestjs/typeorm retries the factory; don't leave this attempt's pool open.
          await dataSource.destroy();
          throw error;
        }
        return dataSource;
      },
    }),
    EventEmitterModule.forRoot(),
    AuthModule,
    RateLimitModule,
    ZonesModule,
    CamerasModule,
    IncidentsModule,
    RealtimeModule,
    SimulatorModule,
    HealthModule,
  ],
  providers: [SeedService],
})
export class AppModule {}
