# ADR-0003: Domain events in-process, broadcast with Socket.IO

- **Status:** Accepted, delivery amended by [ADR-0007](0007-transactional-outbox.md)
- **Date:** 2026-10-01

> **Amended 2026-10-02 by ADR-0007.** Events are no longer emitted directly after commit. They are written to an outbox in the same transaction and published by a relay, so delivery is at-least-once instead of at-most-once. The in-process event bus, the gateway as a pure listener, and the contracts below still stand.

## Context

Consoles must reflect incident changes within a second. Changes come from several places: operators (REST), the simulator, and later sensor integrations. The code that changes an incident should not have to know who is listening.

## Options

1. **Polling** from the console — simple, but wasteful and slow at the latency we need.
2. **Service calls the WebSocket gateway directly** — works, but couples business logic to transport and makes every new listener a change to the service.
3. **In-process domain events (`@nestjs/event-emitter`) + a Socket.IO gateway as a listener.**
4. **External broker (Redis pub/sub, NATS)** — needed for multiple API instances, unnecessary for a single on-prem node.

## Decision

Option 3. `IncidentsService` emits `incident.created` / `incident.updated` **after** the transaction commits. _(Superseded by ADR-0007: the event is written to the outbox inside the transaction and `OutboxRelay` emits it.)_ `EventsGateway` listens and broadcasts to connected consoles on the `/events` namespace. Event names and payloads are defined once in `packages/contracts`.

Socket.IO over raw WebSocket for automatic reconnection, heartbeats and a clean path to multi-instance scaling via its Redis adapter.

## Consequences

- New consumers (notifications, metrics, audit export) subscribe to the same events without touching the service.
- Consoles patch their local cache from the event payload — no refetch per event.
- ~~Delivery is at-most-once~~ Delivery is at-least-once since ADR-0007, so listeners must tolerate duplicates. On reconnect the console still refetches once to converge.
- Scaling past one API instance requires the Socket.IO Redis adapter (and moving domain events to a broker if listeners must also be distributed). Deferred until there is a need.
