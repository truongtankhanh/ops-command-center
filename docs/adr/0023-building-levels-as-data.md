# ADR-0023: Building levels are data: a table per building, and a nullable level on assets and incidents

- **Status:** Accepted 2026-10-22
- **Extended by:** [ADR-0031](0031-place-plans.md) (point 7: rooms and plans)
- **Date:** 2026-10-22
- **Context documents:** [Console V3 design brief](../design/v3/brief.md) (§ V3.5, "Floors"),
  [ADR-0017](0017-site-plan-as-data.md), [ADR-0018](0018-assets-and-telemetry-as-domain-data.md),
  [ADR-0021](0021-incident-categories-zone-uses-and-technician-role.md)

## Context

The demo and its titles already speak in levels: "Smoke detector — Science Lab, level 2", "Water leak — Dormitory B, level 3". The
data does not. A zone has a footprint and a `height_m`; an asset has an `elevation_m`; an incident has a zone and a position that is
only its longitude and latitude (V2-16.1). So "level 2" is text, and nothing can filter, place or validate by level.

Two places already guess one:

- `placeLabel` in `apps/console/src/lib/assets/assets.ts` says "roof" when an asset stands at its building's `heightM`, and "level n" when
  `elevationM` is a multiple of 4 ("floors are 4 m apart, ground is level 1").
- `docs/design/v2/asset-classes.md` § Demo assets states the same rule ("level _n_ is 4 (_n_ − 1)").

A guess made in every client cannot name a mezzanine or a basement, cannot say which floor an **incident** is on (it has no elevation
at all), and cannot be checked by the database. V3.5 wants a level selector at building level, a level on the report form and a place
line that reads "Science Lab · Level 2" from data.

Constraints:

- **Rolling deploys** (ADR-0017, ADR-0021): an older console meets a newer API and the reverse, so the change must be additive.
- **V2-16.1:** an incident keeps only its longitude and latitude; the height of the report pin is not stored. This ADR must not
  reopen that.
- **Migrations are append-only**, constraints are named, and a migration spells out what it does (`.claude/rules/database.md`).
- **The site plan holds footprints, not floor plans** (ADR-0017): there are no rooms to draw, and none are invented.

## Options

**A. Keep inferring the level from `elevation_m` and the 4 m convention.** No schema. It cannot name a mezzanine or a basement, cannot
say which floor an incident is on, and every client repeats the rule. Rejected: it is the problem.

**B. A `levels` JSON list on `zone`, plus a free `level_code` on `asset` and `incident`.** One column per table, no new table. The
database cannot refuse a level the building does not have, so a typo or a copy between buildings goes in silently. Rejected: the
constraint that matters (a level belongs to its building) is the one it cannot hold.

**C. A `building_level` table keyed `(zone_id, code)`, and `level_code` on `asset` and `incident` as a composite foreign key to it.**
The database refuses a level that belongs to another building. With `MATCH SIMPLE` a `NULL` level passes, so nothing that exists
today is constrained. One more table and two foreign keys to keep in step with the seed and the `down`. **Chosen.**

## Decision

**1. Levels are rows.** `building_level(zone_id, code, label, elevation_m, sort)` with the primary key `(zone_id, code)`, a unique
`(zone_id, sort)`, `code` matching `^[A-Z0-9]{1,8}$` (`L1`, `L2`, `B1`, `ROOF`) and `elevation_m >= 0`. Levels are ordered by `sort`. A
`ROOF` level at the building's `height_m` is a level like any other. Labels are English words: "Level 2", "Roof".

**2. The level on an asset and an incident is optional and means "not stated".** `asset.level_code` and `incident.level_code` are
nullable, and each is a composite foreign key `(zone_id, level_code)` to `building_level`. The structured field is what filters and
places; a title's "level 2" stays text and is not parsed.

**3. Who sets it.** A **telemetry incident copies its asset's `level_code`**. An operator's incident takes the level the reporter
picked after the zone, or none. A technician reports with a level exactly as an operator does (it is not a category-scoped action).

**4. The incident's position stays `[lng, lat]`.** A level is a separate, coarse field, not a height: V2-16.1's rule (the pin's
height is not stored) holds unchanged. Confirmed by the tech lead on 2026-10-21.

**5. The demo's levels are the existing convention made data:** levels at 0, 4, 8 … m below a building's `height_m`, then `ROOF` at
`height_m`; `GEN-01`, which stands 3 m outside the Data Center, is seeded to its `L1`, as `placeLabel` already says.

**6. Contract.** `Zone.levels`, `Asset.levelCode`, `Incident.levelCode` and `ReportIncidentRequest.levelCode`, all optional on the
wire and read as `[]` or `null` when absent, as `heightM` and `assetId` are today. `placeLabel`'s inference remains as the fallback
for an older API.

**7. Not decided here:** floor plans (a level shows its footprint and its devices, never rooms), a level for a part, and levels for
zones that are not buildings.

## Consequences

- **Rolling deploys.** Old console, new API: the extra fields are ignored. New console, old API: no `levels`, so the console falls
  back to the inference and draws no selector, and the report form sends no `levelCode`. Either order is safe; the migration only
  adds a table and two nullable columns.
- **A table and two foreign keys to keep in step** with the seed, the `down` and the entities; `GET /zones` grows by the levels; an
  incident's `levelCode` appears in every `incident.*` event (additive).
- **The place line is data.** "Science Lab · Level 2" comes from the level, not from `elevation_m`, and the visible words change from
  "level 3" and "roof" to "Level 3" and "Roof" (decided by the tech lead).
- **A migration takes brief locks.** It creates one empty table and adds two nullable columns plus their constraints; the migration
  documents which locks it takes and that nothing waits for long (`lock_timeout` 5 s).
- ADR-0017, ADR-0018 and ADR-0021 are **not edited**: this ADR extends the catalogue's data, not its rules, and names them as context.

## Decided before acceptance

Settled by the tech lead on 2026-10-21 and 2026-10-22: levels as a table (brief Q15); an incident may carry a `level_code` without
breaking V2-16.1; the data's labels are the words operators read; `GEN-01` is `L1`.
