import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CamerasModule } from './cameras/cameras.module';
import { envFilePath } from './config/env-files';
import { type Env, validateEnv } from './config/env.validation';
import { SeedService } from './database/seed/seed.service';
import { typeormOptions } from './database/typeorm-options';
import { HealthController } from './health/health.controller';
import { IncidentsModule } from './incidents/incidents.module';
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
    }),
    EventEmitterModule.forRoot(),
    ZonesModule,
    CamerasModule,
    IncidentsModule,
    RealtimeModule,
    SimulatorModule,
  ],
  controllers: [HealthController],
  providers: [SeedService],
})
export class AppModule {}
