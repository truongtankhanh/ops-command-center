# ADR-0007: Transactional outbox for incident events

- **Status:** Accepted
- **Date:** 2026-10-02
- **Amends:** [ADR-0003](0003-realtime-domain-events-socketio.md) (how events are delivered; the in-process bus and the Socket.IO gateway stay)

## Context

ADR-0003 has `IncidentsService` commit the transaction, then emit `incident.created` / `incident.updated` in the same process. Between the commit and the emit there is a window: if the process dies there (crash, OOM kill, deploy), the change is in the database but no event is ever sent. Open consoles stay wrong, silently, until they reconnect and refetch. ADR-0003 accepted this as at-most-once delivery.

For a security operations console, "the incident was resolved but my screen still says open" is the failure that matters most. The fix must not need new infrastructure: the target is a single on-prem host with PostgreSQL (ADR-0004).

## Options

1. **Keep the in-process emit after commit.** Simplest. Keeps the lost-event window.
2. **Transactional outbox.** Write the event to an `outbox` table in the same transaction as the change; a relay publishes committed rows and marks them published.
3. **Redis Streams (or another broker) as the event log.** Durable and fast, but the publish is still a second write after the commit (the same window, moved), and it adds a service to run on-prem.
4. **Postgres `LISTEN/NOTIFY` only.** No new infrastructure, but a notification sent while no listener is connected is lost. It is a wake-up signal, not a durable log.
5. **Change data capture (Debezium on the WAL).** Durable, with no application code on the write path, but it needs Kafka Connect or Debezium Server, which is far heavier than this system.

## Decision

Option 2.

- **Write path.** `persistIncident(manager, incident, outboxEvent)` inserts one `outbox` row (`event` = the `IncidentEvents` name, `payload` = the `Incident` with its new `version`) in the caller's transaction. The change and its event commit or roll back together. `IncidentsService` passes `outboxEvent` for report, acknowledge and resolve. The boot-time seed does not: nobody is listening while it runs, and consoles load their data by fetching.
- **Relay.** `OutboxRelay` (one per API process) claims up to 100 pending rows in `id` order with `SELECT … FOR UPDATE SKIP LOCKED`, emits each on the in-process bus (so `EventsGateway` is unchanged), sets `published_at`, and commits, until a batch comes back short. It runs:
  - right after each write commits (`IncidentsService` nudges it in-process), so normal latency stays in milliseconds;
  - every second, for rows nobody nudged (written by a process that died, or by another instance);
  - once at boot.
- **A failing listener does not block the queue.** If a listener throws, the error is logged and the row still counts as published. Retrying instead would let one permanently failing listener stop every later event for every console. The outbox guarantees hand-off to the in-process bus, not that every listener succeeded.
- **Retention.** Published rows are kept for 24 hours (enough to answer "was this published, and when?") and deleted hourly by the relay. Pending rows are never deleted.
- **Constants, not configuration.** Poll interval, batch size and retention are constants in `outbox-relay.service.ts`. They can move into `Env` when a deploy needs to tune them.

## Consequences

- **Delivery is at-least-once.** A crash after emitting and before committing republishes the batch. Every listener must tolerate duplicates. The console does: it keeps the copy with the higher `version` (IMP-05), so a repeated `incident.updated` is a no-op. A repeated `incident.created` re-triggers the "new" highlight, which is cosmetic.
- **Order is guaranteed only within one batch.** Rows from concurrent transactions can become visible out of `id` order, and with several instances `SKIP LOCKED` lets batches publish in parallel. Clients must order by `version`, not by arrival. They already do.
- **A committed change is always announced.** After a crash, the next process publishes the leftover rows at boot or within one poll interval.
- **Proving it.** The e2e suite inserts a pending row directly, with no nudge, and expects it to be broadcast with `published_at` set. After a restart the in-memory nudge is gone and only the poll can deliver a committed row. That is exactly the state the test creates, without timing a real kill.
- **Cost.** One extra `INSERT` per write. When idle, one short transaction per second per instance, served by the partial index on pending rows. The table stays small because of retention.
- **A new event name needs a migration.** The `event` column has a `CHECK` that lists the allowed names.
- **What comes next.** IMP-07 (several API replicas) builds cross-replica fan-out on the relay. IMP-13 can carry a correlation ID in the payload. IMP-14 can measure commit → broadcast latency at publish time.
- Revisit if a broker is introduced for other reasons, or if event volume makes polling or a single table a bottleneck.
