# ADR-0019: Telemetry comes in over MQTT to the API, and goes out to consoles on a `/telemetry` Socket.IO namespace

- **Status:** Proposed
- **Date:** 2026-10-08
- **Context documents:** [Console V2 design brief](../design/v2/brief.md), [ADR-0018](0018-assets-and-telemetry-as-domain-data.md)

## Context

ADR-0018 describes assets, their readings and their rules. This ADR decides how readings travel from a device to the
API and from the API to a console, at a rate that lets the 3D twin move smoothly without the browser or the
database paying for it.

Readings are a different kind of data from incident events:

- **Latest wins.** A fan speed from 100 ms ago is worthless once a newer one exists. Incident events must all
  arrive, in order, at least once (ADR-0007, ADR-0008).
- **Volume.** A device may send several readings a second; the catalogue may grow to hundreds of assets.
- **Devices speak MQTT.** PLC gateways, IoT modules and building management systems publish MQTT; few speak HTTP or
  WebSocket to an application.

Constraints:

- **Several API replicas** behind round-robin, WebSocket-only, no sticky sessions (ADR-0008).
- **One identity and role model** for every client: OIDC access tokens (ADR-0010), roles from `realm_access.roles`
  (ADR-0011).
- **On-prem, one `docker compose up`**, and development, CI and demos run with no hardware, as for cameras
  (ADR-0002).
- **Production refuses demo behaviour** unless `DEMO_MODE` opts in (ADR-0006, IMP-04).
- **The browser's main thread renders.** It must not handle a message per reading (brief, R5).

## Options

**Who talks to the broker.**

1. The browser, over MQTT-over-WebSocket. No API code, but the broker becomes internet-facing behind nginx, needs
   its own way to accept OIDC tokens and roles, and every console receives every reading of every asset at the
   devices' rate.
2. **The API, as an MQTT subscriber (the bridge)**, which validates, caps the rate and forwards to consoles over
   Socket.IO. The broker stays on the internal network and consoles keep one auth model.

**How readings reach every replica's consoles.**

1. Through the outbox and `NOTIFY` (ADR-0008). One `NOTIFY` and one row per reading floods the WAL and the
   notification queue for data that is stale within a second, and buys durability nobody wants.
2. The Socket.IO Postgres or Redis adapter. A new dependency or service, for the same effect as option 3.
3. **Every replica subscribes to the broker itself.** Each holds the latest state of every asset in memory and
   serves its own consoles. Nothing crosses Postgres.

**Who persists samples and evaluates rules** (ADR-0018), which must happen once.

1. **A leader elected by advisory lock**, as `SimulatorLeader` (ADR-0008). Works the same with the mock source and
   with any broker.
2. MQTT 5 shared subscriptions (`$share/occ/...`). No lock, but it ties correctness to a broker feature and does
   nothing for the mock source.

**What a console receives.**

1. Every reading of every asset. At 100 assets, 10 Hz and about 200 bytes, that is 200 KB/s per console, mostly for
   assets nobody is looking at.
2. **Two tiers**: a 1 Hz overview of every asset (state and its one or two headline readings), plus up to 10 Hz of
   all readings for the few assets the console is watching (hovered or inspected).

**Broker.**

1. **Eclipse Mosquitto 2.** One small process, MQTT 3.1.1 and 5, TLS, password file, ACL file, last will. Enough for
   one site.
2. EMQX. Clustering, a dashboard and rule engine, but an Erlang runtime and far more to secure for a single site.
3. RabbitMQ with its MQTT plugin. Only worth it if the platform already runs RabbitMQ; this one does not.

## Decision

The API bridges MQTT to a new Socket.IO namespace. Every replica subscribes; one leader persists and evaluates
rules; consoles get a 1 Hz overview of everything and up to 10 Hz for the assets they watch.

- **Source port.** `TelemetrySource` in `apps/api/src/telemetry`, chosen once at startup from `TELEMETRY_SOURCE`, the
  same shape of decision as `CameraSource` (ADR-0002):
  - `mock`: an in-process generator. Each value is a pure function of asset, key and time, so every replica
    produces the same readings with no coordination. The default outside production; in production it needs
    `DEMO_MODE=true`, like `CAMERA_SOURCE=mock`.
  - `mqtt`: `MqttTelemetrySource` on MQTT.js, configured by `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD` (a secret,
    injected per ADR-0006) and `MQTT_CA_FILE`. In production `MQTT_URL` must be `mqtts://`, unless `DEMO_MODE`.
  - `off`: no telemetry; the twin shows assets with no readings.
- **Topics and payload.**
  - `occ/{siteCode}/asset/{assetCode}/telemetry`, QoS 0: `{ "at": "<ISO time measured>", "values": { "<key>":
<number | boolean | string> } }`, at most 4 KB.
  - `occ/{siteCode}/asset/{assetCode}/status`, QoS 1, retained: `{ "online": true | false }`. A device sets its
    last will to `{ "online": false }`, so the broker announces a dead device.
- **Validation in the bridge.** Unknown asset, unknown key, wrong kind or a value outside the point's `min`/`max`
  (ADR-0018) is dropped and counted, never clamped. An `at` more than 5 minutes from the API's clock is replaced by
  the receive time and counted. The bridge keeps at most one pending reading per asset and key: latest wins.
- **Leader.** `TelemetryLeader` holds a new session-level advisory lock (`AdvisoryLocks.Telemetry`) exactly as
  `SimulatorLeader` does. Only the leader writes `telemetry_sample` rows, manages their partitions and evaluates
  threshold rules. Every replica, the leader included, serves its own consoles.
- **Namespace `/telemetry`**, separate from `/events` because its delivery is best-effort and latest-wins:
  - The same handshake middleware as `/events`: the token in the `auth` payload, any known role, `connect_error`
    from `EventsConnectErrors`, the transport closed when the token expires. WebSocket only.
  - Server → client (types in `@occ/contracts`):
    - `telemetry.overview`, every second: `{ at, assets: { [assetCode]: { online, receivedAt, headline } } }`;
    - `telemetry.frame`, at most 10 Hz per watched asset: `{ assetCode, at, receivedAt, values }`, changed keys
      only;
    - `telemetry.snapshot`, after connect and after each watch change: the full latest state in scope;
    - `telemetry.status`: `{ upstream: 'live' | 'paused', since }`, when this replica's source connection drops or
      returns. This is the console's `Telemetry paused` (brief, frame 05), distinct from its own socket being down.
  - Client → server: `telemetry.watch` with up to 4 asset codes, replacing the previous set, acknowledged with the
    accepted codes. The first client-to-server event in the system: validated against the catalogue, limited to 5
    per second per socket, an unknown code ignored. Watched assets map to Socket.IO rooms `asset:<code>`.
  - Overview and frames use `volatile` emits: a socket that cannot keep up skips messages instead of buffering
    them. Snapshot and status are always delivered.
- **Freshness** is decided by the console's worker from `receivedAt` and each point's `expected_interval_s`
  (stale after three intervals), and from `online`. The server never invents a value.
- **Compose.**
  - Default: `TELEMETRY_SOURCE=mock`, so `docker compose up` shows a live twin with no broker.
  - Profile `telemetry`: `eclipse-mosquitto:2` (pinned minor) on the internal network only, no host port, with a
    password file and ACL from `ops/mosquitto/`, plus a small publisher (`ops/telemetry-sim`) that plays the demo
    devices over real MQTT. The API then runs with `TELEMETRY_SOURCE=mqtt`.
- **Broker access.** Anonymous access off. Each device has its own credentials and may publish only under its own
  `occ/{site}/asset/{code}/`. The API's account may subscribe to `occ/+/asset/+/#` and may publish nothing. No
  route through nginx reaches the broker. A real site exposes `8883` (TLS) to its device network only.
- **Observability** (ADR-0014, ADR-0015): `occ_telemetry_messages_total{result}` (`accepted`, `unknown_asset`,
  `invalid`, `clock_skew`), `occ_telemetry_upstream_up`, `occ_telemetry_sockets`, `occ_telemetry_leader`; labels
  never carry an asset code. Upstream disconnects and leader changes are logged once per change, never per message.
- **Readiness is unchanged** (ADR-0013). A replica whose broker connection is down still serves incidents, cameras
  and the site plan; consoles see `telemetry.status: paused` instead.

## Consequences

- **Consoles get one auth model and a bounded stream.** About 15 KB/s of overview for 100 assets plus about 16 KB/s
  per watched set, whatever the devices send. These are estimates to measure in V2-04.
- **The broker is never public**, and no command reaches a device: the API cannot publish, and devices cannot read
  each other's topics. Commanding equipment would need a new ADR.
- **Replicas do not coordinate readings.** Each replica's consoles see the same values within network jitter, and
  a replica that loses the broker pauses only its own consoles. Two consoles on two replicas can briefly differ by
  one reading.
- **Leader failover** gaps sample writes and restarts rule timers for at most one leader-check interval plus
  `for_s` (ADR-0018). Live readings to consoles do not pause, because every replica subscribes.
- **Best-effort to the browser.** A slow console skips frames rather than falling behind; the next frame or the 1 Hz
  overview corrects it. Nothing here is an audit record: the incident a breach raises is.
- **The first client-to-server event.** `ClientToServerEvents` stops being empty, and `telemetry.watch` needs its own
  validation, rate limit and tests. `/events` stays broadcast-only.
- **Heavier demo, optionally.** The default stays as light as today; the `telemetry` profile adds two small
  containers.
- **Proving it.**
  - Unit: payload validation, latest-wins coalescing, the mock generator being identical across instances.
  - e2e, mock source: a console socket gets a snapshot on connect, the overview each second, frames only for watched
    assets, and is refused without a token or role.
  - e2e, MQTT: an in-process broker in the test (no container) checks topic parsing, last will → `online: false`,
    and `telemetry.status` when the broker goes away.
  - Two API instances on one database: exactly one is telemetry leader, and a rule breach raises exactly one
    incident.
- **Revisit** shared subscriptions or EMQX if one site outgrows a single Mosquitto, a binary encoding (MessagePack)
  if JSON frames become the bottleneck, and the watch limit of 4 if a wall display needs more.

## Open before acceptance

- ~~Confirm the API bridge over the browser connecting to MQTT directly (brief, open question 4).~~ Decided
  2026-10-09 by the tech lead, confirmed with the security lead: the API bridge, as written in the Decision. No
  browser connects to the broker, and consoles keep one authentication model (ADR-0010).
- Which device protocols the first site actually has: MQTT is assumed; Modbus or BACnet would need a gateway that
  publishes MQTT, outside this repository.
