# ADR-0003: Domain events in-process, broadcast with Socket.IO

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

Consoles must reflect incident changes within a second. Changes come from several places: operators (REST), the simulator, and later sensor integrations. The code that changes an incident should not have to know who is listening.

## Options

1. **Polling** from the console — simple, but wasteful and slow at the latency we need.
2. **Service calls the WebSocket gateway directly** — works, but couples business logic to transport and makes every new listener a change to the service.
3. **In-process domain events (`@nestjs/event-emitter`) + a Socket.IO gateway as a listener.**
4. **External broker (Redis pub/sub, NATS)** — needed for multiple API instances, unnecessary for a single on-prem node.

## Decision

Option 3. `IncidentsService` emits `incident.created` / `incident.updated` **after** the transaction commits. `EventsGateway` listens and broadcasts to connected consoles on the `/events` namespace. Event names and payloads are defined once in `packages/contracts`.

Socket.IO over raw WebSocket for automatic reconnection, heartbeats and a clean path to multi-instance scaling via its Redis adapter.

## Consequences

- New consumers (notifications, metrics, audit export) subscribe to the same events without touching the service.
- Consoles patch their local cache from the event payload — no refetch per event.
- Delivery is at-most-once; on reconnect the console refetches once to converge.
- Scaling past one API instance requires the Socket.IO Redis adapter (and moving domain events to a broker if listeners must also be distributed). Deferred until there is a need.
