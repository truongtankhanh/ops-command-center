import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Express } from 'express';
import { ApiExceptionFilter } from './common/api-exception.filter';
import type { Env } from './config/env.validation';

/** HTTP setup shared by `main.ts` and the e2e tests, so tests run the real configuration. */
export function configureApp(app: INestApplication): INestApplication {
  const config = app.get(ConfigService<Env, true>);
  // `req.ip` is the client nginx saw, never a value the client wrote (ADR-0012).
  (app.getHttpAdapter().getInstance() as Express).set(
    'trust proxy',
    config.get('TRUST_PROXY_HOPS', { infer: true }),
  );

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  // Exposure policy per environment: docs/adr/0005-api-docs-exposure-per-environment.md
  if (isApiDocsEnabled(config)) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Ops Command Center API')
        .setDescription(
          'Incidents, zones and cameras. Live updates on the `/events` Socket.IO namespace. ' +
            'Every endpoint needs an OIDC access token as `Authorization: Bearer <token>`; ' +
            '`/events` takes the same token in the handshake as `auth.token`. ' +
            'Writes need the `operator` or `supervisor` role; a token with none of `operator`, ' +
            '`supervisor` and `viewer` gets 403.',
        )
        .setVersion('0.1.0')
        .addBearerAuth()
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
