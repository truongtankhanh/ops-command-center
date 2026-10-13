---
paths:
  - 'apps/api/src/**/*.ts'
---

# API (NestJS) rules

## Module shape

- One folder per feature: `<feature>.module.ts`, `.controller.ts`, `.service.ts`, `.entity.ts`, `dto/*.dto.ts`.
  Register the module in `app.module.ts`. An entity also goes into the `entities` array in
  `database/typeorm-options.ts`, and `TypeOrmModule.forFeature` lists only what the module's services inject.
- Constructor-injected classes are imported as values. Do not turn them into `import type`: with
  `emitDecoratorMetadata` that silently breaks DI (the lint rule is off for this app for that reason).
- Read configuration with `ConfigService<Env, true>` and `{ infer: true }`, not `process.env`.

## Ports and adapters

- `TelemetrySource` (`telemetry/telemetry-source.ts`) and `CameraSource` (`@occ/camera-adapter`) are ports. The
  implementation is chosen once in a provider (`telemetry-source.provider.ts`) from an env value.
- The provider's `switch` ends in a `never` check: adding a kind to `Env` without a case must fail to compile.
- Listeners register before `start()`; a source emits only between `start()` and `stop()`; it does not validate. The
  ingest service validates and counts.

## Errors, validation, authorization

- Services throw `DomainError` subclasses from `common/domain-errors.ts`. `ApiExceptionFilter` maps them:
  `EntityNotFoundError` 404, `InvalidTransitionError` 409, `PositionOutsideZoneError` 400,
  `CategoryOutOfScopeError` 403, any other `DomainError` **422**. A new error that needs another status needs a branch
  in the filter and a doc note; 422 on `POST /incidents` already means a reused `Idempotency-Key`.
- Global `ValidationPipe`: `whitelist`, `forbidNonWhitelisted`, `transform`. Request and response DTOs carry
  class-validator and Swagger decorators; error responses use `ApiErrorDto`.
- `AuthGuard`, `RolesGuard` and `ThrottlerGuard` are global (`auth.module.ts`). Every handler declares
  `@RequirePermission(...)` or `@Public()`. Permissions and category scope come from `@occ/contracts`
  (`ROLE_PERMISSIONS`, `ROLE_CATEGORY_SCOPE`); the category check happens in the service once the incident is loaded.
- Rate limits are constants in `rate-limit/rate-limits.ts`. Changing one is a reviewed decision recorded in ADR-0012.

## Events and logging

- A change to an incident and its event row are written in one transaction (outbox). `EventsGateway` only listens
  (`@OnEvent`); it never writes or computes.
- Telemetry is a separate, best-effort path with its own namespace. Do not mix it with the outbox.
- Log with Nest's `Logger`; never log tokens, passwords, emails or display names. A new secret goes into
  `logging/redaction.ts` with a case in `redaction.spec.ts`.
- Cross-replica work (migrations, seed, simulator leader) takes a lock from `database/advisory-locks.ts`.
