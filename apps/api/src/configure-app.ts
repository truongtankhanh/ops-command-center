import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiExceptionFilter } from './common/api-exception.filter';

/** HTTP setup shared by `main.ts` and the e2e tests, so tests run the real configuration. */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

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
  SwaggerModule.setup('api/docs', app, document);
  return app;
}
