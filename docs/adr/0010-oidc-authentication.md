# ADR-0010: OIDC authentication for REST and WebSocket

- **Status:** Accepted
- **Date:** 2026-10-04

## Context

Nothing was authenticated. Anyone who could reach the console's origin could read every incident, report, acknowledge or resolve one, resolve camera stream URLs, and subscribe to `/events`. The console's stated purpose is to answer "who is handling it?", and the architecture's quality goal "Auditable" cannot be met without knowing who acted. Roles and an actor on every timeline event (IMP-10) need an authenticated identity first.

Constraints:

- **Runs anywhere, on-prem.** One `docker compose up` must still bring up the whole stack with no cloud dependency, and the demo must work out of the box.
- **One origin, no CORS.** The console's nginx (and the Vite dev server) serve the console, the REST API and the socket from one origin (ADR-0008).
- **Several API replicas** behind round-robin (ADR-0008), so the API cannot hold session state.
- **The only secret is in `DATABASE_URL`** (ADR-0006), and production refuses demo behaviour unless `DEMO_MODE` opts in.

## Options

**Identity provider.**

1. A hosted IdP (Auth0, Entra ID, Cognito). Nothing to run, but a cloud dependency the demo cannot ship with.
2. **Keycloak in Compose**, self-hosted, with a realm imported from the repository.
3. Authentication built into the API (users table, password hashing, sessions). Every OIDC feature (SSO, MFA, federation) would have to be rebuilt, and the API would hold credentials.

**Where the browser reaches the IdP.**

1. Keycloak on its own host port. Simple for nginx, but a second origin: the token endpoint needs CORS, and the token's `iss` has to be pinned to a hostname the browser and the API both use.
2. **Keycloak behind the console's nginx at `/auth/`**, on the same origin as everything else.

**How the API checks tokens.**

1. `@nestjs/passport` + `passport-jwt` + `jwks-rsa`. The pattern in the Nest docs: four packages, and the socket handshake would still need its own code path.
2. **`jose`**, one dependency-free package, in a small verifier shared by the REST guard and the socket handshake.
3. Token introspection (call the IdP per request). It sees revocations immediately, but adds an IdP round trip to every request and makes the IdP a hard runtime dependency.

**Socket token expiry.**

1. Check only at connect. A socket would stay authenticated long after its token expired.
2. A client→server "refresh token" event. It adds a message handler and per-socket state to a namespace that is broadcast-only.
3. **Close the transport when the token expires.** Socket.IO reconnects by itself, the client sends its current token, and the existing reconnect refetch covers the gap.

**Tokens in the e2e tests.**

1. Keycloak as a CI service container. GitHub service containers cannot pass `start-dev --import-realm`, and a JVM start adds time to every run.
2. An `AUTH_DISABLED` switch for tests. A setting that turns authentication off is exactly the kind of production-safety gap IMP-04 removed.
3. **A test-local issuer**: the suite generates its own key pair, serves its JWKS on loopback, and mints tokens, so the production verification path is what gets tested.

## Decision

Keycloak in Compose, behind nginx on the console's origin; the API is an OAuth 2.0 resource server that verifies access tokens with `jose`.

- **Identity provider.** `quay.io/keycloak/keycloak` (pinned minor), `start-dev --import-realm`, realm `occ` from `ops/keycloak/occ-realm.json`, embedded dev store, **no volume**: the realm is re-imported on every start, so it never drifts from the file. No bootstrap admin account.
- **Realm.**
  - Public client `occ-console`: Authorization Code flow with PKCE (`S256`) only; implicit, password and client-credentials grants are off.
  - Redirect URIs are relative (`/*`), which Keycloak resolves against the origin it was reached on, so only the console's own origin is accepted.
  - An audience mapper adds `occ-api` to access tokens.
  - Realm roles `operator`, `supervisor`, `viewer`, and one demo user per role, with the password equal to the username.
- **Hostname.** No fixed Keycloak hostname. Keycloak builds its URLs and the token's `iss` from the forwarded host, so sign-in works through nginx (`:18080`) and through the console's dev server (`:15173`). The API still accepts exactly one issuer.
- **API configuration**, required in every environment, with no default and no off switch:
  - `OIDC_ISSUER`, the expected `iss`, as the browser reaches it;
  - `OIDC_JWKS_URL`, where to fetch signing keys; it may be an internal address;
  - `OIDC_AUDIENCE`, the expected `aud`.

  None of them is a secret. In production, an `http:` issuer needs `DEMO_MODE=true`.

- **Verification** (`TokenVerifier`). It checks:
  - the signature against the issuer's JWKS, fetched on first use and cached, and re-fetched for an unknown `kid`;
  - `iss` and `aud`;
  - the algorithm, which must be `RS256` (`none` and algorithm confusion are rejected);
  - `exp` and `nbf`, with 30 s of clock tolerance;
  - that `sub` is present.
  - The user is `{ subject: sub, displayName: name ?? preferred_username ?? sub }`. Roles are not read yet.
- **REST.** `AuthGuard` is a global `APP_GUARD`, so a new route is protected without anyone remembering to add a guard. `@Public()` opts out; today only `GET /api/health` uses it, because Docker and CI probe it without a token. Swagger UI is served outside the Nest router, so the guard does not apply to it; its exposure stays governed by ADR-0005.
  - No or malformed `Authorization: Bearer …` → `401` with `WWW-Authenticate: Bearer realm="occ"`, plus `error="invalid_token"` when a token was sent but rejected.
  - The JWKS cannot be fetched → `503` "Identity provider unavailable". A `401` would send the operator to a sign-in page that cannot help.
- **WebSocket.** Nest guards do not run on the handshake, so `/events` authenticates in namespace middleware with the same verifier.
  - The token travels in the Socket.IO `auth` payload, never in the query string, which ends up in access logs.
  - A refused client gets `connect_error` with `Unauthorized` or `Identity provider unavailable` (`EventsConnectErrors` in `@occ/contracts`).
  - The server closes the transport when the token expires.
- **Idempotency keys** (ADR-0009) are scoped to the token's `sub`: the primary key becomes `(subject, key)`.
- **Console.** Authorization Code + PKCE, token kept in memory only, sent as a bearer header and in the socket `auth` callback (`IMP-09-console`).

## Consequences

- **Every route but health needs a token.** A client without one gets `401`, the console must sign in, and the simulator and seed are unaffected because they call services in-process.
- **The identity provider is on the request path, but not the boot path.**
  - Keys are fetched lazily, so the API boots, and `/api/health` stays green, while Keycloak is down. Restarting the API would not fix Keycloak.
  - During an outage, REST answers `503` and new sockets are refused. Sockets already connected stay up until their token expires.
  - The API does not `depends_on` Keycloak in Compose.
- **Revocation is not immediate.** A signed-out or disabled user's access token stays valid until it expires (5 min in the demo realm). That is the trade-off for not calling the IdP on every request (introspection, option 3).
- **Demo only:** the realm, its known passwords and `start-dev` (plain HTTP, embedded store). A real deployment brings its own IdP or a hardened Keycloak:
  - `start` mode;
  - HTTPS;
  - a persistent database;
  - a fixed hostname;
  - its own users;

  and it sets `OIDC_*` accordingly. Production refuses an `http:` issuer unless `DEMO_MODE=true`.

- **Opening the console from another address** (for example a LAN IP) needs `OCC_PUBLIC_URL`, so the API expects that issuer. PKCE also needs a secure context (`crypto.subtle`), which plain HTTP on a non-localhost address is not, so such access needs HTTPS.
- **Heavier stack.** Keycloak is a JVM: roughly 0.5–1 GB of RAM and 20–60 s to become ready. `pnpm dev` now needs `docker compose up -d postgres keycloak`.
- **Idempotency keys reset once.** The migration that adds `subject` deletes live keys, so a retry of a request made before the deploy creates a new incident.
- **Deploy all replicas at once.** An old replica rejects keyed reports after the migration (its `ON CONFLICT ("key")` no longer matches a constraint), and accepts unauthenticated requests anyway, so a rolling deploy across this change is not meaningful.
- **Roles exist but are not enforced.** Every authenticated user can do everything until IMP-10 adds permission checks and records the actor on the timeline.
- **Revisit:**
  - ADR-0005's "gate docs behind authentication" option becomes possible; IMP-11 decides it.
  - Per-connection limits on `/events` belong to IMP-11.
  - Correlating the subject in logs belongs to IMP-13.
- **Proving it.** The e2e suite runs against a test-local issuer and sends requests with:
  - no token;
  - a malformed token;
  - an expired token;
  - a token with the wrong audience;
  - a token with the wrong issuer;
  - a token signed by another key.

  It also checks that `/api/health` stays open, that a socket without a token is refused, that a socket is closed when its token expires, and that two users with the same idempotency key get two incidents.
