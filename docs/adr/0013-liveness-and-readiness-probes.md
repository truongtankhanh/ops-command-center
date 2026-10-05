# ADR-0013: Separate liveness and readiness probes

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

The API had one probe, `GET /api/health` (IMP-12). It ran `SELECT 1` and answered `503` when PostgreSQL was unreachable. The Docker `HEALTHCHECK`, Compose's `depends_on: service_healthy` and CI all used it.

That one endpoint answered two different questions:

- **Liveness.** Is this process alive? When it fails, the orchestrator restarts the container.
- **Readiness.** Can this replica serve traffic now? When it fails, the replica leaves rotation, without a restart.

Because it checked the database, a database outage failed every replica's probe at once. Plain Compose does not restart unhealthy containers, so nothing happened yet. Under Swarm, an autoheal sidecar or a Kubernetes `livenessProbe` on the same path, the whole fleet would restart at once. That fixes nothing, and adds a cold start to the outage. ADR-0010 had already kept Keycloak out of the probe for this reason.

Six facts shaped the design:

- **Boot order.** Migrations run inside the TypeORM data-source factory, and `OutboxListener` starts its `LISTEN` in `onApplicationBootstrap`. Both finish before `app.listen()`. A process that answers HTTP is already connected, migrated and listening.
- **One `LISTEN` per replica.** While a replica's connection is down, the consoles connected to it miss events, and the other replicas are fine (ADR-0008).
- **Slow boot.** A replica can wait up to 60 s for the migration lock, plus TypeORM's connection retries. The old 20 s start period let such a replica turn unhealthy.
- **Shared pool.** The ping shares the 10-connection pool, which waits up to 5 s for a slot. The Docker probe gives up after 3 s.
- **One health signal per container** in Docker.
- **nginx ignores health.** It round-robins over Docker DNS, which returns unhealthy replicas too. nginx OSS has no active health checks.

## Options

What the Docker `HEALTHCHECK` probes:

1. **Readiness.** It gates boot, but any orchestrator that restarts on health restarts every replica during a database outage.
2. **Liveness.** Safe under any orchestrator. Boot gating still holds, because of the boot order above.

What readiness checks. Each dependency got one question: if it is down, do most requests to this replica fail?

| Dependency            | Answer                                                                                                     | In readiness |
| --------------------- | ---------------------------------------------------------------------------------------------------------- | ------------ |
| PostgreSQL            | Yes: every route and the throttler read it (ADR-0012)                                                      | Yes          |
| This replica's LISTEN | REST works, but its consoles go stale while other replicas are fine: the per-replica case readiness is for | Yes          |
| Keycloak              | Shared by every replica: failing readiness drains the whole fleet; requests that need it answer `503`      | No           |
| MediaMTX              | Not called at runtime; the API only builds URLs                                                            | No           |
| Simulator leadership  | Leadership, not availability                                                                               | No           |

How the probes are built:

1. **Keep the hand-written controller.** It has no per-check timeout, and runs its checks one after another.
2. **`@nestjs/terminus`.** The standard library for this. It provides the PostgreSQL indicator, per-check timeouts and parallel checks, answers `503` on failure, and has a shutdown state.

## Decision

- **Two routes, built on `@nestjs/terminus`** 12 in `HealthModule`. Both are `@Public()`, never throttled (ADR-0012) and kept out of OpenAPI.

  | Route                   | Checks                                                                               | Used by                                                       |
  | ----------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
  | `GET /api/health/live`  | Nothing: it answers while the process serves HTTP                                    | Docker `HEALTHCHECK`; a future `livenessProbe`/`startupProbe` |
  | `GET /api/health/ready` | `database` (`SELECT 1`, 1.5 s timeout), `outbox_listener` (in memory), shutting down | CI's smoke check through nginx; a future `readinessProbe`     |

- **Liveness never checks a dependency**: not the database, not Keycloak, not the listener. Changing that needs a new ADR.
- **`GET /api/health` is removed.** All its consumers were in this repository.
- **No migration check at runtime.** The boot order guarantees it, and the schema cannot go back while the process runs.
- **Timeouts.**
  - The database ping gives up after 1.5 s, half of the Docker probe's 3 s.
  - It also cuts short a wait for a pool slot. A replica whose pool is exhausted cannot serve, so Not Ready is the right answer.
  - The listener check reads memory. Checks run in parallel, so readiness answers within about 1.5 s.
- **Failure body.** `503` with the usual `ApiError`, and `message: "Not ready: database, outbox_listener"`: names only. A driver message can carry an internal address, so it goes to the log only.
- **Success body.** Terminus' `{ status, info, error, details }`. It replaces `{ status: "ok", database: "up" }`: a breaking change for anything that parsed it.
- **Logging.** One `warn` with the reasons when the replica stops being ready, and one `log` when it recovers. Nothing on each probe. Terminus' own logger is off.
- **Shutdown.**
  - On `SIGTERM`, Terminus' `beforeApplicationShutdown` switches every check to `shutting_down` (`503`) before the HTTP server closes.
  - `/live` answers `503` then too. That is harmless: nothing restarts a container that is already stopping.
  - There is no drain delay, because nothing in Compose reads readiness.
- **Docker `HEALTHCHECK`.** It probes `/live` with interval 10 s, timeout 3 s, start period 90 s and 3 retries. A fast boot turns healthy on its first success.
- **Values for an orchestrator.** This repository has no orchestrator manifest. Use these:

  | Probe            | Path     | Period | Timeout | Failure threshold |
  | ---------------- | -------- | ------ | ------- | ----------------- |
  | `startupProbe`   | `/live`  | 10 s   | 3 s     | 12 (2 min)        |
  | `livenessProbe`  | `/live`  | 10 s   | 3 s     | 3                 |
  | `readinessProbe` | `/ready` | 10 s   | 3 s     | 3                 |

## Consequences

- **Outages show on `/ready`, not on container health.** During a database outage, `docker compose ps` stays `healthy`. Watch `/ready` or the API log instead.
- **Readiness has no traffic consumer in Compose.** nginx keeps sending requests and sockets to a replica that is not ready. Readiness only takes effect behind a load balancer or orchestrator that reads it. Teaching nginx belongs with the edge work (IMP-11).
- **Readiness can lag the listener.** After an outage, `LISTEN` reconnects with a backoff of 1 to 15 s. `/ready` can stay `503` for up to about 15 s after the database is back.
- **No drain delay.** A deployment behind a readiness-aware load balancer sets Terminus' `gracefulShutdownTimeoutMs` in `HealthModule` to about the readiness period.
- **Every failing `/ready` call is logged.** `ApiExceptionFilter` logs every `5xx`, so an orchestrator polling a failing `/ready` writes an error on each call. Docker polls `/live`, so Compose stays quiet. Left for structured logging (IMP-13).
- **No probe metrics.** When metrics arrive (IMP-14), keep both routes out of the HTTP RED metrics.
- **Proving it.**
  - `apps/api/src/health/health.controller.spec.ts` checks that:
    - liveness stays up and never pings the database;
    - each failure, including a timeout, answers `503` naming only the check;
    - every failed check is named;
    - shutdown answers `503`;
    - a log is written once per change.
  - The e2e suites check both bodies, and that neither probe is throttled.
  - CI's step "Liveness survives a database outage" stops PostgreSQL. Then, on both replicas, `/live` must succeed and `/ready` must fail.
- **Rollback.** Revert the change as a whole. The Dockerfile and CI change together with the code, because they name the new paths.
- **Revisit** when:
  - an orchestrator or load balancer starts reading readiness: add the drain delay, and consider caching results for under a second;
  - a new dependency arrives: classify it with the question above before adding it to readiness;
  - a circuit breaker arrives: readiness reads its state instead of pinging the dependency itself.
