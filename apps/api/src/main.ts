import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { Env } from './config/env.validation';
import { configureApp, isApiDocsEnabled } from './configure-app';
import { MetricsServer } from './metrics/metrics-server';

async function bootstrap(): Promise<void> {
  // Buffered until `configureApp` installs pino, so boot lines get the same JSON format (ADR-0014).
  const app = configureApp(await NestFactory.create(AppModule, { bufferLogs: true }));
  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  const docs = isApiDocsEnabled(config) ? ' — docs at /api/docs' : '';
  Logger.log(`API on http://localhost:${port}/api${docs}`, 'Bootstrap');
  // Its own port, never behind nginx (ADR-0015). Here, not in `configureApp`: tests never bind it.
  const metricsPort = config.get('METRICS_PORT', { infer: true });
  await app.get(MetricsServer).listen(metricsPort);
  Logger.log(`Metrics on http://localhost:${metricsPort}/metrics`, 'Bootstrap');
}

void bootstrap();
