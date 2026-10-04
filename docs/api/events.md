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

### Incident created

<!-- steel:endpoint EVENT /events incident.created | payload: Incident | auth: none -->

`incident.created` · Status: current

Sent to every connected client when an incident is reported, by an operator or by the simulator.

Payload: `Incident` (see [incidents.md](incidents.md)).

Source: `apps/api/src/realtime/events.gateway.ts:40`

### Incident updated

<!-- steel:endpoint EVENT /events incident.updated | payload: Incident | auth: none -->

`incident.updated` · Status: current

Sent after an incident is acknowledged or resolved. The payload is the whole incident, not a
diff — replace the cached copy by `id` only if the payload's `version` is higher.

Payload: `Incident`.

Source: `apps/api/src/realtime/events.gateway.ts:45`
