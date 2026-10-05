import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import type { Env } from '../config/env.validation';
import { LogLevelOverrideEntity } from './log-level-override.entity';
import { LogLevelService } from './log-level.service';
import { loggerParams } from './logger-options';

/**
 * The app's logger (ADR-0014): pino with the request log, redaction and the runtime level.
 * `configureApp` makes it Nest's logger and mounts the correlation id middleware.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        loggerParams({
          NODE_ENV: config.get('NODE_ENV', { infer: true }),
          LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }),
          DEPLOYMENT_ENV: config.get('DEPLOYMENT_ENV', { infer: true }),
        }),
    }),
    TypeOrmModule.forFeature([LogLevelOverrideEntity]),
  ],
  providers: [LogLevelService],
})
export class LoggingModule {}
