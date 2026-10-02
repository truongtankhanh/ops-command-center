import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { Env } from './config/env.validation';
import { configureApp, isApiDocsEnabled } from './configure-app';

async function bootstrap(): Promise<void> {
  const app = configureApp(await NestFactory.create(AppModule));
  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  const docs = isApiDocsEnabled(config) ? ' — docs at /api/docs' : '';
  Logger.log(`API on http://localhost:${port}/api${docs}`, 'Bootstrap');
}

void bootstrap();
