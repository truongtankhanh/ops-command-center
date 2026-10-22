# ADR-0024: A shift handover is its own record, acceptance by the incoming operator is enough, and the console polls for it

- **Status:** Accepted 2026-10-22
- **Date:** 2026-10-22
- **Context documents:** [Console V3 design brief](../design/v3/brief.md) (§ V3.5, "Shift handover"),
  [ADR-0007](0007-transactional-outbox.md), [ADR-0009](0009-idempotent-incident-creation.md),
  [ADR-0011](0011-role-based-authorization-and-timeline-actor.md), [ADR-0012](0012-rate-limiting.md),
  [ADR-0021](0021-incident-categories-zone-uses-and-technician-role.md)

## Context

The console's operator works a 12-hour night shift and hands open work to the next one by voice. The product keeps no record of
that: an incident's timeline says who acknowledged what, not what the outgoing operator wants the next one to know, and nothing says
the next operator took it over. Practice in control rooms is to write the handover for the incoming person, carry open items forward
automatically, and have the incoming person accept it.

Two decisions need a record before code: a new table with two new permissions (the first since ADR-0021), and how a handover reaches
the console when it is not an incident event.

Constraints:

- **Incidents must all arrive** through the outbox (ADR-0007, ADR-0008); a handover is not an incident change and must not ride it.
- **`Idempotency-Key`** (ADR-0009) is typed to incident creation (`incident_id`, an `IncidentDetail` response body); it does not fit a
  second kind of create without rework.
- **One permission model** for REST and sockets, enforced by the API (ADR-0011); a viewer reads incidents and nothing else about how
  the control room works.
- **Rate limits** have one home, `rate-limit/rate-limits.ts`, and changing one is a reviewed decision recorded in ADR-0012.
- **Rolling deploys:** older consoles meet newer APIs and the reverse.

## Options

**The guard against a duplicate create**

1. **The `Idempotency-Key` header and its table, as incidents do.** Rejected: the table's rows and response body are an incident's;
   reusing it means a second response type in it, a change to a table every incident create depends on.
2. **A partial unique index: at most one unaccepted handover per outgoing user (chosen).** A retry after a lost response finds the
   pending one and the service returns it; the data is the guard.
3. **No guard.** Rejected: a retry would write two handovers, and the incoming operator would be asked to accept the same thing twice.

**How the console learns of a handover**

4. **A new event on the outbox and the `/events` namespace.** Rejected: a handover is rare (a few a day), it is not an incident
   change, and a new kind would cross every replica and every console for no benefit.
5. **The console polls `GET /api/handovers/latest` (chosen).** The cost is a delay of up to one poll period before the banner, which
   a human handover tolerates. If a push is wanted later it is a new ADR.

**Approval**

6. **A supervisor must approve every handover.** Rejected for V3.5: it adds a state and a role gate to a record whose point is
   continuity, and the brief's answer to question 16 is that the incoming operator's acceptance is enough.
7. **The incoming operator's acceptance is enough (chosen).**

## Decision

**1. The record.** `shift_handover`: `id`; the outgoing user (`subject` and `display_name` as they were, like an actor, ADR-0011, so
renaming an account later does not rewrite history); the optional incoming user the same way; `notes` (free text, at most 4000
characters); `snapshot`, a JSON list of `{ incidentId, code, status }` of the incidents **unresolved at creation**, filtered by the
creator's category scope (a technician's handover lists Facilities and Environment only); `created_at`; `accepted_at`. The snapshot
holds ids and status, not copies of titles: the incoming operator reads current incidents and sees which have since been resolved.
**A handover changes no incident**: nothing in it acknowledges, resolves or reassigns.

**2. Routes.** `POST /api/handovers` (create), `GET /api/handovers/latest` (the newest, pending or accepted) and
`POST /api/handovers/:id/accept`.

**3. Permissions.** Two are appended to `PERMISSIONS`: `handover:read` and `handover:write`. Operator, supervisor and technician hold
both; **viewer holds neither**, so a viewer's every handover request is `403`. Writing is not category-scoped: the scope applies to the
snapshot's content, not to who may hand over.

**4. Create is guarded by the data.** A partial unique index allows at most one unaccepted handover per outgoing user. A retry, or a
second handover while one is pending, returns the pending one with `200` instead of `201` (decided by the tech lead on 2026-10-22).
Accept is idempotent by state: accepting twice by the same user returns the accepted record; by another user is `409`.

**5. Acceptance.** The incoming user is the caller of `accept`. The outgoing user cannot accept their own handover (`422`, a plain
`DomainError`). **A technician may accept any operator's handover**, including one whose Security items are not theirs to act on: they
read the notes and act only on their own categories (decided on 2026-10-21). Approval is not modelled: the record has no
`approved_by`.

**6. Not an outbox event.** The console polls: a short interval, on focus, and when its sheet is opened.

**7. Rate limit.** One new constant in `rate-limit/rate-limits.ts`, per user and route; ADR-0012 gets an "Amended by" pointer to this
ADR rather than a rewrite.

**8. Retention and logging.** Handovers are kept (the audit is the point); a purge is not designed, and the table grows by a few rows
a day. This is acceptable for the first sites and is revisited when a site reports volume. The notes are free text and may name people:
they are never logged and never a metric label.

**9. Not decided here:** a supervisor approval, a purge, a push, and handing over per zone.

## Consequences

- A new table, two permissions in the contract and in `ROLE_PERMISSIONS`, a new API module, a polling query, a sheet and a banner.
- **The banner can lag by about one poll period.** A human handover tolerates it; the figure (about 60 s, 6 creates or accepts a
  minute) is a starting value, `unverified` until a week of use.
- **The first permissions that gate an internal record from the viewer role.** A viewer sees no entry, no banner and sends no request;
  the API's `403` is the control, hiding is presentation.
- **Rolling deploys.** New console, old API: `GET /handovers/latest` is `404`, which the console reads as "no handover"; the entry stays,
  and a first Hand over that answers `404` says so in words ("Handovers are not available on this server yet."). New API, old console:
  the console never calls the routes. The migration adds a table only.
- **ADR-0009 is not changed.** A future second idempotent create would be the moment to generalise its table; this ADR does not.

## Decided before acceptance

Settled by the tech lead on 2026-10-21 and 2026-10-22: acceptance by the incoming operator is enough (brief Q16); a technician may
accept any operator's handover; viewers have no handover; create twice returns the pending one with `200`; retention as in point 8.
