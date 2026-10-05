# Incidents

An incident moves `open → acknowledged → resolved` (or straight from `open` to `resolved`).
Every transition is recorded on the incident's timeline, and every create or change is pushed
to connected clients — see [events.md](events.md).

`Incident` fields: `id`, `code` (`INC-000042`), `type`, `severity`, `status`, `title`,
`description` (nullable), `zoneId`, `position: [lng, lat]`, `source` (`operator` |
`simulator`), `reportedAt`, `acknowledgedAt` (nullable), `resolvedAt` (nullable), `version`.

`version` starts at 1 and goes up by one on every change to the incident. Between two copies of
the same `id`, the one with the higher `version` is newer.

Every timeline entry has an `actor`: who caused it
([ADR-0011](../adr/0011-role-based-authorization-and-timeline-actor.md)).

| `actor` field | Notes                                                                |
| ------------- | -------------------------------------------------------------------- |
| `kind`        | `user` (a signed-in person) or `system` (the API itself)             |
| `subject`     | a user's identity-provider subject; `simulator`, `seed` or `system`¹ |
| `displayName` | the name to show, as it was when the entry was written               |

¹ `system` marks entries recorded before actors existed.

Reading needs any role; reporting, acknowledging and resolving need `operator` or `supervisor`
(see [README](README.md)). Every endpoint below answers **403** to a token without a role.

| Enum       | Values                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------- |
| `type`     | `intrusion`, `fire_alarm`, `equipment_fault`, `medical`, `crowding`, `suspicious_object` |
| `severity` | `low`, `medium`, `high`, `critical`                                                      |
| `status`   | `open`, `acknowledged`, `resolved`                                                       |

### List incidents

<!-- steel:endpoint GET /api/incidents | query: limit?, severity?, status? | returns: Incident[] | auth: bearer -->

`GET /api/incidents` · Status: current

Ordered for an operator: unresolved first, then by severity (most severe first), then newest.

| Query      | Type                 | Notes                                                    |
| ---------- | -------------------- | -------------------------------------------------------- |
| `status`   | `IncidentStatus[]`   | comma-separated or repeated: `?status=open,acknowledged` |
| `severity` | `IncidentSeverity[]` | comma-separated or repeated                              |
| `limit`    | `integer`            | 1–500, default 100                                       |

**200** — `Incident[]`
**400** — unknown enum value or `limit` out of range
**401** — missing or invalid bearer token
**403** — the token has no role

Source: `apps/api/src/incidents/incidents.controller.ts:42`

### Get an incident

<!-- steel:endpoint GET /api/incidents/:id | params: id | returns: IncidentDetail | auth: bearer -->

`GET /api/incidents/:id` · Status: current

One incident with its full timeline, oldest entry first.

**200** — `IncidentDetail` = `Incident` + `timeline: { id, kind, note, at, actor }[]`, where `kind`
is `reported`, `acknowledged` or `resolved`, `note` is the operator's note or `null`, and `actor`
is who caused the entry
**400** — `id` is not a UUID
**401** — missing or invalid bearer token
**403** — the token has no role
**404** — unknown incident

Source: `apps/api/src/incidents/incidents.controller.ts:50`

### Report an incident

<!-- steel:endpoint POST /api/incidents | headers: Idempotency-Key? | body: ReportIncidentDto{description?, position?, severity, title, type, zoneId} | returns: IncidentDetail | auth: bearer, permission: incident:report -->

`POST /api/incidents` · Status: current

Creates an incident in status `open` with `source: operator` and a sequential `code`. The
`reported` entry names the caller as its actor. Broadcasts `incident.created` after the write
commits.

| Header            | Type     | Rules                                                 |
| ----------------- | -------- | ----------------------------------------------------- |
| `Idempotency-Key` | `string` | optional, 1–255 printable ASCII characters, no spaces |

| Body field    | Type               | Rules                                                            |
| ------------- | ------------------ | ---------------------------------------------------------------- |
| `type`        | `IncidentType`     | required                                                         |
| `severity`    | `IncidentSeverity` | required                                                         |
| `title`       | `string`           | required, 1–160 characters                                       |
| `description` | `string`           | optional, ≤ 2000 characters                                      |
| `zoneId`      | `uuid`             | required, must exist                                             |
| `position`    | `[lng, lat]`       | optional, both numbers in range; defaults to the zone's `center` |

**Retries.** Send a new random `Idempotency-Key` (a UUID works) with each submission, and the
same key again on every retry of it. The key is kept for 24 h
([ADR-0009](../adr/0009-idempotent-incident-creation.md)). Keys are per user: the same key sent by
another user is a different key, so it never returns that user's response
([ADR-0010](../adr/0010-oidc-authentication.md)).

- Same key, same body: the original `201` response comes back unchanged, even if the incident has
  changed since. No second incident is created and no second `incident.created` is broadcast.
- Same key, different body: **422**. Body field order and formatting do not count as different.
- A request that failed (`400`, `404`, `500`) stores nothing, so retrying it with the same key runs
  it again.
- Requests with the same key sent at the same time wait for the first one, then get its response.
  If the first one takes longer than 5 s, the waiting request fails with **500** and can simply be
  retried.
- Without the header, every request creates a new incident.

**201** — `IncidentDetail` (timeline has one `reported` entry)
**400** — validation failed, an unknown field was sent, or `Idempotency-Key` is malformed
**401** — missing or invalid bearer token
**403** — the token has no role, or its role cannot report (`viewer`)
**404** — `zoneId` does not exist
**422** — `Idempotency-Key` was already used with a different body

Source: `apps/api/src/incidents/incidents.controller.ts:63`

### Acknowledge an incident

<!-- steel:endpoint POST /api/incidents/:id/acknowledge | params: id | body: TransitionIncidentDto{note?} | returns: IncidentDetail | auth: bearer, permission: incident:acknowledge -->

`POST /api/incidents/:id/acknowledge` · Status: current

Marks an `open` incident as being handled and records the optional note on the timeline, with
the caller as its actor. The incident row is locked during the change, so two operators cannot
both acknowledge it. Broadcasts `incident.updated`.

| Body field | Type     | Rules                       |
| ---------- | -------- | --------------------------- |
| `note`     | `string` | optional, ≤ 1000 characters |

**200** — `IncidentDetail`
**401** — missing or invalid bearer token
**403** — the token has no role, or its role cannot acknowledge (`viewer`)
**404** — unknown incident
**409** — the incident is not `open`

Source: `apps/api/src/incidents/incidents.controller.ts:95`

### Resolve an incident

<!-- steel:endpoint POST /api/incidents/:id/resolve | params: id | body: TransitionIncidentDto{note?} | returns: IncidentDetail | auth: bearer, permission: incident:resolve -->

`POST /api/incidents/:id/resolve` · Status: current

Closes an `open` or `acknowledged` incident, with an optional resolution note and the caller as
the entry's actor. Broadcasts `incident.updated`.

| Body field | Type     | Rules                       |
| ---------- | -------- | --------------------------- |
| `note`     | `string` | optional, ≤ 1000 characters |

**200** — `IncidentDetail`
**401** — missing or invalid bearer token
**403** — the token has no role, or its role cannot resolve (`viewer`)
**404** — unknown incident
**409** — the incident is already `resolved`

Source: `apps/api/src/incidents/incidents.controller.ts:112`
