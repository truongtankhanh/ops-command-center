# Telemetry

The latest readings of the site's equipment, pushed to a console as they arrive. They travel on their own
Socket.IO namespace, **`/telemetry`**, apart from `/events`, because their delivery is different: best-effort and
latest-wins. A reading from a second ago is worthless once a newer one exists, so a console that cannot keep up
skips messages instead of queueing them, and the next message corrects it. Incident events, by contrast, must all
arrive ([events.md](events.md)). Nothing here is an audit record, and nothing here can command a device: the
namespace is read-only ([ADR-0018](../adr/0018-assets-and-telemetry-as-domain-data.md),
[ADR-0019](../adr/0019-telemetry-transport.md)). A console sends one message, `telemetry.watch`, and it only
chooses what the server sends back.

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
- Any role may connect and watch: `viewer`, `operator`, `supervisor` or `technician`. Reading is not acting.
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
`TelemetryServerToClientEvents`, `TelemetryClientToServerEvents`).

### Snapshot

<!-- steel:endpoint EVENT /telemetry telemetry.snapshot | payload: TelemetrySnapshot | auth: bearer (handshake) -->

`telemetry.snapshot` · Status: current

Sent to one socket only, never broadcast, and always delivered: once right after it connects (every asset with a
reading), and again after a [`telemetry.watch`](#watch) that adds assets (only the newly watched ones).

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

Source: `apps/api/src/telemetry/telemetry.gateway.ts:152` (on connect) and `:219` (after a watch)

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

Source: `apps/api/src/telemetry/telemetry.gateway.ts:253`

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

Source: `apps/api/src/telemetry/telemetry.gateway.ts:135` (on a change) and `:156` (on connect)

### Frame

<!-- steel:endpoint EVENT /telemetry telemetry.frame | payload: TelemetryFrame | auth: bearer (handshake) -->

`telemetry.frame` · Status: current

The new readings of **one watched asset**, sent to the sockets that are watching it
([`telemetry.watch`](#watch)). **Best-effort**: a volatile emit, like the overview, so a socket that cannot keep
up skips it and the server does not queue it.

Payload: `TelemetryFrame`.

| Field        | Type                                          | Notes                                                    |
| ------------ | --------------------------------------------- | -------------------------------------------------------- |
| `assetCode`  | string                                        | the asset, e.g. `CT-01`                                  |
| `at`         | ISO 8601 string                               | when the device measured the newest of the new readings  |
| `receivedAt` | ISO 8601 string                               | when the API received them; judge freshness from it      |
| `values`     | `Record<string, number \| boolean \| string>` | the keys that changed, by point key; never an empty `{}` |

- At most 10 frames a second per asset: the server looks every 100 ms and sends nothing when nothing differs.
- **Changed keys only.** A key that is absent is unchanged, not `null`. "Changed" is relative to what the
  watching sockets last received for that asset: the snapshot a watch returns counts as received, so the first
  frame holds the first change, not a repeat.
- `at` and `receivedAt` are those of the readings that arrived in that interval. They can come from a key left
  out because its value did not differ, so they are never older than the values shown.
- **A frame that a socket skipped is not repeated.** A key is sent again only when its value changes. A console
  that needs the exact value of every point of an asset stops watching it and watches it again: the snapshot that
  follows has the latest of every key.
- Frames are built from what this replica holds, so two consoles on two replicas can differ by one reading.

Source: `apps/api/src/telemetry/telemetry.gateway.ts:296`

## Freshness

The server never invents a value and never times a device out. A console judges whether an asset is current from
`receivedAt`, from `online` (a device's last will sets it `false`; its next reading sets it `true` again), and
from each point's expected interval.

## Watching assets

The overview carries only each asset's headline values. A console that is inspecting an asset asks for every
reading of it with `telemetry.watch`.

### Watch

<!-- steel:endpoint EVENT /telemetry telemetry.watch | payload: TelemetryWatchRequest | ack: TelemetryWatchAck | auth: bearer (handshake) -->

`telemetry.watch` · Status: current · sent by the client

Sets the assets this socket receives [`telemetry.frame`](#frame) for. Any role may send it: the handshake already
checked the token and the role, and watching changes what the server sends, not what it does.

```ts
socket.timeout(2000).emit('telemetry.watch', { assets: ['CT-01', 'CT-02'] }, (error, ack) => {
  // error: no answer in time (an older replica never answers); ack.accepted: ['CT-01', 'CT-02']
});
```

Payload: `TelemetryWatchRequest`.

| Field    | Type       | Notes                                                                             |
| -------- | ---------- | --------------------------------------------------------------------------------- |
| `assets` | `string[]` | asset codes, in order of preference; at most `TELEMETRY_WATCH_LIMIT` (4) are kept |

Acknowledgement: `TelemetryWatchAck`, `{ accepted: string[] }`.

- **The set replaces the previous one.** Assets that are not in the new set stop sending frames to this socket;
  `{ assets: [] }` stops all of them.
- **What is read.** Only the first 32 entries are looked at. An entry that is not a string, repeats an earlier
  one, or is not an asset of the catalogue is ignored; these are dropped **before** the limit, so an ignored entry
  never uses up one of the 4. The first 4 that remain are kept, in request order, and are what `accepted` lists.
  A payload that is not an object with an `assets` array (`null`, a number, a string, a bare array) accepts
  nothing, which is the same as an empty list: the socket then watches nothing. None of this disconnects the
  socket or raises an error.
- **The snapshot.** When at least one accepted code was not being watched before, the socket gets one
  [`telemetry.snapshot`](#snapshot) holding exactly those assets (empty when none holds a reading yet). Nothing is
  sent when the set is unchanged or only shrinks. The snapshot is emitted before the acknowledgement, so do not
  rely on the order of the two.
- **Rate limit: 5 per second per socket**, in any rolling second, counted by the API itself and always on. A call
  past it changes nothing and is answered `{ accepted: [] }`; the previous set keeps streaming. That answer is the
  same as for a list whose codes were all unknown, so a console should never send faster than it needs to: debounce
  the set it wants.
- A call sent without a callback is applied and gets no answer.
- A code the catalogue does not hold yet is ignored: on a database that was just seeded this lasts until the
  replica re-reads the catalogue, up to a minute.

Source: `apps/api/src/telemetry/telemetry.gateway.ts:182`

## Topics and payload for a gateway

What a device, or a gateway in front of devices, publishes for the API to read. This is the `mqtt` telemetry
source ([ADR-0019](../adr/0019-telemetry-transport.md)); the default `mock` source needs none of it. The broker is
the site's own: the API connects to it as a client with `MQTT_URL`, `MQTT_USERNAME` and `MQTT_PASSWORD`, and no
browser ever does.

| Topic                               | QoS | Retained | Payload                                                                                 |
| ----------------------------------- | --- | -------- | --------------------------------------------------------------------------------------- |
| `occ/{site}/asset/{code}/telemetry` | 0   | no       | `{ "at": "<ISO time measured>", "values": { "<key>": <number \| boolean \| string> } }` |
| `occ/{site}/asset/{code}/status`    | 1   | yes      | `{ "online": true }` or `{ "online": false }`                                           |

- `{site}` is the site's `code` (`LANGBIANG` in the demo) and `{code}` is the asset's tag as in
  [assets.md](assets.md). Any other topic under `occ/+/asset/+/#` is ignored.
- A `telemetry` payload is at most 4 KB. `values` holds the point `key`s of the asset's class
  ([assets.md](assets.md)); an `enum` point sends one of its `enumValues` as a string.
- **What the API drops, and counts:** an unknown asset, an unknown key, a value of the wrong kind, a number outside
  the point's `min` and `max`. Nothing is clamped. An `at` more than 5 minutes from the API's clock is replaced by
  the time of receipt and counted. Per asset and key the API keeps only the latest value.
- **A device sets its last will** on its `status` topic to `{ "online": false }`, retained, so the broker announces
  a device that died. A device that stops cleanly publishes the same itself, because a clean disconnect does not
  fire the will.
- **Access.** The API's account may subscribe to `occ/+/asset/+/#` and may publish nothing. A device's account may
  publish only under its own `occ/{site}/asset/{code}/`. Anonymous access is off. A real site exposes `8883` (TLS)
  to its device network only, and production needs `mqtts://` unless `DEMO_MODE` is set.
- **The demo.** `docker compose --profile telemetry up` starts a broker and a simulator that follow exactly this
  contract, with one account per asset (username = asset code). See the README, "Telemetry".
- **Scripted breaches are the mock source's.** With `TELEMETRY_MOCK_SCENARIO=true` the `mock` source holds
  `CT-01`'s `motorTempC` past its limit for 80 s every 10 minutes and `LKS-B3`'s `leakDetected` `true` for 620 s
  every hour, so the demo raises an incident. The `mqtt` demo's simulator does not play it. A source of your own
  needs nothing like it, but a test breach must outlast the rule's `for_s` in readings the leader sees: a rule
  raises only after `for_s` of breaching readings, and a gap of more than three of the point's intervals starts
  the dwell again.

## Rolling deploys

A console built for `/telemetry` that meets a replica without the namespace gets `connect_error` with the message
`Invalid namespace`. Treat it as "no telemetry" and try again on the next reconnect: during an API rollout one
reconnect can meet an old replica and the next a new one.

A replica from before `telemetry.watch` ignores it and never answers, so send it with an acknowledgement timeout
and treat a timeout as "no frames from this replica"; watch again after the next reconnect.
