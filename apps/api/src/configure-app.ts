import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiExceptionFilter } from './common/api-exception.filter';
import type { Env } from './config/env.validation';

/** HTTP setup shared by `main.ts` and the e2e tests, so tests run the real configuration. */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  // Exposure policy per environment: docs/adr/0005-api-docs-exposure-per-environment.md
  const config = app.get(ConfigService<Env, true>);
  if (isApiDocsEnabled(config)) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Ops Command Center API')
        .setDescription(
          'Incidents, zones and cameras. Live updates on the `/events` Socket.IO namespace.',
        )
        .setVersion('0.1.0')
        .build(),
    );
    // Production only serves docs on explicit opt-in, and never lets the page fire requests.
    const isProduction = config.get('NODE_ENV', { infer: true }) === 'production';
    SwaggerModule.setup(
      'api/docs',
      app,
      document,
      isProduction ? { swaggerOptions: { supportedSubmitMethods: [] } } : undefined,
    );
  }
  return app;
}

/** Swagger UI and the raw spec: on by default outside production, opt-in via `API_DOCS_ENABLED`. */
export function isApiDocsEnabled(config: ConfigService<Env, true>): boolean {
  return (
    config.get('API_DOCS_ENABLED', { infer: true }) ??
    config.get('NODE_ENV', { infer: true }) !== 'production'
  );
}
