# ADR-0017: The site plan and camera fields of view are data served by the API

- **Status:** Accepted
- **Date:** 2026-10-06

## Context

UI-09 drew the campus site plan (boundary, roads, sports-field markings) from a console module,
`apps/console/src/lib/sitePlan.ts`, in metres from a copy of the seed's `CAMPUS_CENTER`, and it left out camera
field-of-view cones because `Camera` had no orientation. Both shortcuts (UI-09 decisions D1 and D4) kept that change
React-only.

Both now cost more than they save:

- The geometry is data about one campus, compiled into the client. A second campus (the header's future site
  switcher) would need a console build, and the copied centre can drift from the seed.
- Without a field of view, an operator cannot see which camera actually covers an incident.

Constraints:

- **Migrations only, run at boot in one transaction** (ADR-0004), with several replicas (ADR-0008).
- **Rolling deploys.** An older console can meet a newer API, and a newer console an older replica, for as long as a
  rollout takes.
- **Seeding is demo-only** (IMP-04: `SEED_ON_BOOT` needs `DEMO_MODE` in production). The demo campus must not end up
  in a real database.
- **Camera metadata may later come from a VMS** (roadmap OCC-28), which may not know a camera's orientation.

## Options

**Table shape for the site plan.**

1. **`site` (one row per campus) + `site_feature` (one row per drawn feature: `part`, GeoJSON `geometry`,
   `sort_order`).**
2. One `site_plan` row with a column per part (`boundary`, `roads`, `details`). Every new kind of feature is a schema
   change.
3. One jsonb FeatureCollection. The database cannot constrain anything inside it.

**Stored form of the geometry.**

1. **Pre-computed `[lng, lat]` rings and lines** (as `zone.polygon`). Any client only draws.
2. Metre primitives (`roundedRect`, `circle`) relative to the site centre. Every client would rebuild the same
   geometry.

**Building footprints and parking rows.**

1. **A client drawing rule over the zones** (inset 8 m; rows 15 m apart). Generic, so a second campus needs no build,
   and they cannot drift from the zones.
2. Persisted as features. Any zone edit would leave them stale.
3. Derived by the API. That moves a rendering choice into the API for no gain.

**Databases seeded before this change.**

1. **The seed tops up what it owns** (site plan, missing fields of view) on the reference campus only, under the seed
   lock. A demo volume upgrades by restarting.
2. A data migration inserting the demo campus. It would write fictional data into every database, production
   included.
3. No top-up; reset the demo volume. That breaks ADR-0004's "pull the new image, restart" upgrade.

**Camera orientation.**

1. **One nullable `fieldOfView: { heading, angle, range }`, all three set or all null** (a `CHECK`).
2. `NOT NULL` with a default heading. That would be a made-up fact drawn on the map.
3. Three flat nullable fields. "All or none" would then be a rule clients must know, not a shape.

## Decision

- **`GET /api/site-plan`** returns `SitePlan { id, code, name, center, features }` from `site` + `site_feature`.
  Features are `{ part: 'boundary' | 'road' | 'field', geometry: Polygon | LineString }`, in drawing order. When no
  site exists, the answer is **404** (`Site plan was not found`). The route is a read: any known role may call it,
  under the default rate limit (ADR-0011, ADR-0012).
- **The contract types are our own**, structurally GeoJSON (`SiteGeometry`), so `@occ/contracts` stays
  dependency-free.
- **Footprints and parking rows stay a client drawing rule** over the zones (Option 1 above).
- **`Camera.fieldOfView`** is `{ heading, angle, range } | null`: heading in degrees clockwise from true north
  (`0 ≤ heading < 360`), angle in degrees (`0 < angle ≤ 360`), range in metres (`> 0`). It is stored as
  `fov_heading_deg`, `fov_angle_deg` and `fov_range_m`, with `camera_field_of_view_check`. `null` means unknown, and
  clients draw no cone.
- **Seed.** The demo campus's plan and the twelve cameras' fields of view live in `database/seed/campus.ts`. They
  were authored in metres from `CAMPUS_CENTER`; the plan was moved there verbatim from the console. With
  `SEED_ON_BOOT`:
  - an empty database gets everything;
  - a database seeded before this change gets only what is missing, when every seed zone code exists;
  - a boot with nothing to add skips the lock.
- **Migrations** `SitePlan` (two new tables) and `CameraFieldOfView` (three nullable columns, no default:
  catalog-only) are additive, and their `down` drops what they added.

## Consequences

- **A site's geometry changes without a console build.** Changing it is a database write, until an editing API exists
  (not decided here).
- **One site is served.** Zones and cameras do not reference a site yet, so `GET /api/site-plan` returns the first by
  `code`. The multi-site switcher needs `zone.site_id` (and probably `camera.site_id`) and a site-scoped route. That
  is a follow-up, not decided here.
- **Rolling deploys are safe in both directions.**
  - An older console ignores `fieldOfView` and never calls the new route.
  - A newer console must read a missing `fieldOfView` like `null`, and a `404` site plan as "draw the zones only".
    The 404 is also what an older replica answers, because the route does not exist there.
  - Older replicas keep working against the migrated schema.
- **The demo seed is no longer "once, on an empty database"**: on the reference campus, it fills in what later
  versions add. A seed camera whose field of view is set back to NULL is filled in again at the next boot. That is
  acceptable for demo data only.
- **Reverses UI-09 D1 and D4.** The console's `lib/sitePlan.ts` keeps only the footprint and parking-row rules once the
  console half of IMP-24 lands.
- **A camera synced from a VMS (OCC-28)** can arrive without an orientation; it simply has no cone.
