# ADR-0011: Role-based authorization and the timeline actor

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

ADR-0010 gave every request and socket an authenticated identity, but stopped there: any signed-in user could report, acknowledge and resolve incidents, and the timeline still recorded only what happened and when. The console exists to answer "who is handling it?", and the architecture's quality goal "Auditable" needs the timeline to say who acted.

The realm already defines the roles `operator`, `supervisor` and `viewer`, with one demo user each (ADR-0010). Nothing read them.

Constraints:

- **Server-side enforcement.** The console may hide actions, but only the API can refuse them.
- **One authorization model.** REST and the `/events` handshake must apply the same rules, as they already share one token verifier.
- **Bring your own IdP.** ADR-0010 tells a real deployment to bring its own identity provider, so the API's expectations of the token must be stated.
- **The timeline is the audit log.** An entry must never be written without saying who caused it, and history must not change when an account is renamed.
- **Migrations run at boot, in one transaction** (ADR-0004, `migrate-on-boot.ts`), on a table that grows with every transition.

## Options

**Where the API reads roles.**

1. **Keycloak's standard `realm_access.roles` claim.** No realm change; Keycloak puts it in every access token by default.
2. A realm mapper that writes a flat `roles` claim. IdP-neutral in shape, but another IdP must still reproduce it, so it moves the coupling instead of removing it.
3. A setting naming the claim path (`OIDC_ROLES_CLAIM`). Worth it once a second IdP exists, not before.

**How handlers declare what they need.**

1. `@Roles('operator', 'supervisor')` on each handler. Simple today, but the role matrix is spread across handlers, and the console would need its own copy to hide actions.
2. **`@RequirePermission('incident:acknowledge')`** on each handler, and one role → permission map (`ROLE_PERMISSIONS`) in `@occ/contracts`, read by the API guard and the console alike.
3. Attribute- or ownership-based rules ("only the operator who acknowledged may resolve"). Nothing in the product asks for them yet.

**How the check is wired.**

1. Inside `AuthGuard`. One guard fewer, but authentication (401/503) and authorization (403) mixed in one class.
2. **A second global guard, `RolesGuard`**, registered after `AuthGuard`.

**Users with no known role.**

1. Treat them as `viewer`. Then any account in the realm can read every incident and camera URL.
2. **Deny by default:** 403 on every non-public route, and a refused socket.

**How an actor is stored.**

1. One `system` actor for everything that is not a person. The timeline could not tell a simulated acknowledgement from an entry migrated from before actors.
2. A reserved subject prefix (`system:simulator`). It relies on no IdP ever issuing such a `sub`.
3. **An explicit `kind` (`user` | `system`)** next to the subject and a display name, so a system actor can never be mistaken for a user.

**Idempotent responses stored before the upgrade** (ADR-0009). They hold timelines without actors, so a replay would not match the new contract.

1. Delete the keys, as the migration for ADR-0010 did. A retry that straddles the deploy would then create a duplicate incident, the harm ADR-0009 exists to prevent. That earlier migration had no choice (there was no subject to give old keys); this one does.
2. Accept the gap for 24 h. A client typed against the new contract would get `undefined`.
3. **Patch the stored bodies** with the same actor the backfill writes to `incident_event`, so a replay still matches `GET /incidents/:id`.

## Decision

Permission-based authorization on top of ADR-0010's authentication, and an actor on every timeline entry.

- **Roles** come from `realm_access.roles`. `TokenVerifier` keeps the roles the API knows (`ROLES` in `@occ/contracts`) and ignores the rest; a missing or malformed claim means no roles, not an invalid token.
- **Permissions.** `PERMISSIONS` = `incident:report`, `incident:acknowledge`, `incident:resolve`. `ROLE_PERMISSIONS` grants all three to `operator` and `supervisor` and none to `viewer`. Reading needs no permission, only a known role. `supervisor` equals `operator` until supervisor-only actions are specified; nothing defines its "oversight" yet.
- **REST.** `RolesGuard` is a second `APP_GUARD`, listed after `AuthGuard` (Nest runs global guards in that order):
  - `@Public()` routes skip it;
  - a user with no known role gets `403` "No role grants access to this API";
  - a handler marked `@RequirePermission(p)` needs a role that grants `p`, else `403` "Missing permission: p".
  - Guards run before pipes, so a `viewer` sending an invalid body or an unknown id gets `403`, not `400` or `404`.
- **WebSocket.** Every known role may subscribe to `/events`. The handshake refuses a user with none, with `connect_error` `Forbidden` (`EventsConnectErrors`). The socket keeps its handshake roles until the connection is closed at token expiry.
- **Actor.** `IncidentEvent.actor = { kind, subject, displayName }`, required on every entry, stored as `actor_kind` (with a `CHECK`), `actor_subject` and `actor_name` on `incident_event`.
  - A user's actor is built from the verified token only: `sub` and the display name ADR-0010 derives. The display name is a snapshot, cut to the column's 255 characters; the subject is never cut.
  - System actors: `simulator` (Simulator) for the simulator, `seed` (Demo seed) for the demo seed, and `system` (System) for entries written before this decision.
  - The entity methods (`report`, `acknowledge`, `resolve`) take the actor as a required argument, so an entry without one does not compile. No request field or header can set it.
- **Migration** `IncidentEventActor`: adds the three columns with the backfill actor as a constant default (metadata-only, no table rewrite), then drops the defaults; adds the backfill actor to every timeline entry in stored idempotent responses (Option 3 above). The `CHECK` is added inline: while all migrations share one transaction, `NOT VALID` + `VALIDATE` would not shorten the lock.
- **Live events are unchanged.** The `/events` payload is the `Incident`, which has no timeline; a client sees the actor when it fetches the detail.

## Consequences

- **A viewer can read but not act**, and a user with none of the three roles can do nothing. The console hides the actions a role cannot take, using the same `ROLE_PERMISSIONS`; the API's `403` is the control. The console reads the roles from the same access token's `realm_access.roles`, for display only.
- **Every timeline entry says who caused it**, including history: entries from before this decision read as `System`.
- **The IdP contract grows.** A real deployment's IdP must put the user's roles in `realm_access.roles` of the access token (Keycloak does by default; another IdP needs a mapper), using the names `operator`, `supervisor`, `viewer`. Otherwise every user gets `403`.
- **Role changes are not immediate**, the same trade-off as revocation in ADR-0010: REST sees a changed role with the next token (5 min in the demo realm); a connected socket keeps its handshake roles until it reconnects at token expiry.
- **Display names are personal data in the audit log.** They are shown to everyone who can read the incident, which is the point, and they stay after an account is renamed or removed. A deletion request would need a deliberate redaction step.
- **Patched idempotent responses are not byte-identical.** Bodies stored before the upgrade went through `jsonb`, which reorders keys, and gained `actor`. Only keys from the 24 h before the deploy are affected.
- **Deploy all replicas at once.** After the migration, an older replica cannot insert timeline entries (the actor columns are `NOT NULL` with no default) and does not check roles. Compose restarts every replica together.
- **A large `incident_event`** would need the `CHECK` split into its own migrations (`NOT VALID`, then `VALIDATE`) to keep writers unblocked during the scan. Not needed at the demo's size.
- **Follow-ups, not decided here:** supervisor-only actions (reassign, re-open, override); showing who handles an incident in the feed without a refetch (`acknowledgedBy` on `Incident` and the live payload); an index and API for "everything user X did".
