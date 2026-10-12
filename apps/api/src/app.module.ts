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
import { LoggingModule } from './logging/logging.module';
import { MetricsModule } from './metrics/metrics.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SimulatorModule } from './simulator/simulator.module';
import { SitesModule } from './sites/sites.module';
import { ZonesModule } from './zones/zones.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: envFilePath(),
      validate: validateEnv,
    }),
    LoggingModule,
    MetricsModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        typeormOptions({
          DB_HOST: config.get('DB_HOST', { infer: true }),
          DB_PORT: config.get('DB_PORT', { infer: true }),
          DB_NAME: config.get('DB_NAME', { infer: true }),
          DB_USER: config.get('DB_USER', { infer: true }),
          DB_PASSWORD: config.get('DB_PASSWORD', { infer: true }),
          DB_SSL: config.get('DB_SSL', { infer: true }),
        }),
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
    SitesModule,
    CamerasModule,
    IncidentsModule,
    RealtimeModule,
    SimulatorModule,
    HealthModule,
  ],
  providers: [SeedService],
})
export class AppModule {}
