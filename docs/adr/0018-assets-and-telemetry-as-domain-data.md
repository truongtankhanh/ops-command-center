# ADR-0018: Assets, telemetry points and threshold rules are domain data; breaches become incidents

- **Status:** Proposed
- **Date:** 2026-10-08
- **Context documents:** [Console V2 design brief](../design/v2/brief.md)

## Context

Console V2 replaces the 2D map stage with a 3D digital twin of the campus and its equipment, driven by live
telemetry (design brief V2-01). Today `@occ/contracts` knows zones, cameras, the site plan and incidents. Nothing
describes a piece of equipment, what it measures, what counts as abnormal, or what it read a minute ago.

The twin needs, per asset:

- where it is and how it sits (position, height above ground, heading), and which 3D model draws it;
- which readings it sends, in which unit and range, and how often, so the console can tell live from stale;
- the last 15 minutes of each reading, for the inspector's sparklines after a reload;
- which readings are abnormal, so a breach reaches operators as an incident, like everything else they act on.

Constraints:

- **Migrations only, run at boot in one transaction** (ADR-0004), with several replicas (ADR-0008).
- **Rolling deploys.** An older console can meet a newer API, and the reverse, for as long as a rollout takes (as
  ADR-0017).
- **No new infrastructure without a reason.** The target is an on-prem host with PostgreSQL (ADR-0007, ADR-0008).
- **Seeding is demo-only** (IMP-04); the demo campus must not reach a real database.
- **An incident is the only thing operators act on.** Feed, toasts, KPI tiles, sound and the timeline already exist
  for incidents (UI-07, UI-14); a second alarm concept would duplicate all of them.
- **The twin is read-only.** Commanding equipment (start, stop, setpoints) is a safety decision with its own
  interlocks and audit, and is out of scope (brief, open question 5).

## Options

**Where readings are described.**

1. **Per asset class**: `asset_class` (e.g. `cooling_tower`) owns its `telemetry_point`s; an `asset` is an instance of
   a class. Ten cooling towers share one definition and one 3D model.
2. Per asset. Every tower repeats the same points, and they drift apart.
3. In the 3D model's glTF `extras` only. The server could not validate readings or evaluate rules without parsing
   models, and an asset with no model would have no readings.

**How "abnormal" is decided.**

1. **Server-side threshold rules** per class, with an optional per-asset override, evaluated as readings arrive; a
   sustained breach creates an incident through `IncidentsService`.
2. In the console. Every console would decide on its own, nothing would reach a console that is closed, and the API
   could not record who raised what.
3. In the devices or a building management system, which publish alarms. Many devices cannot; the ones that can
   would use rules this system cannot see or audit. Still possible later as another way to raise the same incident.

**How many incidents per breach.**

1. One per reading over the limit. A flapping sensor would flood the feed.
2. **At most one open incident per (asset, rule)**, guaranteed by a partial unique index, re-armed only after the
   reading returns past a clear level (hysteresis).
3. Auto-resolve when the reading recovers. An operator would lose an incident they were handling, and a resolution
   would carry no human decision. Rejected: recovery is shown in the inspector, resolving stays human.

**Reading history.**

1. None, live only. Sparklines would start empty after every reload, and there would be nothing to look back at
   after an alarm.
2. **A PostgreSQL table, one row per asset per 5 s bucket (last value of each key), partitioned by day, kept 7
   days.** Same database, same backups, no new service.
3. TimescaleDB. Compression and continuous aggregates, but the Postgres image changes for every deployment.
4. A separate time-series database (InfluxDB, Prometheus). A new service to run, secure and back up on-prem.

## Decision

Assets are catalogue data in PostgreSQL, readings are described per asset class, threshold rules are evaluated on
the server, and a sustained breach is an ordinary incident linked to its asset.

- **Catalogue tables** (migration `AssetCatalogue`, additive):
  - `asset_class`: `id`, `code` (unique, `^[a-z][a-z0-9_]{1,31}$`, e.g. `cooling_tower`), `name`, `model_key`
    (nullable: the model file, ADR-0020; `null` draws a neutral box from `footprint_m`), `footprint_m` (width,
    depth, height in metres).
  - `telemetry_point`: `asset_class_id`, `key` (unique per class, camelCase, `^[a-z][A-Za-z0-9]{0,62}$`, e.g.
    `motorTempC`), `label`, `unit` (nullable), `kind` (`number` | `boolean` | `enum`, with a `CHECK`), `min` / `max`
    (nullable, the valid range: a reading outside it is dropped, not clamped), `enum_values` (for `enum`),
    `expected_interval_s` (how often a device sends it), `headline` (nullable rank 1–2: shown in the tooltip and the
    Assets list).
  - `asset`: `code` (unique, `^[A-Z]{2,4}-[0-9]{2,4}$`, e.g. `CT-01`), `name`, `asset_class_id`, `zone_id`,
    `longitude` / `latitude` (stored as `camera` stores its position), `elevation_m` (base above ground, e.g. 14 for
    a roof), `heading_deg` (`0 ≤ heading < 360`, clockwise from true north, as `Camera.fieldOfView`).
  - `zone.height_m` (nullable): the extrusion height of a building shell in 3D. `null` draws the client's default.
- **Threshold rules** (`telemetry_rule`): `asset_class_id`, `asset_id` (nullable: set, it overrides the class rule
  with the same `name` for that asset only), `name` (e.g. `Motor over-temperature`), `key`, `comparator` (`above` |
  `below`), `limit`, `clear` (the hysteresis level: the rule re-arms only after the reading passes it back),
  `for_s` (how long the breach must last), `severity`, `incident_type` (a `facilities` or `environment` type,
  [ADR-0021](0021-incident-categories-zone-uses-and-technician-role.md); default `equipment_fault`), `enabled`.
  Rules are seeded and changed by migration or
  database write until an editing API exists, the same position as ADR-0017's site plan.
- **Evaluation.** One replica evaluates rules (the telemetry leader, ADR-0019) as readings arrive. When a reading
  stays past `limit` for `for_s`, it creates an incident:
  - the rule's `incident_type` and `severity`, title `<rule name> — <asset name>`, the asset's zone and
    position;
  - `source` **`telemetry`** (added to `INCIDENT_SOURCES`), actor `{ kind: 'system', subject: 'telemetry',
displayName: 'Telemetry rule' }` (ADR-0011);
  - the `reported` timeline note records the evidence: `motorTempC 92 > 85 for 60 s`;
  - new nullable columns `incident.asset_id` and `incident.telemetry_rule_id`, and a **partial unique index on
    `(asset_id, telemetry_rule_id) WHERE status <> 'resolved'`**. A second breach of the same rule while its
    incident is open is a conflict and is skipped, whatever the replica or timing.
  - It goes through `IncidentsService` and the outbox (ADR-0007), so feed, toasts, KPI tiles and every replica
    receive it as they receive any incident.
  - Recovery does not resolve it. Resolving stays a person's decision.
- **Contracts.** `Asset`, `AssetClass`, `TelemetryPoint`, `TelemetryRule` (read model), `Incident.assetId: string |
null`, `'telemetry'` in `INCIDENT_SOURCES`. A client must read a missing `assetId` as `null`.
- **History** (`telemetry_sample`): `asset_id`, `bucket_at` (5 s buckets), `values` (`jsonb`, last value of each key
  in the bucket), primary key `(asset_id, bucket_at)`, `PARTITION BY RANGE (bucket_at)`, one partition per day. The
  telemetry leader writes one row per asset per bucket and keeps the next two days' partitions created; partitions
  older than `TELEMETRY_RETENTION_DAYS` (default 7) are dropped, never deleted row by row.
- **Read API**, any known role (ADR-0011), default rate limits (ADR-0012):
  - `GET /api/assets`: the catalogue with class, position, headline points and model URL;
  - `GET /api/assets/:code`: one asset with all its points and the limits of its enabled rules (the inspector's
    "Limit 85 °C");
  - `GET /api/assets/:code/telemetry?from=&to=`: samples, at most 1 h and 720 buckets per call.
  - No write routes. No command path to any device exists in the API.
- **Seed.** The demo campus gains its asset classes (cooling tower first), assets, points and rules in
  `database/seed/`, topped up on the reference campus the way ADR-0017 tops up the site plan.

## Consequences

- **One alarm path.** A telemetry breach is an incident: it is in the feed, raises a toast and the tab badge, counts
  in the KPI tiles, has a timeline and an actor, and is resolved by a person. The twin only adds where it is.
- **The catalogue is data.** A new tower is a row; a new kind of equipment is a class, its points, its rules and a
  model (ADR-0020), with no console build.
- **Rolling deploys.**
  - Every migration is additive and nullable; older replicas keep working against the new schema and never write
    `asset_id`.
  - An older console ignores `assetId` and the new routes. It shows a `telemetry` incident's reporter as a user,
    because `IncidentDetail` maps every source other than `simulator` to `user`; the console change that ships
    with this ADR must map `telemetry` to `system`. The label is wrong only during the rollout.
  - A newer console must treat `404` on `/api/assets` (an older replica) as "no assets" and draw the twin without
    equipment.
- **Rules are not instant.** A breach raises an incident after `for_s`. A leader failover restarts the timers, so
  an alarm can be late by up to `for_s` once (ADR-0019).
- **History is coarse.** 5 s buckets are enough for a 15-minute sparkline (180 points) and an after-the-fact look;
  the console's worker keeps the finer live tail. Values within a bucket other than the last are not stored.
- **Storage.** About 17,000 rows per asset per day: roughly 240,000 rows a day for the demo's 14 assets, 1.7 million
  for 100. That is an estimate to check in V2-04, not a measurement. Dropping a whole partition keeps retention
  cheap.
- **No editing API.** Changing a rule or adding an asset is a migration or a database write, as for the site plan.
  An admin UI is a follow-up, with its own permission (ADR-0011 has none for it yet).
- **Proving it.** The e2e suite seeds a class with one rule, feeds readings through the mock source (ADR-0019), and
  checks that a breach shorter than `for_s` raises nothing, a sustained one raises exactly one incident with source
  `telemetry` and the system actor, a second breach while it is open raises none, and a breach after the reading
  passed `clear` and the incident was resolved raises a new one.
- **Revisit** TimescaleDB if retention must grow past a few weeks or the catalogue past a few hundred assets.
  Revisit device-raised alarms if a building management system becomes a source.

## Open before acceptance

- Which equipment classes are in V2.0 beyond the cooling tower (brief, open question 2).
- Who owns threshold values: operations per class, with per-asset overrides, is assumed here (brief, open question 7).
- ~~Confirm the twin stays read-only (brief, open question 5).~~ Decided 2026-10-09 by the tech lead, confirmed with
  the operations lead and the facilities lead: V2.0 is read-only. "No write routes" in the Decision stands, and
  ADR-0019's broker ACL ("may publish nothing") is unchanged.
