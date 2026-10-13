# Telemetry

The latest readings of the site's equipment, pushed to a console as they arrive. They travel on their own
Socket.IO namespace, **`/telemetry`**, apart from `/events`, because their delivery is different: best-effort and
latest-wins. A reading from a second ago is worthless once a newer one exists, so a console that cannot keep up
skips messages instead of queueing them, and the next message corrects it. Incident events, by contrast, must all
arrive ([events.md](events.md)). Nothing here is an audit record, and nothing here can command a device: the
namespace is read-only ([ADR-0018](../adr/0018-assets-and-telemetry-as-domain-data.md),
[ADR-0019](../adr/0019-telemetry-transport.md)).

What a console receives is what **its replica** holds. Replicas do not coordinate readings, so two consoles on two
replicas can briefly differ by one reading.

## Connecting

Use the WebSocket transport only, as for `/events`:

```ts
io('/telemetry', { transports: ['websocket'], auth: (cb) => cb({ token }) });
```

The handshake is the same as `/events` and is implemented once for both (`SocketAuth`):

- The OIDC access token goes in the handshake's `auth` payload (`EventsHandshakeAuth`), never in the URL. Pass
  `auth` as a function so every reconnect sends the current token.
- Any role may connect: `viewer`, `operator`, `supervisor` or `technician`. Reading is not acting.
- A refused handshake raises `connect_error` with one of `EventsConnectErrors`: `Unauthorized`,
  `Identity provider unavailable` or `Forbidden`, with the meanings given in [events.md](events.md).
- The server closes the transport when the token expires; Socket.IO reconnects with the current token, and the
  reconnect delivers a new snapshot.

### Two namespaces, one transport

Each namespace runs its own handshake and its own token check. By default the Socket.IO client opens one
WebSocket for both: `io('/events')` and `io('/telemetry')` on the same origin share a `Manager`. That is one
request through the proxy (counted once against its per-IP limit) and two token checks on the API. A client that
sets `forceNew` or `multiplex: false` opens a second WebSocket and is counted twice.

Closing a shared transport closes both namespaces. That happens at token expiry, and when the API asks `/events`
consoles to refetch after a resync ([events.md](events.md)). Expect a new snapshot after any reconnect, and do
not assume the two namespaces reconnect independently.

## Events

Event names and payload types are defined once in `@occ/contracts` (`TelemetryEvents`,
`TelemetryServerToClientEvents`).

### Snapshot

<!-- steel:endpoint EVENT /telemetry telemetry.snapshot | payload: TelemetrySnapshot | auth: bearer (handshake) -->

`telemetry.snapshot` · Status: current

Sent once, to the connecting socket only, right after it connects. Always delivered.

Payload: `TelemetrySnapshot`.

| Field    | Type                                     | Notes                                                         |
| -------- | ---------------------------------------- | ------------------------------------------------------------- |
| `at`     | ISO 8601 string                          | when the snapshot was built                                   |
| `assets` | `Record<string, TelemetryAssetSnapshot>` | keyed by asset code, e.g. `CT-01`; every asset with a reading |

`TelemetryAssetSnapshot`:

| Field        | Type                                          | Notes                                                       |
| ------------ | --------------------------------------------- | ----------------------------------------------------------- |
| `online`     | `boolean`                                     | `false` once the device's last will fired; see below        |
| `receivedAt` | ISO 8601 string                               | when the API received the asset's latest reading            |
| `values`     | `Record<string, number \| boolean \| string>` | the latest value of every key received so far, by point key |

- An asset with no reading yet is **absent**, never sent with a placeholder: read it as "no data". `assets` is
  empty when nothing is held, for instance with `TELEMETRY_SOURCE=off`; the snapshot is still sent.
- A snapshot is an upsert per asset: replace the `values` of each asset listed and leave the others alone.

Source: `apps/api/src/telemetry/telemetry.gateway.ts:101`

### Overview

<!-- steel:endpoint EVENT /telemetry telemetry.overview | payload: TelemetryOverview | auth: bearer (handshake) -->

`telemetry.overview` · Status: current

Sent to every connected socket about once a second while at least one is connected. **Best-effort**: a socket that
cannot keep up skips it (a volatile emit), and the server does not queue it.

Payload: `TelemetryOverview`.

| Field    | Type                                     | Notes                                                   |
| -------- | ---------------------------------------- | ------------------------------------------------------- |
| `at`     | ISO 8601 string                          | when the overview was built                             |
| `assets` | `Record<string, TelemetryAssetOverview>` | keyed by asset code; an asset with no reading is absent |

`TelemetryAssetOverview`:

| Field        | Type                                          | Notes                                                  |
| ------------ | --------------------------------------------- | ------------------------------------------------------ |
| `online`     | `boolean`                                     | as in the snapshot                                     |
| `receivedAt` | ISO 8601 string                               | when the API received the asset's latest reading       |
| `headline`   | `Record<string, number \| boolean \| string>` | the current values of the asset's headline points only |

The overview keeps coming while the upstream is `paused`: what is held is still the latest known, and `receivedAt`
says how old it is.

Source: `apps/api/src/telemetry/telemetry.gateway.ts:130`

### Status

<!-- steel:endpoint EVENT /telemetry telemetry.status | payload: TelemetryStatus | auth: bearer (handshake) -->

`telemetry.status` · Status: current

Whether **this replica's connection to its telemetry source** is up. Sent to a socket once after it connects, and
to every connected socket whenever the state changes. Always delivered. It says nothing about the console's own
socket: a console shows "Telemetry paused" for `paused`, and a socket that is down shows its own state.

Payload: `TelemetryStatus`.

| Field      | Type                   | Notes                                 |
| ---------- | ---------------------- | ------------------------------------- |
| `upstream` | `'live'` \| `'paused'` | the source connection of this replica |
| `since`    | ISO 8601 string        | when `upstream` last changed          |

- `paused` is also what a replica reports until its source has connected, so a console that connects during
  start-up is told `paused` and then `live`.
- With the `mqtt` source, `paused` means the broker connection is down or has not accepted the subscription; the
  source reconnects on its own. With the `off` source the state is `live`, and nothing is ever sent.
- A paused upstream does not make the API unready: `/api/health/ready` is unchanged
  ([ADR-0013](../adr/0013-liveness-and-readiness-probes.md)).

Source: `apps/api/src/telemetry/telemetry.gateway.ts:87` (on a change) and `:105` (on connect)

## Freshness

The server never invents a value and never times a device out. A console judges whether an asset is current from
`receivedAt`, from `online` (a device's last will sets it `false`; its next reading sets it `true` again), and
from each point's expected interval.

## Not served yet

`telemetry.watch` and `telemetry.frame` (up to 10 readings a second for the few assets a console is inspecting) are
not served by this version. A `telemetry.watch` sent by a client is ignored and is not acknowledged.

## Rolling deploys

A console built for `/telemetry` that meets a replica without the namespace gets `connect_error` with the message
`Invalid namespace`. Treat it as "no telemetry" and try again on the next reconnect: during an API rollout one
reconnect can meet an old replica and the next a new one.
