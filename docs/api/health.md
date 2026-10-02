# Health

### Check health

<!-- steel:endpoint GET /api/health | returns: {database, status} | auth: none -->

`GET /api/health` · Status: current

Liveness plus a database round-trip (`SELECT 1`). Used by the Docker health check.

Operational probe, not part of the public API contract: it is excluded from the OpenAPI spec
(`@ApiExcludeController()`) and from Swagger UI.

**200** — `{ "status": "ok", "database": "up" }`
**503** — the database is unreachable (`ApiError`, message `Database unreachable`)

Source: `apps/api/src/health/health.controller.ts:12`
