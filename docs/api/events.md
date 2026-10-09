# Real-time events

Clients connect with Socket.IO to the **`/events` namespace** on the API's origin, using the
WebSocket transport only (`io('/events', { transports: ['websocket'] })`). HTTP long-polling is
refused, because the API runs as several replicas behind a proxy without sticky sessions (see
[ADR-0008](../adr/0008-multi-replica-fan-out.md)). Every replica sends every event, whichever
replica made the change. Every change is recorded in an outbox in the same database transaction and
published from there, so a client never sees a change that was rolled back, and a committed change
is always announced, even if the API restarts in between (see
[ADR-0007](../adr/0007-transactional-outbox.md)).

Delivery is at-least-once: the same event can arrive more than once. While a client is
disconnected it misses events, so after reconnecting, refetch `GET /api/incidents` once to catch up.
The server can also close the connection on purpose, when the replica serving it may have missed
events. Socket.IO reconnects on its own, and the same refetch covers the gap.

Events and REST responses can arrive in any order, so an older copy of an incident may arrive
after a newer one. Compare `version` (see [incidents.md](incidents.md)) and keep the higher one.
The same rule makes duplicates harmless: a repeated event has the same `version` as the copy you
already hold.

Event names and payload types are defined once in `@occ/contracts` (`IncidentEvents`,
`ServerToClientEvents`).

**Authentication.** The namespace accepts only connections that carry an OIDC access token, the
same one the REST API takes ([ADR-0010](../adr/0010-oidc-authentication.md)). Send it in the
handshake's `auth` payload (`EventsHandshakeAuth`), never in the URL, and pass `auth` as a function
so every reconnect sends the current token:
`io('/events', { transports: ['websocket'], auth: (cb) => cb({ token }) })`.

- Any role may connect: `viewer`, `operator`, `supervisor` or `technician`
  ([ADR-0011](../adr/0011-role-based-authorization-and-timeline-actor.md),
  [ADR-0021](../adr/0021-incident-categories-zone-uses-and-technician-role.md)).
- A refused handshake raises `connect_error` and never connects. Its message is one of
  `EventsConnectErrors`: `Unauthorized` (no token, or one the API does not accept — sign in again),
  `Identity provider unavailable` (the API cannot check tokens right now — retry later), or
  `Forbidden` (the token has none of those roles — signing in again as the same user will not
  help).
- The roles are those of the handshake token until the connection closes at its expiry, so a role
  removed during a session stops the live feed at the next reconnect.
- When the token expires, the server closes the connection. Socket.IO reconnects on its own with
  the current token, and the same refetch covers anything missed in between.

### Incident created

<!-- steel:endpoint EVENT /events incident.created | payload: Incident | auth: bearer (handshake) -->

`incident.created` · Status: current

Sent to every connected client when an incident is reported, by an operator or by the simulator.

Payload: `Incident` (see [incidents.md](incidents.md)).

Source: `apps/api/src/realtime/events.gateway.ts:93`

### Incident updated

<!-- steel:endpoint EVENT /events incident.updated | payload: Incident | auth: bearer (handshake) -->

`incident.updated` · Status: current

Sent after an incident is acknowledged or resolved. The payload is the whole incident, not a
diff — replace the cached copy by `id` only if the payload's `version` is higher.

Payload: `Incident`.

Source: `apps/api/src/realtime/events.gateway.ts:98`
