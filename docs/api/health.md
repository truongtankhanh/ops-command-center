# Health

### Check health

<!-- steel:endpoint GET /api/health | returns: {database, status} | auth: none -->

`GET /api/health` · Status: current

Liveness plus a database round-trip (`SELECT 1`). Used by the Docker health check.

**200** — `{ "status": "ok", "database": "up" }`
**503** — the database is unreachable (`ApiError`, message `Database unreachable`)

Source: `apps/api/src/health/health.controller.ts:11`
