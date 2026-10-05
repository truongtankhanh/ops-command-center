# ADR-0014: Structured logging, correlation IDs and runtime log level

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

The API logged through Nest's default `ConsoleLogger`, unconfigured (IMP-13, roadmap OCC-23). Every environment wrote coloured text lines, and every level was on, `debug` and `verbose` included, in production too. Four things were missing:

- **Structure.** Text lines cannot be filtered by field in a log aggregator.
- **Correlation.** Nothing tied the log lines of one request together, or the HTTP request that changed an incident to the outbox delivery and the Socket.IO broadcast on every replica (ADR-0007, ADR-0008).
- **Redaction.** Secrets stayed out of the log only because each call site was careful.
- **Level control.** No level policy per environment, and no way to raise verbosity during an incident without a redeploy.

Constraints that shaped the design:

- **Staging is production's image** with `NODE_ENV=production` (ADR-0006 §5). There is no `staging` `NODE_ENV`, and an `APP_ENV` behaviour axis was rejected there.
- **Several replicas** behind nginx (ADR-0008). Anything held in memory reaches one replica only.
- **Configuration is immutable after boot** (ADR-0006 §6).
- **The production image has production dependencies only** (`pnpm deploy --prod`).

## Decision

### 1. Library: `nestjs-pino`

`nestjs-pino` (with `pino` and `pino-http`) is the logger, wired once with `app.useLogger(app.get(Logger))` in `configureApp`, and `bufferLogs: true` in `main.ts`. The existing `new Logger(Class.name)` call sites stay as they are: Nest's `Logger` delegates to pino.

Considered:

- **Nest's `ConsoleLogger` with `json: true` and `NEST_LOG_LEVEL`.** No dependency, but its `redact` covers only structured params, it has no request log, and the level still needs custom code to change across replicas.
- **Winston.** No advantage over pino here.

### 2. Format per environment

- **Everywhere:** one JSON object per line on stdout, with `service`, `env`, `version`, `pid`, `hostname`, ISO `time` and the level as a label.
- **Development only:** `pino-pretty` renders the same objects for people. It is a devDependency and is never loaded outside `NODE_ENV=development`.
- **Destination: synchronous stdout.** An asynchronous destination can lose the last lines before a crash, which are the lines an incident needs. This API's volume is too low for a synchronous write to stdout to add measurable latency. Revisit if stdout back-pressure shows up.
- **TypeORM** logs through Nest's logger, `warn` and migrations only, plus slow queries (over 1 s) as `warn`. Query parameters are never logged. Query errors stay off: callers already handle them, and expected unique violations (ADR-0009) would read as errors.

### 3. Environment tag: `DEPLOYMENT_ENV`

A label only: `local | test | demo | staging | production`. It changes no behaviour, which is why it is not the `APP_ENV` axis ADR-0006 rejected. It is stamped on every line as `env`, so dashboards and alerts never mix staging with production. Defaults: `development → local`, `test → test`. **Production has no default and fails at boot without it**, in line with ADR-0006: a staging deploy that forgot it would otherwise be tagged `production`. The Compose demo sets `demo`.

### 4. Levels

`LOG_LEVEL` (`fatal | error | warn | info | debug | trace`), optional. Defaults: `development → debug`, `test → warn`, `production → info`. Staging gets production's default because it is the same image. Nest's `verbose` is pino's `trace`, off by default everywhere.

### 5. Runtime level control

A single-row table, `log_level_override` (`level`, `expires_at`, `set_by`, `set_at`), is the control plane. Every replica polls it every 15 s. While the row has not expired, the replica runs at that level, and otherwise at its boot level. Each replica logs one `warn` when it applies or drops an override.

The operator CLI changes the row. It uses the same env loading and validation as the TypeORM CLI (`data-source.ts`):

```sh
# development
pnpm --filter @occ/api log-level show
pnpm --filter @occ/api log-level set debug --ttl 30 --by "jane / INC-123"
pnpm --filter @occ/api log-level clear
# a running container (any one replica: all of them read the row)
docker compose exec api node dist/logging/log-level.cli.js set debug --ttl 30 --by "jane / INC-123"
```

The TTL (1 to 240 minutes) makes every bump temporary: a forgotten one reverts itself. Only people who already hold the database credentials or exec access to the API container can change the level. That means on-call engineers, not control-room users. Polling instead of `LISTEN` holds no pool connection, and it recovers by itself after a database outage. The worst-case delay is 15 s.

This is a runtime override of one logging setting, not configuration. `Env` stays immutable after boot (ADR-0006 §6).

Considered:

- **An authenticated `PUT /api/ops/log-level`.** It puts an operational switch on the internet-facing API. The only fitting role is `supervisor`, a control-room role. It would also need a new permission in `@occ/contracts` (ADR-0011).
- **`SIGUSR2` toggling `debug`.** Needs a signal to every container, has no TTL, and records nobody.
- **Boot-time `LOG_LEVEL` only.** Needs a restart.

### 6. Correlation ID: `requestId`

- **Edge.** The console's nginx sets `X-Request-Id: $request_id` on `/api/` and `/socket.io/`, overwriting any client value (as with `X-Forwarded-For`, ADR-0012), and writes it in its access log.
- **API.** A middleware, mounted with `app.use` before everything else, accepts `X-Request-Id` only when it matches `^[A-Za-z0-9-]{8,64}$` and generates a UUID otherwise. It echoes the ID as a response header and runs the request inside an `AsyncLocalStorage` context. Every log line in that context carries `requestId`.
- **Outbox to broadcast.** `outbox.request_id` stores the ID of the request (or job run) that wrote the row. `OutboxListener` emits each row inside that ID's context, so the delivery and broadcast logs on every replica share it. The Socket.IO payload does not change.
- **Background work.** The relay's drain runs outside the caller's context, so a drain triggered by one request does not stamp its ID on other requests' rows. Each timer tick (relay, simulator, cleanups) runs under a fresh ID.
- Raw `AsyncLocalStorage` rather than `nestjs-cls`: one small file, no dependency, and `app.use` makes its middleware run before every module middleware.

### 7. Redaction, the same in every environment

- **Allowlist serializers.** The request log carries `method`, `path` (without the query string), `statusCode`, `responseTime`, `requestId` and `userId`. No headers and no bodies.
- **Path redaction** (`[REDACTED]`) for structured objects: authorization and cookie headers, passwords, secrets, tokens, connection strings, `email` and `displayName`.
- **String scrubbing** of messages and error stacks: credentials in URLs (`scheme://user:password@`), `Bearer` tokens and JWT-shaped strings.
- **User identity.** The IdP `sub` is the only user identifier logs carry, as `userId`. Display names and emails are personal data (ADR-0011) and are redacted.

### 8. Request log

`pino-http` writes one `info` line per request. A `5xx` keeps its single `error` line with the stack in `ApiExceptionFilter`. `/api/health/live` and `/api/health/ready` are not logged (ADR-0013).

### Not decided here

- **A remote error-tracking service.** No vendor and no deploy target yet (ADR-0006). When one is chosen, it takes its environment tag from `DEPLOYMENT_ENV`.
- **Sampling.** None today. Volume is low and the only high-frequency requests, the probes, are not logged.

## Consequences

- **Breaking:** a production deploy must set `DEPLOYMENT_ENV`, or it fails at boot naming the key.
- Two additive migrations: `log_level_override` (new table) and `outbox.request_id` (nullable column).
- Log consumers must parse JSON. Locally, `pino-pretty` keeps the output readable.
- The content of existing log calls (messages, levels, placement) did not change. That is the logging audit's job (`steel-nestjs-logging-audit-*`).
- Socket.IO handshake logs have no `requestId`. There is no HTTP request around them.
- **Revisit** when:
  - a deploy target exists: choose the aggregator and the error tracker, and check that they read `env`;
  - volume grows enough for stdout back-pressure or aggregator cost to matter: consider an async destination and sampling;
  - a dedicated operations role exists: an authenticated endpoint may then replace the CLI.
