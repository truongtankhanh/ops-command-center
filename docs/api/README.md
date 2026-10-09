# API reference

Generated from the code by `/steel:api-docs-*` and reconciled on every run — see each
endpoint's `Source` line. Machine-readable spec: [`openapi.json`](openapi.json) (OpenAPI 3.0).
The running API also serves interactive docs at `/api/docs` in development; in production they are off
unless `API_DOCS_ENABLED=true`, and then read-only ([ADR-0005](../adr/0005-api-docs-exposure-per-environment.md)).

Last reconciled: 2026-10-06

| Module           | Endpoints | File                         |
| ---------------- | --------- | ---------------------------- |
| Health           | 2         | [health.md](health.md)       |
| Zones            | 1         | [zones.md](zones.md)         |
| Site plan        | 1         | [site-plan.md](site-plan.md) |
| Cameras          | 2         | [cameras.md](cameras.md)     |
| Incidents        | 5         | [incidents.md](incidents.md) |
| Real-time events | 2         | [events.md](events.md)       |

## Conventions that apply to every endpoint

- **Base path** `/api`.
- **Authentication.** Every endpoint except the health probes (`/api/health/live`, `/api/health/ready`)
  needs an OIDC access token from the
  configured issuer, sent as `Authorization: Bearer <token>`
  ([ADR-0010](../adr/0010-oidc-authentication.md)). The `/events` namespace takes the same token in
  its handshake — see [events.md](events.md).
  - **401** — the token is missing, malformed, expired, or not issued for this API. The response
    carries `WWW-Authenticate: Bearer realm="occ"` (with `error="invalid_token"` when a token was
    sent but rejected). Sign in again.
  - **503** `Identity provider unavailable` — the API cannot fetch the issuer's signing keys right
    now, so it cannot check any token. Retry later; signing in again will not help.
  - Authentication runs before validation: a request without a valid token gets **401** even if its
    body is also invalid.
- **Roles.** The token's realm roles decide what the caller may do
  ([ADR-0011](../adr/0011-role-based-authorization-and-timeline-actor.md)). The map is
  `ROLE_PERMISSIONS` in `@occ/contracts`, and `ROLE_CATEGORY_SCOPE` limits acknowledge and
  resolve to the incident categories a role handles
  ([ADR-0021](../adr/0021-incident-categories-zone-uses-and-technician-role.md)):

  | Action                                                    | `viewer` | `operator` | `supervisor` |          `technician`           |
  | --------------------------------------------------------- | :------: | :--------: | :----------: | :-----------------------------: |
  | Read zones, site plan, cameras, stream URLs, incidents    |   yes    |    yes     |     yes      |               yes               |
  | Subscribe to `/events`                                    |   yes    |    yes     |     yes      |               yes               |
  | Report (`incident:report`)                                |    no    |    yes     |     yes      |               yes               |
  | Acknowledge, resolve (`incident:acknowledge`, `:resolve`) |    no    |    yes     |     yes      | Facilities and Environment only |
  - **403** — the token has none of these roles (`No role grants access to this API`), its roles
    lack the permission the endpoint needs (`Missing permission: incident:acknowledge`), or the
    incident's category is outside the role's scope (`Not allowed for this category`). Signing in
    again as the same user will not help.
  - Authorization runs after authentication and before validation: a `viewer` sending an invalid
    body, or an unknown incident id, gets **403**, not **400** or **404**. The category is known
    only once the incident is found, so `Not allowed for this category` comes after **400** and
    **404**, and before **409** (see [incidents.md](incidents.md#order-of-answers)).

- **Validation.** Bodies and query strings are validated; unknown fields are rejected, not
  ignored. A validation failure returns **400** with every problem listed in `message`.
- **Errors** always have this shape:

  ```json
  {
    "statusCode": 404,
    "error": "NOT_FOUND",
    "message": "Incident 7d0c… was not found",
    "path": "/api/incidents/7d0c…",
    "timestamp": "2026-10-01T08:00:00.000Z"
  }
  ```

  `message` is a string, or an array of strings for validation errors. Unexpected failures
  return **500** with the generic message `Internal server error`; details stay in the server log.

- **Positions** are `[longitude, latitude]` (GeoJSON order). Timestamps are ISO 8601 UTC.
- **Ids** are UUIDs; a malformed id in a path returns **400**.
- **422** means the request is well-formed but cannot be applied, e.g. an `Idempotency-Key`
  reused with a different body.
- **Retries.** `POST /api/incidents` accepts an optional `Idempotency-Key` header that makes it
  safe to retry; see [incidents.md](incidents.md#report-an-incident).
- **Rate limits** ([ADR-0012](../adr/0012-rate-limiting.md)). Per signed-in user and per route, in
  fixed one-minute windows counted across every API replica:

  | Route                                                             | Requests per minute |
  | ----------------------------------------------------------------- | ------------------: |
  | `POST /api/incidents`                                             |                  10 |
  | `POST /api/incidents/:id/acknowledge`, `…/resolve` (each its own) |                  30 |
  | `GET /api/cameras/:id/stream`                                     |                 300 |
  | Everything else                                                   |                 120 |

  Limited responses carry `X-RateLimit-Limit` and `X-RateLimit-Remaining`. Over the limit:
  **429** `TOO_MANY_REQUESTS` (`Too many requests. Try again shortly.`) with `Retry-After` in
  seconds. Throttling runs after authentication and roles and before validation: a refused token
  is not counted, an invalid body is. The console's nginx also limits per client address in front
  of the API, and answers with the same body and `Retry-After: 1`.

- **Request ID.** Every response carries `X-Request-Id`: the one the proxy sent, when it matches
  `^[A-Za-z0-9-]{8,64}$`, or a new UUID. Every server log line for that request carries it, so
  quote it when reporting a problem ([ADR-0014](../adr/0014-structured-logging-and-correlation.md)).
  The console's nginx replaces any value a client sends.
