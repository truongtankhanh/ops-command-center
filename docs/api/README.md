# API reference

Generated from the code by `/steel:api-docs-*` and reconciled on every run — see each
endpoint's `Source` line. Machine-readable spec: [`openapi.json`](openapi.json) (OpenAPI 3.1).
The running API also serves interactive docs at `/api/docs` in development; in production they are off
unless `API_DOCS_ENABLED=true`, and then read-only ([ADR-0005](../adr/0005-api-docs-exposure-per-environment.md)).

Last reconciled: 2026-10-04

| Module           | Endpoints | File                         |
| ---------------- | --------- | ---------------------------- |
| Health           | 1         | [health.md](health.md)       |
| Zones            | 1         | [zones.md](zones.md)         |
| Cameras          | 2         | [cameras.md](cameras.md)     |
| Incidents        | 5         | [incidents.md](incidents.md) |
| Real-time events | 2         | [events.md](events.md)       |

## Conventions that apply to every endpoint

- **Base path** `/api`. No authentication yet (planned in OCC-21).
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
