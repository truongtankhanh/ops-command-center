# ADR-0021: Incidents are grouped in categories, zones carry a use, and technicians handle facilities incidents

- **Status:** Proposed
- **Date:** 2026-10-08
- **Context documents:** [Console V2 design brief](../design/v2/brief.md), [ADR-0011](0011-role-based-authorization-and-timeline-actor.md), [ADR-0018](0018-assets-and-telemetry-as-domain-data.md)

## Context

V2 widens the product from a security console to the operations console of a whole campus: security, safety,
medical response and the technical operation of buildings (brief V2, "Campus model"). The current model was sized
for the first demo:

- **Six incident types** (`intrusion`, `fire_alarm`, `equipment_fault`, `medical`, `crowding`,
  `suspicious_object`). A real campus also sees thefts, assaults, gas leaks, lab spills, power outages, water leaks,
  people trapped in lifts, storms, flooding and traffic accidents. `equipment_fault` alone cannot tell a broken
  camera from a power cut.
- **Four zone kinds** (`building`, `parking`, `gate`, `outdoor`), which say how a zone is drawn, not what it is used
  for. A dormitory, a chemistry lab and a data center are all `building`, although they carry different risks,
  different after-hours rules and different likely incidents.
- **Three roles** (`operator`, `supervisor`, `viewer`, ADR-0011). Technical staff who fix leaks and lifts would have
  to be operators, with the right to acknowledge and resolve security incidents they should not touch.

Constraints:

- **The type list is a contract** in `@occ/contracts`, enforced by `CHECK` constraints on `incident.type`,
  `incident.source` and `zone.kind` (initial schema, ADR-0004).
- **Rolling deploys** (ADR-0017): older consoles meet newer APIs.
- **One permission model** for REST and sockets, enforced by the API (ADR-0011).
- **The report form is used under stress.** Twenty-odd types in one grid is too long to scan during a shift.

## Options

**Organising incident types.**

1. A flat list of about 24 types. Simple, but the report form and the filters become long lists.
2. **Two levels: a fixed category per type**, defined in contracts (`categoryOf(type)`), not stored. The form asks
   for the category, then the type; filters and permissions can work per category.
3. Free categories and types as data, editable per site. Flexible, but every client must handle types it has never
   seen, and permissions would depend on data an administrator can change.

**What a zone is.**

1. Many more `kind` values (`dormitory`, `lab`, …). Mixes drawing with meaning; every new use is a renderer change.
2. **Keep `kind` for drawing, add a few kinds that draw differently (`sports`, `utility`, `water`), and add a nullable
   `use` for buildings** (`academic`, `laboratory`, `residential`, …).

**Technical staff.**

1. Use `operator` accounts. Every technician can act on every incident.
2. **A `technician` role that may report anything and acknowledge or resolve only the `facilities` and
   `environment` categories.**
3. Per-category permissions for every role (`incident:resolve:security`, …). Most precise, but multiplies the
   permission list by six for one real need.

## Decision

Two-level incident types with a fixed category, zone kinds plus a building use, and a `technician` role scoped by
category.

- **Categories** (`INCIDENT_CATEGORIES`) and their types (`INCIDENT_TYPES`, the six existing ones kept, with their
  ids):

  | Category      | Types (default severity)                                                                                                                                |
  | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `security`    | `intrusion` (high), `theft` (medium), `vandalism` (low), `suspicious_object` (medium), `suspicious_person` (medium), `assault` (high), `crowding` (low) |
  | `fire_safety` | `fire_alarm` (high), `fire` (critical), `gas_leak` (critical), `hazmat_spill` (high)                                                                    |
  | `medical`     | `medical` (medical emergency, high), `injury` (medium)                                                                                                  |
  | `facilities`  | `equipment_fault` (medium), `power_outage` (high), `water_leak` (medium), `lift_entrapment` (high), `hvac_fault` (medium), `network_outage` (medium)    |
  | `environment` | `severe_weather` (high), `flooding` (high), `fallen_tree` (medium)                                                                                      |
  | `traffic`     | `traffic_accident` (high), `blocked_access` (low)                                                                                                       |
  - `INCIDENT_TYPE_CATEGORY: Record<IncidentType, IncidentCategory>` and `categoryOf(type)` live in contracts. The
    category is derived, never stored, so it cannot disagree with the type.
  - `INCIDENT_TYPE_DEFAULT_SEVERITY` suggests a severity in the report form: the value in brackets above. The
    reporter can change it; the API does not enforce it.
  - Every type keeps its own icon (V1 brief); the category is the first step of the report form, a feed filter and
    the permission scope below.

- **Zones.**
  - `ZONE_KINDS` gains `sports`, `utility` (fenced plant yards and substations) and `water`.
  - New nullable `zone.use` for `building` zones: `academic`, `library`, `laboratory`, `residential`, `dining`,
    `healthcare`, `sports_hall`, `administration`, `data_center`, `security_post`, `utility_plant`. A `CHECK`
    keeps it null for non-buildings.
  - `use` drives suggestions only: the report form lists the types most likely for the picked zone first (a lab
    suggests `hazmat_spill`). It does not restrict anything.
- **Role `technician`** (`ROLES` gains it; the realm gains the role and a demo user `technician`):
  - reads everything, as every known role does (ADR-0011);
  - holds `incident:report` for every category;
  - holds `incident:acknowledge` and `incident:resolve` **only for `facilities` and `environment`**.
  - `ROLE_PERMISSIONS` stays as it is; a new `ROLE_CATEGORY_SCOPE: Record<Role, readonly IncidentCategory[] | 'all'>`
    limits acknowledge and resolve. `operator` and `supervisor` are `'all'`; `viewer` has no permission to scope.
    The API checks the permission first (`RolesGuard`, `@RequirePermission`), then, once the incident is loaded in
    the service, its category against the scope, and answers `403` "Not allowed for this category" (the `message` of
    the existing `ApiErrorDto`) when it is out of scope.
  - The console uses the same table to show a view-only footer on out-of-scope incidents, as it does for viewers,
    and adds a "Mine to handle" tab (brief, frame 09).
- **Telemetry rules** (ADR-0018) may raise only `facilities` or `environment` types; a rule names its type
  (default `equipment_fault`).
- **Migration** `IncidentCategoriesAndZoneUse`: replaces the `CHECK` constraints on `incident.type`, `zone.kind` and
  `incident.source` (with `telemetry` from ADR-0018; today unnamed inline checks, so Postgres named them
  `incident_type_check`, `zone_kind_check` and `incident_source_check`), adds `zone.use` with its `CHECK`. Types and
  kinds are only added, never renamed, so existing rows stay valid. Column widths (`varchar(32)`, `varchar(16)`) already
  fit.
- **Seed.** The demo campus gains the zones drawn in the brief (dormitories, Science Lab, Health Clinic, Sports
  Hall, Admin Building, Utility Plant, East Gate, East Parking, Lake, Security office) and the simulator draws from
  the full type list, weighted towards the common ones. The simulator picks a zone first and then a scenario allowed
  for that zone's kind, and fails when none is (`pickWeighted([])` in `scenarios.ts`), so `SCENARIOS` gains a
  weighted scenario per new type and covers every zone kind in use, including `utility` and `water`. No demo zone
  uses `sports` yet (the Sports Field stays `outdoor`).

## Consequences

- **The console names what happened.** A power cut, a leak and a broken camera are different types, filterable and
  countable, instead of one `equipment_fault`.
- **Technicians work in the same console** without the right to resolve a security incident. The scope is enforced
  by the API; hiding buttons is only presentation.
- **Rolling deploys.**
  - An older console **fails** on a new type, not only shows it without an icon: `incidentTypeIcon()` returns
    `undefined`, so the incident list region, the incident sheet and the map tooltip fall to their error state, the
    label is empty and the map marker is never drawn (its image is built only for known types). A new zone kind
    (`utility`, `water`) breaks the sheet the same way through `zoneKindIcon()`. The console change that ships with
    this ADR must render an unknown type or kind with a generic icon and its raw id, and be deployed before the API
    starts producing new types or the seed adds new kinds (the simulator is the first producer).
  - An older replica refuses new types on insert after the migration only if it validates against its own list; it does
    (`class-validator` on `ReportIncidentDto`, `@IsIn(INCIDENT_TYPES)`). Deploy all replicas together, as for ADR-0011.
- **The IdP contract grows**: a real deployment's IdP must also issue `technician` in `realm_access.roles` for
  technical staff.
- **Fixed lists.** A site that needs a type not listed here needs a contract change and a release; that is the cost
  of keeping categories, icons and permissions consistent. Revisit option 3 if several sites need different lists.
- **Proving it.**
  - Unit: every type has exactly one category and a default severity; `categoryOf` covers `INCIDENT_TYPES`.
  - e2e: a technician can report a `fire_alarm` but gets `403` acknowledging it, and can acknowledge and resolve a
    `water_leak`; an operator can act on both; a viewer on neither.
  - Migration: existing incidents and zones survive; `zone.use` on a parking zone is refused.

## Open before acceptance

- ~~Confirm the type list with the campus's security and facilities leads; the list here follows common campus
  practice, not a specific site's procedures.~~ Decided 2026-10-09 by the tech lead, confirmed with the security lead
  and the facilities lead: the six categories and 24 types above are final, unchanged, with the default severities
  now in the table. The technician scope (acknowledge and resolve `facilities` and `environment` only) is confirmed.
  Telemetry rules stay limited to `facilities` and `environment`: a gas detector's alarm stays with the gas detection
  panel, and telemetry never raises `gas_leak` or any other `fire_safety` type.
- ~~Whether `supervisor` gets anything a technician or operator does not (still open since ADR-0011).~~ Decided
  2026-10-09 by the tech lead: no supervisor-only rights in V2. `supervisor` keeps the same rights as `operator`;
  supervisor-only actions stay a follow-up of ADR-0011.
