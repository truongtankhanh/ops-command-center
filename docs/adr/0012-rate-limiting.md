# ADR-0012: Rate limiting at the edge by IP and in the API by user

- **Status:** Accepted
- **Date:** 2026-10-05
- **Amended by:** [ADR-0015](0015-metrics-and-tracing.md) (`429`s per route in the HTTP metrics); console task UI-15, 2026-10-08
  (§ Clients: loads retry a `429`)

## Context

Nothing limited how often a client could call the API (IMP-11). Each `POST /api/incidents`, `acknowledge` and `resolve` writes a transaction and an outbox row, then fans out to every console on every replica. One buggy or compromised client with a valid `operator` token could flood the database and every screen in the control room. Every request with a bearer token, and every `/events` handshake, also costs an RS256 verification, whether or not the token turns out to be valid.

Four facts shaped the design:

- **Several replicas.** The API runs as several replicas behind round-robin nginx (ADR-0008); CI runs two. A counter kept in one process counts a fraction of a client's traffic.
- **No new infrastructure.** The target is an on-prem host with PostgreSQL, and ADR-0003, ADR-0007 and ADR-0008 each declined a broker or Redis.
- **Every request comes from nginx.** The API trusted no proxy, so `req.ip` was the nginx container for every request. nginx _appended_ to a client-supplied `X-Forwarded-For`, so simply trusting that header would have let any client pick its own address.
- **One address for a whole room.** A control room often reaches the console through one NAT address, so an IP is not a person.

Sign-in, refresh and their brute-force protection belong to Keycloak (`bruteForceProtected: true`). The API has no credential endpoints of its own.

## Options

Where the counters live:

1. **`@nestjs/throttler` with its in-memory storage.** No work, but each replica counts on its own, so the real limit is N × the configured one and changes with `--scale`.
2. **Redis storage.** The usual answer. It is a new service to run and secure on-prem, which ADR-0007 and ADR-0008 declined.
3. **PostgreSQL storage.** Every replica already shares the database. It costs one write per throttled request.
4. **nginx `limit_req` only.** There is one nginx in front of every replica, so its counters are global. But it only knows addresses, and an address is a whole room.

What a counter is keyed on:

- **IP**: the only key before authentication. Unfair behind NAT, and only as good as the proxy trust.
- **Token `sub`**: one person, whatever address they use. Exists only after `AuthGuard`.

## Decision

Two layers, each keyed on what it can trust.

- **Edge (nginx), per IP.** A coarse brake for traffic the API cannot attribute to a user: requests without a valid token, forged tokens and `/events` handshakes.
  - `/api/`: 20 requests/s per address, burst 200.
  - `/socket.io/`: 2 requests/s, burst 30.
  - Sized for a whole room behind one NAT address, every console reconnecting at once after an ADR-0008 resync.
  - `/auth/` is left to Keycloak.
- **API (`@nestjs/throttler`), per user and per route.** The limits that matter for the workload. Every authenticated route counts against `sub:<subject>`; a `@Public()` route would fall back to `ip:<req.ip>`.

  | Route                                 | Limit per user | Why                                                                     |
  | ------------------------------------- | -------------- | ----------------------------------------------------------------------- |
  | `POST /api/incidents`                 | 10 / min       | A write that fans out everywhere; people type incidents one at a time   |
  | `POST /api/incidents/:id/acknowledge` | 30 / min       | Room for a supervisor clearing a queue during a mass event              |
  | `POST /api/incidents/:id/resolve`     | 30 / min       | Same, separate bucket                                                   |
  | `GET /api/cameras/:id/stream`         | 300 / min      | One call per camera opened, so it grows with the camera count           |
  | Any other route                       | 120 / min      | Far above what a person at a console sends                              |
  | `GET /api/health/live`, `/ready`      | none           | A throttled probe would mark a healthy replica down (`@SkipThrottle()`) |

  All values live in `apps/api/src/rate-limit/rate-limits.ts`.

- **Counters in PostgreSQL (option 3).** `PostgresThrottlerStorage` keeps one row per key in the `UNLOGGED` table `throttler_hit`.
  - **One statement per request.** It runs one `INSERT … ON CONFLICT … DO UPDATE … RETURNING`. The row lock serialises concurrent requests for a key.
  - **Database clock.** Times come from `now()`, so replicas with skewed clocks agree.
  - **Cleanup.** `ThrottlerHitCleanup` deletes finished rows every 10 minutes on every replica.
- **Fixed windows.** A window lasts the route's `ttl` and counts every request. The first request over the limit blocks the key until a full `ttl` has passed, and a blocked key's requests are not counted. When the block ends, a new window starts.
  - This is our choice, not the library's default: its in-memory storage expires each hit on its own timer.
  - Writes need a hard cap rather than burst smoothing. At these limits, the worst case at a window edge (about twice the limit within a second) is acceptable.
- **Guard order.** `AuthGuard` (401), then `RolesGuard` (403), then `ThrottlerGuard` (429). All three are registered in `AuthModule`, whose provider list fixes their order. Refused requests never write a counter; nginx bounds them instead.
- **Trust boundary.** nginx is the only place that decides the client address.
  - **nginx side.** It sends `X-Forwarded-For: $remote_addr`, _overwriting_ the header, on `/api/`, `/socket.io/` and `/auth/`.
  - **API side.** The API trusts exactly that one hop (`TRUST_PROXY_HOPS=1`, Express `trust proxy`).
  - **Load balancer in front.** Mount `/etc/nginx/conf.d/real-ip.conf` with `set_real_ip_from <LB CIDR>; real_ip_header X-Forwarded-For; real_ip_recursive on;`. `$remote_addr` then becomes the real client, but only for hops from that CIDR. The API setting stays `1`.
  - **Invariant: only nginx can reach the API port.** Compose publishes no host port for `api` (ADR-0008). A deployment that exposes the API port directly must set `TRUST_PROXY_HOPS=0`.
- **Refused requests.** Both layers answer `429` with the `ApiError` body (`statusCode`, `error: "TOO_MANY_REQUESTS"`, `message`, `path`, `timestamp`) and a `Retry-After` header in seconds.
  - **API 429.** It also sends `X-RateLimit-Limit`, `-Remaining` and `-Reset` on every counted response.
  - **nginx 429.** It sends `Retry-After: 1`, and its `path` keeps only URL-safe characters, so the JSON cannot be broken. nginx leaves the API's own `429`s untouched.
- **Per environment.** Limits and storage are the same everywhere.
  - **`RATE_LIMIT_ENABLED`.** It may be `false` in development and test, where the existing e2e suites send more than a limit's worth as one user. Production refuses `false` even with `DEMO_MODE`, so the Compose demo enforces production's limits.
  - **Edge limits.** They exist only where nginx does: Compose and production.

## Consequences

- **Cost.** One write per throttled request, on an `UNLOGGED` table, which skips the WAL. It shares the pool with the request itself, which needs the database anyway.
- **Database outage: fail closed.** A storage error fails the request with `500`. Every throttled route reads the same database, so the request would fail anyway, and failing open would only hide the cause. The health probes are exempt, and `/api/health/ready` keeps reporting the outage (ADR-0013).
- **Counters are not durable.** An `UNLOGGED` table is emptied after a PostgreSQL crash and is not copied to streaming replicas. A crash or failover resets every counter: a short window with no API limits, while the nginx layer keeps working.
- **Idempotent retries count.** A retry with the same `Idempotency-Key` (ADR-0009) is counted like any request: the guard runs before the key is read. 10 per minute leaves ample room for a person pressing retry.
- **Limits change only with a deploy.** They are code constants, reviewed like any other change. There are no runtime overrides, per-tenant limits or quotas: the product is single-tenant.
- **No throttling metrics.** There is no metrics stack yet. `429`s show only in access logs, so tuning has no traffic data behind it until IMP-13.
- **Gaps that remain.**
  - Rate limiting does not detect slow, distributed abuse; Keycloak's brute-force protection covers sign-in only.
  - IPv6 addresses are counted one by one at the edge, not by prefix. On an on-prem LAN this is unlikely to matter.
  - Under Docker Desktop, every browser on the host reaches nginx from a single gateway address (observed: `192.168.65.1` and `172.21.0.1`), so the edge limit is one bucket for all of them; Docker's userland proxy likely does the same. This stays inside the "whole room behind one NAT address" sizing, but limits are not tuned from such a setup. Whether LAN clients behind `CONSOLE_BIND=0.0.0.0` on Docker Desktop also share it has not been verified.
- **Clients.** The console never retries an action (`POST`) and does not read `Retry-After`; a refused action shows the message, and the operator retries by hand.
  - **Amended 2026-10-08 (UI-15).** A load (`GET`) refused with a `429` is retried three times, after 2, 4 and 8 seconds, while the panel says "Too many requests — retrying in a moment…"; after that it shows the message with a Retry button. Every other 4xx is still never retried. Each refused load adds at most three requests, spread over 14 seconds, so this cannot become a retry storm; a blocked key's requests are not counted (see "Fixed windows"), so the retries do not extend an API block either. A block longer than those 14 seconds ends in the message with Retry. Reading `Retry-After` would match the wait to the server's; not done yet.
- **Proving it.** `apps/api/test/rate-limit.e2e-spec.ts` runs two app instances on one database and checks:
  - the `429` body and headers;
  - one counter across instances;
  - exact counting under concurrency;
  - separate buckets per user and per route;
  - that `X-Forwarded-For` cannot reset a count;
  - that neither health probe is ever throttled;
  - that a `401` writes nothing;
  - that a window can expire.

  The nginx layer is checked against the Compose stack:
  - **In CI.** The `images` job's step "Check nginx rate-limits the edge" bursts `/socket.io/` until nginx answers `429`, and asserts the body has every `ApiError` field with `error: "TOO_MANY_REQUESTS"`.
  - **By hand, the header overwrite.** `docker compose exec console nginx -T 2>/dev/null | grep -E '^\s*proxy_set_header X-Forwarded-For'` prints exactly three lines (`/api/`, `/socket.io/`, `/auth/`), each ending in `$remote_addr;`. Any `$proxy_add_x_forwarded_for` is the regression the rollback note below warns about.
  - **By hand, the edge key.** Send 50 requests to `http://localhost:18080/socket.io/`, each with a different `X-Forwarded-For` (`curl -s -o /dev/null -w '%{http_code}\n' -H "X-Forwarded-For: 198.51.100.$i" …`). Some must come back `429`: a spoofed header does not buy a fresh bucket. If none do, a `real-ip.conf` trusts too wide a CIDR.
  - **Not observable end to end.** The address the API derives (`req.ip`) is not logged. Today the only routes keyed by `ip:` are `@Public()` ones, and the only ones, the health probes, skip throttling. Checking it through the stack needs a token, and the console client has no password grant (ADR-0010). The API side is covered by the e2e case above.

- **Rollback.** Revert the code and run the migration's `down`, which drops `throttler_hit`; only in-flight counters are lost. Revert `nginx.conf` together with the API: an API trusting one hop behind an nginx that appends to a client's header again would key on a client-chosen address.
- **Revisit** when:
  - a machine client reports incidents through the API: give its account its own limit;
  - the console is exposed beyond the site: per-IP edge limits, IPv6 prefixes, abuse detection;
  - a broker or Redis arrives for other reasons;
  - metrics show limits hit without abuse.
