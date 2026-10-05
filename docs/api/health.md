# Health

Two operational probes ([ADR-0013](../adr/0013-liveness-and-readiness-probes.md)). They are not
part of the public API contract: they are excluded from the OpenAPI spec
(`@ApiExcludeController()`) and from Swagger UI. Both are public (no token), never rate-limited (no
`X-RateLimit-*` headers), and left out of the request log and the HTTP metrics.

### Liveness

<!-- steel:endpoint GET /api/health/live | returns: HealthCheckResult | auth: none -->

`GET /api/health/live` · Status: current

Is this process serving HTTP? It never checks a dependency: a failed liveness probe restarts the
container, and restarting every replica at once fixes no database outage. Used by the Docker
`HEALTHCHECK`.

**200** — `{ "status": "ok", "info": {}, "error": {}, "details": {} }`, also while the database is
down.

Source: `apps/api/src/health/health.controller.ts:43`

### Readiness

<!-- steel:endpoint GET /api/health/ready | returns: HealthCheckResult | auth: none -->

`GET /api/health/ready` · Status: current

Can this replica serve traffic now? It needs the database (a ping that gives up after 1.5 s) and
this replica's own `LISTEN` connection, without which consoles connected here miss live events
([ADR-0008](../adr/0008-multi-replica-fan-out.md)). Keycloak is left out on purpose
([ADR-0010](../adr/0010-oidc-authentication.md)).

**200** — `{ "status": "ok", "info": { "database": { "status": "up" }, "outbox_listener": { "status": "up" } }, "error": {}, "details": { … } }`
**503** — `ApiError` naming every failed check, without driver details: `Not ready: database`,
`Not ready: outbox_listener`, `Not ready: database, outbox_listener`, or `Not ready: shutting down`
once the process has begun to stop.

After a database outage, `LISTEN` reconnects with a 1–15 s backoff, so readiness can stay `503` for
up to about 15 s after the database is back.

Source: `apps/api/src/health/health.controller.ts:53`
