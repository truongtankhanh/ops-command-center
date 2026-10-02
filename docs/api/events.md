# Real-time events

Clients connect with Socket.IO to the **`/events` namespace** on the API's origin
(`io('/events')`). Events are sent after the database transaction commits, so a client never
sees a change that was rolled back. Delivery is at-most-once: after reconnecting, refetch
`GET /api/incidents` once to catch up.

Events and REST responses can arrive in any order, so an older copy of an incident may arrive
after a newer one. Compare `version` (see [incidents.md](incidents.md)) and keep the higher one.

Event names and payload types are defined once in `@occ/contracts` (`IncidentEvents`,
`ServerToClientEvents`).

### Incident created

<!-- steel:endpoint EVENT /events incident.created | payload: Incident | auth: none -->

`incident.created` · Status: current

Sent to every connected client when an incident is reported, by an operator or by the simulator.

Payload: `Incident` (see [incidents.md](incidents.md)).

Source: `apps/api/src/realtime/events.gateway.ts:37`

### Incident updated

<!-- steel:endpoint EVENT /events incident.updated | payload: Incident | auth: none -->

`incident.updated` · Status: current

Sent after an incident is acknowledged or resolved. The payload is the whole incident, not a
diff — replace the cached copy by `id` only if the payload's `version` is higher.

Payload: `Incident`.

Source: `apps/api/src/realtime/events.gateway.ts:42`
