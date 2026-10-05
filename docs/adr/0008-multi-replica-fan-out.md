# ADR-0008: Several API replicas, events fanned out through Postgres

- **Status:** Accepted
- **Date:** 2026-10-03
- **Amends:** [ADR-0007](0007-transactional-outbox.md) (who emits the published events; the outbox and the relay stay)

## Context

A Socket.IO gateway reaches only the consoles connected to its own process. Under ADR-0007 each API process runs an `OutboxRelay`, and the relays share the `outbox` table with `SKIP LOCKED`, so each event was emitted by exactly one replica. With `docker compose up --scale api=2`, a console on replica B missed every change that replica A happened to publish.

Running more than one replica broke three other things too:

- Every replica with `SIMULATOR_ENABLED` ran its own simulator, doubling the traffic and its `MAX_ACTIVE` limit.
- Replicas booting together on an empty database both ran migrations (TypeORM's `migrationsRun` takes no lock) and both tried to seed. One of them crashed.
- The `api` service published a fixed host port, so a second replica could not start at all.

The constraint from ADR-0007 still holds: no new infrastructure. The target is an on-prem host with PostgreSQL.

## Options

1. **Stay single-replica.** Simplest. Leaves no room for a rolling restart or a second instance, and the limit was not documented.
2. **`@socket.io/postgres-adapter`.** The gateway's `server.emit` crosses replicas, and the relay stays as it was. It adds a dependency, its own table, migration and heartbeat, and a custom `IoAdapter`. It loses messages while its LISTEN connection is down, the same gap as option 4. It also makes Socket.IO itself depend on Postgres.
3. **Relay `NOTIFY` with the full payload.** One round trip less per event, but a `NOTIFY` payload is capped at 8000 bytes. An incident with a long description in a multi-byte script exceeds it. The `pg_notify` then fails the relay's transaction, and that batch, with everything behind it, stays pending forever.
4. **Relay `NOTIFY` with outbox ids; every replica listens and reads the rows.** No dependency, and the payload size is bounded (100 ids ≈ 2 KB).
5. **Redis (Socket.IO Redis adapter or pub/sub).** The usual answer elsewhere. It is a new service to run and secure on-prem, and it still needs the outbox for durability.

## Decision

Option 4, with the changes needed for replicas to coexist.

- **Fan-out.**
  - `OutboxRelay` claims a batch exactly as before, then runs `pg_notify('outbox_published', '["101","102"]')` and marks the rows published, all in one transaction. Postgres delivers the notification only when that transaction commits, in commit order. If it rolls back, nothing is delivered and the rows stay pending.
  - Every replica, the writer included, runs an `OutboxListener` on a dedicated connection. It reads the notified rows by id in `id` order, one batch at a time, and emits them on its own in-process bus. `EventsGateway` is unchanged and still only listens (ADR-0003).
  - The listener validates the payload, because any database role can `NOTIFY`. A failing bus listener is logged and skipped, as in ADR-0007.
- **Resync after a lost LISTEN connection.** The listener reconnects with backoff: 1 s, doubling, capped at 15 s. Once `LISTEN` is back, it emits `outbox.resynced`, and the gateway closes the engine connection of every console on that replica (`socket.conn.close()`, not `disconnect()`, after which socket.io-client would not retry). Consoles reconnect and run the refetch they already do on reconnect. The first `LISTEN` happens during bootstrap, before `app.listen()`, so no console connects to a replica that cannot yet receive events.
- **One simulator.** `SimulatorLeader` holds a session-level advisory lock on its own connection, opened only on replicas with the simulator on.
  - The leader runs `SELECT 1` on that connection before each tick. A live session still holds its lock.
  - A non-leader retries every interval, so it takes over within one interval of the leader's process dying.
  - A leader whose check fails closes its session instead of returning it to the pool, so a stranded lock cannot block every replica.
- **Serialised boot.**
  - Migrations run in `TypeOrmModule`'s `dataSourceFactory` through `runMigrationsOnBoot`, under a session advisory lock. Waiting is capped at 60 s, then boot fails with a clear message. A replica that waited finds nothing pending.
  - The seed takes a transaction advisory lock and repeats its "is the database empty" check inside it.
  - All lock keys live in `src/database/advisory-locks.ts`.
- **Transport.** The `/events` namespace accepts WebSocket only (`transports: ['websocket']`). Long-polling needs every request of a session to reach the same replica. WebSocket-only lets nginx round-robin with no sticky sessions.
- **Compose and nginx.**
  - The `api` service has no host port; the API and its docs are reached through the console on `:18080`.
  - nginx's upstream re-resolves `api` through Docker DNS (`server api:3000 resolve`), so it follows replicas as they come and go.
  - `docker compose up --build --scale api=2` is the documented demo.

## Consequences

- **Delivery.**
  - Every committed change is still announced, and still at-least-once from the outbox's point of view. A batch is announced again only if its commit failed, and then nothing was delivered the first time, so duplicates are now rarer than under ADR-0007.
  - Listeners now run after the commit, outside the relay's transaction. The "listeners must be synchronous and cheap" constraint of ADR-0007 no longer applies to the relay.
  - Clients still keep the higher `version`, and nothing changes for them.
- **A per-replica gap.** While one replica's LISTEN connection is down, its consoles miss notifications: per replica, delivery is at-most-once during that window. The outbox rows are safe, and the resync refetch repairs the consoles once the connection is back. Consoles on other replicas are unaffected. `GET /api/health/ready` reports the listener's state, so a replica whose connection is down is not ready (ADR-0013).
- **Cost.**
  - One primary-key read of up to 100 rows per batch on each replica.
  - Up to two pool connections per replica held for the process's lifetime (listener, simulator leader), out of 10.
  - Two replicas plus a CLI run and admin stay around 35 of PostgreSQL's default 100 connections.
- **No long-polling fallback.** A client behind a proxy that blocks WebSocket cannot connect. Both clients in this repo already use WebSocket only.
- **Boot.**
  - `@nestjs/typeorm` retries a failing data source factory (9 attempts, 3 s apart, by default). A migration lock held by a stuck process could delay a failed boot by about ten minutes before it gives up. Setting `retryAttempts` is a separate decision.
  - The seed lock waits under the session's 5 s `lock_timeout`, far longer than seeding takes.
- **The CLI takes no lock.** `pnpm migration:run` does not use `runMigrationsOnBoot`. Do not run it while replicas are booting.
- **Proving it.** The e2e suite starts a second application instance on the same database. A client connected to instance B must receive, exactly once, an event produced through instance A. The only path between them is Postgres, because each instance has its own bus, relay and listener. It also checks that exactly one instance leads the simulator. The README has the manual check for the Compose stack.
- **Rollback.** Revert the code. There is no schema change, and the `outbox` table is used as ADR-0007 left it. Rows published while the new code ran stay published.
- Revisit if a broker is introduced for other reasons, if replicas move across hosts where Docker DNS no longer applies, or if event volume makes one `NOTIFY` per batch and a read per replica a bottleneck.
