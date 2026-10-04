# ADR-0009: Idempotent incident creation with an `Idempotency-Key`

- **Status:** Accepted
- **Date:** 2026-10-04

## Context

Operators on flaky networks retry. A timeout does not tell the console whether `POST /api/incidents` reached the API, so a second attempt is the reasonable thing to do. Each attempt created a new incident with a new `INC-` code. In a security console a duplicate incident is real harm: two operators may handle the same event, or one copy stays open after the other is resolved.

The console already disables its button while a request is pending, which stops a double click. It does not help when the request failed or timed out and the operator submits again.

The fix has to keep two properties already in place: the API can run as several replicas (ADR-0008), and an incident, its timeline and its outbox row commit together in one transaction (ADR-0007).

## Options

1. **De-duplicate on the client only.** Keep a pending flag across retries. A request that reached the server before the connection dropped still creates a duplicate on the next attempt, so this cannot work on its own.
2. **A generic interceptor with its own store.** It works for any endpoint, but the interceptor cannot join the service's transaction without a request-scoped transaction context (a new dependency). It would have to store the response after the commit, which leaves a window where the incident exists and the key does not.
3. **Advisory lock on a hash of the key.** It serialises same-key requests without a table write, but it still needs the table for the stored response. It also needs a second lock key space beside the fixed keys in `advisory-locks.ts`, and hash collisions would serialise unrelated keys.
4. **Return `409` while the first request is still in flight** (Stripe's behaviour). Simple for the server, but the client must retry once more to get the incident.
5. **Insert the key row first, inside the incident's transaction.** The primary key makes concurrent same-key requests wait for the first one, then replay its committed response.

## Decision

Option 5.

- **Header.** `POST /api/incidents` accepts an optional `Idempotency-Key`: 1–255 printable ASCII characters, no spaces, case-sensitive. Anything else is `400`. Its name is `IDEMPOTENCY_KEY_HEADER` in `@occ/contracts`, shared with the console. Without the header, nothing changes.
- **Store.** Table `idempotency_key`:
  - columns: key, SHA-256 of the request body, response status and body, incident id, `expires_at`;
  - written by `IncidentsService.report()` in the same transaction as the incident;
  - the response body is `json`, not `jsonb`, so a replay keeps the original key order and is byte-identical.
- **Claim first.** The first statement of the transaction is `INSERT … ON CONFLICT (key) DO UPDATE … WHERE expires_at <= now()`. That happens before the zone lookup and before `nextval`, so a replay uses no incident code.
  - If a row comes back, this request owns the key: it is new, or it took over an expired one.
  - If no row comes back, the key is live. Under READ COMMITTED the next statement reads the committed row: a different body hash is `422`, the same hash returns the stored response.
- **What is stored.** Only a successful creation, as `201` plus the `IncidentDetail` exactly as first returned. A request that fails (`404` zone, a database error) rolls back with its key, so the retry runs again.
- **Fingerprint.** SHA-256 of the validated body with object keys sorted, so field order and formatting do not count as a different body. An omitted `position` and an explicit one are different bodies.
- **Mismatch.** `IdempotencyKeyReusedError` is a `DomainError`, so the existing exception filter maps it to `422`. The message does not echo the key.
- **Expiry.** A key protects for 24 h, the same as outbox retention. Expired rows count as absent. `IdempotencyKeyCleanup` deletes them hourly on every replica, which is harmless.
- **Scope.** Only `POST /api/incidents` accepts a key. `acknowledge` and `resolve` already answer a repeat with `409` rather than a duplicate.
- **Not added.** No response header marks a replay. The console merges the response by `id` and `version`, so it does not need one.

## Consequences

- **Retries are safe** for any client that sends a key: one incident and one `incident.created` event per key. The console sends one key per submission and reuses it on retry (`IMP-08-console`).
- **Concurrent same-key requests wait.** A request that arrives while another with the same key is in flight blocks on the primary key, holding a pool connection, until the first commits or rolls back.
  - The wait is bounded by the session `lock_timeout` of 5 s. Past that, the waiting request fails with `500`, and its next retry replays normally.
  - It only happens when the first transaction takes more than 5 s, so it was not mapped to a dedicated status.
- **Replays return the response as committed.** A replay within 24 h shows the incident as it was created, not its current state. If a deploy changes the shape of `IncidentDetail`, replays of older keys return the old shape until they expire.
- **Keys are global until there is authentication.** Any caller who knows a key receives that key's response. Keys are random UUIDs and the API has no authentication yet (IMP-09), so this exposes nothing that `GET /api/incidents` does not. Once IMP-09 lands, keys must be scoped to the authenticated subject: add the subject to the primary key.
- **Cost per request with a key.** Creating costs two extra statements (the claim insert and the response update). A replay costs two statements in total. The cleanup deletes by an index on `expires_at`.
- **Rolling deploys.** A replica still on the old image ignores the header, so a retry that lands on it during a rollout is not de-duplicated.
- **More endpoints.** Before another endpoint accepts keys, add a `scope` column (method and route) so the same key on two endpoints does not collide.
- **Rollback.** Revert the code and run the migration's `down`, which drops the table: keys still inside their 24 h window lose their protection, and incidents are unaffected. Leaving the table in place after a code revert is also harmless.
- **Proving it.** The e2e suite sends:
  - the same key twice, and expects one incident and equal responses;
  - several concurrent requests with one key, and expects one incident;
  - the same key with a different body, and expects `422`;
  - a malformed key, and expects `400`.
