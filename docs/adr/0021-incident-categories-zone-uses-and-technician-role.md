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

  | Category      | Types                                                                                              |
  | ------------- | -------------------------------------------------------------------------------------------------- |
  | `security`    | `intrusion`, `theft`, `vandalism`, `suspicious_object`, `suspicious_person`, `assault`, `crowding` |
  | `fire_safety` | `fire_alarm`, `fire`, `gas_leak`, `hazmat_spill`                                                   |
  | `medical`     | `medical` (medical emergency), `injury`                                                            |
  | `facilities`  | `equipment_fault`, `power_outage`, `water_leak`, `lift_entrapment`, `hvac_fault`, `network_outage` |
  | `environment` | `severe_weather`, `flooding`, `fallen_tree`                                                        |
  | `traffic`     | `traffic_accident`, `blocked_access`                                                               |
  - `INCIDENT_TYPE_CATEGORY: Record<IncidentType, IncidentCategory>` and `categoryOf(type)` live in contracts. The
    category is derived, never stored, so it cannot disagree with the type.
  - `INCIDENT_TYPE_DEFAULT_SEVERITY` suggests a severity in the report form (e.g. `lift_entrapment` → `high`,
    `fire` → `critical`). The reporter can change it; the API does not enforce it.
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
    The API checks the permission first, then the incident's category against the scope, and answers `403`
    "Not allowed for this category" when it is out of scope.
  - The console uses the same table to show a view-only footer on out-of-scope incidents, as it does for viewers,
    and adds a "Mine to handle" tab (brief, frame 09).
- **Telemetry rules** (ADR-0018) may raise only `facilities` or `environment` types; a rule names its type
  (default `equipment_fault`).
- **Migration** `IncidentCategoriesAndZoneUse`: replaces the `CHECK` constraints on `incident.type`, `zone.kind` and
  `incident.source` (with `telemetry` from ADR-0018), adds `zone.use` with its `CHECK`. Types and kinds are only
  added, never renamed, so existing rows stay valid. Column widths (`varchar(32)`, `varchar(16)`) already fit.
- **Seed.** The demo campus gains the zones drawn in the brief (dormitories, Science Lab, Health Clinic, Sports
  Hall, Admin Building, Utility Plant, East Gate, East Parking, Lake, Security office) and the simulator draws from
  the full type list, weighted towards the common ones.

## Consequences

- **The console names what happened.** A power cut, a leak and a broken camera are different types, filterable and
  countable, instead of one `equipment_fault`.
- **Technicians work in the same console** without the right to resolve a security incident. The scope is enforced
  by the API; hiding buttons is only presentation.
- **Rolling deploys.**
  - An older console receiving a new type has no icon or label for it. The console change that ships with this ADR
    must render an unknown type with a generic icon and its raw id, and be deployed before the API starts
    producing new types (the simulator is the first producer).
  - An older replica refuses new types on insert after the migration only if it validates against its own list; it
    does (`class-validator` on `ReportIncidentRequest`). Deploy all replicas together, as for ADR-0011.
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

- Confirm the type list with the campus's security and facilities leads; the list here follows common campus
  practice, not a specific site's procedures.
- Whether `supervisor` gets anything a technician or operator does not (still open since ADR-0011).
