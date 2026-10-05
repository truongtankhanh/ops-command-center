# ADR-0015: Prometheus metrics, scrape exposure, and tracing deferred

- **Status:** Accepted
- **Date:** 2026-10-05
- **Amends:** [ADR-0012](0012-rate-limiting.md) (throttling becomes visible in metrics), [ADR-0013](0013-liveness-and-readiness-probes.md) (probes stay out of the HTTP metrics)

## Context

The API had no metrics and no tracing (IMP-14, roadmap OCC-24). `docs/architecture.md` sets the goal "a new incident reaches every open console in under a second", and nothing measured it. `429`s showed only in access logs (ADR-0012). Logs already carry one correlation ID from the HTTP request through the outbox to the broadcast on every replica (ADR-0014).

Constraints that shaped the design:

- **The console's nginx proxies all of `/api/`** to the API, and every route is behind the global `AuthGuard` (ADR-0010). A Prometheus scraper has no OIDC token.
- **Several replicas** behind round-robin nginx (ADR-0008). A scrape through the proxy would see one replica at random.
- **The e2e suite boots several apps in one Jest process.** A metric registered twice on one registry throws.
- **Staging is production's image** (`NODE_ENV=production`, ADR-0006 §5). The environment label is `DEPLOYMENT_ENV` (ADR-0014).
- **No deploy target and no telemetry vendor yet** (ADR-0006, ADR-0014).

## Decision

### 1. Library: `@prometheus-io/client`

The Prometheus project's Node.js client, used directly with a small `MetricsModule`, and no Nest wrapper. It is the same codebase as `prom-client`, which npm marked deprecated on 2026-08-25 in favour of this package. It requires Node ≥ 22.

Considered:

- **`prom-client` 15.x.** Deprecated, so no further fixes.
- **`@willsoto/nestjs-prometheus`.** A wrapper on top of the same client. Its default is a controller route on the main app, which is the exposure problem in §3.

### 2. One registry per app, owned by Nest

`MetricsModule` (global) provides a `Registry` instance as a DI token, and every metric is registered on it. The library's global `register` is never used. This keeps e2e apps independent, and it means metrics are created in one place (`src/metrics/`), not ad hoc in services.

Every series carries `service="occ-api"` and `env=<DEPLOYMENT_ENV>`: the same names and values as the log fields, from the same constant and variable. A metric spike and its log lines filter alike. Prometheus adds `instance`, the replica's address. The logs carry `hostname`.

### 3. Exposure: a separate port, never behind nginx

`GET /metrics` is served by a plain `node:http` listener on `METRICS_PORT` (default `9464`), not by the Express app.

- No `/api` route exists for nginx to proxy, and none of the global guards, the request log or the HTTP metrics apply to the scrape.
- **Access is the network's job.** Compose publishes no host port for it. Prometheus reaches each replica over the Compose network. A real deployment must keep the port on an internal network in the same way.
- `main.ts` starts it after the API listens. `configureApp` does not, so e2e apps never bind it. It closes on shutdown with the app.
- `METRICS_PORT` must differ from `PORT`. Boot fails otherwise.
- CI asserts that `/api/metrics` through nginx is `404`, that `9464` is not published, and that each replica serves metrics.

Considered:

- **A route on the main app, `@Public()`, blocked in nginx.** One proxy edit, or a deployment without this nginx, makes it public.
- **A route protected by a static token.** A second secret next to `DATABASE_URL`, which ADR-0006 keeps as the only one.

### 4. HTTP RED metrics

An Express middleware, mounted in `configureApp` right after the correlation ID middleware, records `http_requests_total` and `http_request_duration_seconds` by `method`, `route` and `status_code` when the response finishes.

- It is a middleware, not an interceptor, so `401`/`403`/`429` from the guards and `404`s are counted too.
- The error rate is `status_code=~"5.."` at query time. There is no separate counter that could drift.
- Duration buckets run from 5 ms to 15 s. The top bucket is `statement_timeout`.
- `/api/health/live` and `/api/health/ready` are left out, using the same path list as the request log (ADR-0013). `/metrics` needs no rule because it never reaches Express. A request whose client disconnects before the response finishes is not recorded.

### 5. Labels are bounded, always

- `route` is the matched template (`/api/incidents/:id`), or `unmatched` when no route matched. It is never the raw path.
- `status_code` is the exact code. The set is bounded by what the API answers, and `401`, `403`, `409` and `429` need to be told apart. `method` is bounded by Node's HTTP parser.
- Incident, outbox, request, socket and user IDs are never labels. Logs carry those.

### 6. Real-time delivery metrics

- **`incident_event_delivery_seconds{event}`** is a histogram observed on every replica when `OutboxListener` has emitted a row to the gateway: the time since the row's `created_at`. Its buckets sit around the 1 s goal (10 ms to 10 s). It has two caveats:
  - `created_at` is the writing transaction's start, so the figure includes the rest of that transaction.
  - It compares the database clock with the API's. Skew between hosts adds error, and a negative value is recorded as 0.
- **`realtime_connected_consoles`** is a gauge read from the namespace's socket count at scrape time. There is no counting up and down, so a missed disconnect cannot skew it.
- Default process metrics (event-loop lag, heap, GC, handles, CPU) come from the library's collectors.

### 7. Compose observability profile

`docker compose --profile observability up --build` adds:

- **Prometheus.** It discovers every `api` replica through Docker's DNS. There is no host port and no volume.
- **Grafana.** It runs on `127.0.0.1:13001` (`GRAFANA_PORT`), with anonymous read-only access and a demo admin password. It has a provisioned "OCC API" dashboard: delivery latency against the 1 s goal, connected consoles, HTTP RED and process metrics. Its `env` variable takes one value at a time, so staging and production never share a panel. The dashboard is a file in `ops/grafana/dashboards`, and the UI cannot change it.

### 8. Tracing: not now

No tracing SDK or APM agent is added. `requestId` already joins one change across HTTP, the outbox, every replica and the broadcast. There is no trace backend to send spans to. OpenTelemetry would bring a preload in the image's `CMD`, about ten production dependencies, and manual context propagation through the outbox and `NOTIFY`. That is a change of its own (IMP-21).

Recorded now, so the follow-up starts from it:

- **Stack:** OpenTelemetry SDK with an OTLP exporter. The backend is chosen when a deploy target exists.
- **Sampling per `DEPLOYMENT_ENV`:**

  | `DEPLOYMENT_ENV` | Sampling                                                      |
  | ---------------- | ------------------------------------------------------------- |
  | `local`          | 100%, or SDK off when noisy                                   |
  | `test`           | off                                                           |
  | `demo`           | 100%                                                          |
  | `staging`        | 100%                                                          |
  | `production`     | `parentbased_traceidratio`, 10% to start, revisited by volume |

- **Correlation:**
  - `requestId` stays the one ID people quote, and the one nginx and `outbox.request_id` carry.
  - Logs gain `traceId`/`spanId` next to it.
  - The root span carries `requestId` as an attribute. The trace ID does not replace it.
- Spans get `service.name=occ-api` and `deployment.environment=<DEPLOYMENT_ENV>`.

### Not decided here

- **Alert rules and SLOs.** The delivery histogram is the candidate SLI. Alerting needs a deploy target (IMP-22).
- **Metrics for background jobs, the database pool, Keycloak's JWKS fetches and the probes.** These are listed in IMP-22.

## Consequences

- One new production dependency (`@prometheus-io/client`, with `@opentelemetry/api` and `tdigest`).
- Every replica listens on a second port, `9464`. A deployment must keep it off the public network.
- `METRICS_PORT` is a new, optional variable. Boot fails if it equals `PORT`.
- `429`s, `401`s and `404`s become visible per route (ADR-0012's "no throttling metrics").
- `realtime_connected_consoles` is per replica. The dashboard sums it.
- **Revisit** when:
  - a deploy target exists: network policy for `9464`, remote storage, alert rules, tracing (IMP-21);
  - route count or traffic grows enough for label cardinality or scrape size to matter;
  - delivery latency is needed across hosts with real clock skew: measure from a commit timestamp written by the API, or from tracing.
