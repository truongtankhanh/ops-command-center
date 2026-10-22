# ADR-0031: A place's plan is data: rooms on a level, and an optional position on an asset inside it

- **Status:** Accepted 2026-10-22
- **Date:** 2026-10-22
- **Context documents:** [Console V3 design brief](../design/v3/brief.md) (§ Place views, frame 25, question 18),
  [ADR-0017](0017-site-plan-as-data.md), [ADR-0018](0018-assets-and-telemetry-as-domain-data.md),
  [ADR-0020](0020-digital-twin-rendering-and-model-pipeline.md), [ADR-0023](0023-building-levels-as-data.md)

## Context

ADR-0023 gave a building levels and put an asset or an incident on one. It said, on purpose, that floor plans were not decided:
"a level shows its footprint and its devices, never rooms". That is enough to filter and to say "Level 2". It is not enough for what an
operator needs inside a building: a smoke detector is in Lab 2.02, a temperature sensor is in the hot aisle between two rack rows, a
leak sensor is in the laundry. A footprint with dots cannot say which room, and every building reads the same, although a data hall, a
laboratory corridor and a dormitory share nothing but a roof.

Frame 25 of the V3 design draws each building level and each open area as its own stylised plan: outer and interior walls, named rooms, the
few fixed props that make a place recognisable, and every device standing in its room. The tech lead decided on 2026-10-22 that the
plan is **stylised and per place**, not only a floor outline. A plan needs three things the data does not have today: rooms with names and
outlines, props, and a device's position inside its level. Assets carry `lng` and `lat` (ADR-0018), which is enough for a site-wide
dot but too coarse to tell two rooms of one building apart.

Constraints:

- **Rolling deploys** (ADR-0017, ADR-0021, ADR-0023): an older console meets a newer API and the reverse, so the change must be additive
  and everything it adds is optional. A level with no rooms must keep drawing as frame 20b does.
- **The database holds what it can check.** ADR-0023 chose a composite foreign key so that a level cannot belong to another building;
  the same reasoning applies to a room and to an asset's room.
- **No CAD import, no editor in this phase.** The demo's plans are authored in the repository as seed data, like the site plan
  (ADR-0017). A real site needs a way to author plans; this ADR does not design it.
- **The 3D chunk and its budget** (ADR-0020). A plan is drawn from a short list of boxes and polygons, never from a vendor model; the
  data must stay small enough to load with the level and be cached.
- **Migrations are append-only**, constraints are named, and a migration spells out what it does (`.claude/rules/database.md`).
- **A technician and a viewer see the same plan.** Moving the camera is not an action on the site; the plan carries no permission.

## Options

**A. Keep footprints and dots; add a room name as free text on the asset.** No schema beyond one column. It cannot draw a room, a wall or
a prop, cannot colour a room by its worst incident, and a typo creates a new room. Rejected: it is the problem again.

**B. Rooms and props as a JSON document on `building_level`.** One column, no new table. The database cannot refuse a device whose room
belongs to another level, and a bad outline is only found when the console draws it. Rejected for the same reason ADR-0023 rejected a
JSON list of levels.

**C. A `building_room` table keyed `(zone_id, level_code, code)`, with the outline and the props stored on the room, and optional
`room_code`, `plan_x` and `plan_y` on `asset` (the room as a composite foreign key).** The database refuses a room of another level and
a device in a room that does not exist; the API validates geometry. One more table and one more foreign key to keep in step with the
seed and the `down`. **Chosen.**

**D. A drawing file per place (SVG or glTF) stored beside the models.** Rich, and authors could use a tool. But it moves the data out
of the database, makes the room list and the device counts depend on parsing a file, and puts a second asset pipeline next to
`models:check`. Rejected for now; it is the natural route if a site later imports drawings, and this ADR does not close it.

## Decision

**1. Rooms are rows.** `building_room(zone_id, level_code, code, name, kind, outline, props, sort)` with the primary key
`(zone_id, level_code, code)` and a foreign key `(zone_id, level_code)` to `building_level`. `code` matches `^[A-Z0-9][A-Z0-9.-]{0,11}$`
(`HALL`, `L2.02`, `LAUNDRY`); `name` is the English label an operator reads ("Lab 2.02", "Server hall"); `sort` orders a list. `kind` is a
closed set in a named check: `hall`, `lab`, `corridor`, `wet`, `plant`, `office`, `room`, `outdoor`. The console renders an unknown
kind as `room` (the contract union can grow server-side first).

**2. The coordinate frame.** An outline is a closed polygon of at least three `[x, y]` points, in **metres east and north of the zone's
footprint centre**, the same axes as the site plan (ADR-0017), north up, no rotation. The origin is chosen for the console, not for
the author: the twin already places each building as a group at its zone's centre, so a plan is a child of that group and is drawn with
no conversion; the footprint, the roof and the level's slab are symmetrical about the same point; and the plan never needs the
building's size to be placed. (A corner origin keeps authored numbers positive, but costs an offset by half the footprint in every
draw and in every position check, and breaks if the footprint is edited.) A room's outline lies inside its zone's footprint,
and two rooms of one level may touch and must not overlap beyond a tolerance. The API validates both with a `DomainError` subclass; the
database cannot.

**3. Props.** `props` is a JSON list of `{ kind, x, y, w, d, h?, yaw? }` in the same frame, with `kind` from a **closed list** the
contract owns: `rack`, `bench`, `bed`, `desk`, `crah`, `ups`, `transformer`, `switchgear`, `chiller`, `generator`, `tank`. A prop is
decoration with a size; it has no identity, no state and no telemetry, and an asset is never a prop. A prop of an unknown kind is
skipped by the console, never an error. At most 64 props a room and 4 KB of JSON a level, so a plan loads with the level.

**4. A device's place in a plan.** `asset.room_code`, `asset.plan_x` and `asset.plan_y` are nullable. `room_code` is a composite foreign key
`(zone_id, level_code, room_code)` to `building_room` with `MATCH SIMPLE`, so a null passes and nothing that exists today is
constrained. `plan_x` and `plan_y` are metres east and north of the zone centre; when both are given the API checks that the point lies
inside the room's outline (or inside the zone's footprint when there is no room). **A device without a plan position keeps drawing as a
dot at its `lng` and `lat`**, as in frame 20b; with a position it stands there in the plan. `lng` and `lat` are not changed or replaced:
the site-wide map still needs them.

**5. An area is a zone with one level.** ADR-0023 left "levels for zones that are not buildings" open. This ADR decides it for what a plan
needs: an open area (a yard, parking, the field, the gate) has **one `building_level` row with the code `GND` and the label "Ground"**, and
its rooms are its sub-areas (a fenced yard, the transformer pad). The console draws no level selector and no word "Ground" when a zone's
only level is `GND`: the place line stays "Utility Plant". A zone with no `building_level` row at all is a **place without a plan** and
draws as today.

**6. What a console reads.** `GET /api/zones` serves `levels[].rooms` (name, kind, outline, props) and the three asset fields,
all optional on the wire and read as `[]` or `null` when absent, as `heightM` and `levelCode` are. The rooms of a level are also a
cheap second read, `GET /api/zones/:code/levels/:levelCode/rooms`, when the first response would be too large; V3-30.3 chooses and the
contract does not depend on it. A console with no rooms draws the footprint dots and says "No plan drawn yet".

**7. Who writes.** Nobody, through the API, in V3.5: rooms, props and positions are **seed data** in the repository
(`database/seed/plans.ts`, the top-up rule of ADR-0017: insert what is absent, fill only what is still empty). There is no `PUT` and no new
permission. A real site gets an editor or an import in a later ADR; until then plans are edited in the repository and deployed.

**8. The demo.** Five places: the Data Center (levels L1 and ROOF), the Science Lab level 2, Dormitory B level 3, and the Utility Plant yard
(`GND`). The other buildings keep levels without rooms. The demo's assets that name a room in a title (`SD-0043` in Lab 2.02, `LKS-B3` in
the laundry, `TS-DC-C1` in the server hall) are placed in it. The plans match frame 25.

**9. Not decided here:** an editor, an import from CAD, IFC or SVG, doors and routes between rooms, props that move or have a state,
rooms for incidents (an incident keeps its level only, ADR-0023), a plan for a level of a building that has no `building_level` rows, and
live occupancy of a room.

## Consequences

- **Rolling deploys.** Old console, new API: the extra fields are ignored. New console, old API: no rooms, so every level draws as frame
  20b and the console shows no Open plan entry for it. The migration adds one table and three nullable columns with their constraints; a
  deploy in either order is safe.
- **A table and a foreign key to keep in step** with the seed, the `down`, the entities and `GET /zones`; a room added to the seed
  without its level fails at boot, which is the point of the key. A migration takes brief locks (an empty table, three nullable columns,
  one constraint); it documents which locks and that nothing waits long (`lock_timeout` 5 s).
- **The geometry validators are the API's, not the database's.** An outline outside the footprint or a device outside its room is
  refused by a `DomainError` on seed and on any later write, with the room and the point named in the message; the seed has a spec that
  asserts every prop and every device spot lies inside its room.
- **Plans are hand-written for five places.** That is small enough to review and large enough to show the design. It does not scale to a
  real site, which is why the editor or the import is named as the next decision rather than hidden.
- **The console has two data paths for one device** (a plan position and a footprint dot). The plan model (V3-30.5) is one pure function
  that picks, so no component decides.
- **No new permission, no outbox event, no metric label.** A plan is reference data like the site plan; a room name is never logged and
  never a metric label.
- **ADR-0023 is not edited beyond a pointer.** Its point 7 said floor plans were not decided; this ADR decides them and ADR-0023 gets an
  "Extended by" line. ADR-0017 and ADR-0018 are context, not changed.

## Decided before acceptance

Settled by the tech lead on 2026-10-22: each building and area gets its own **stylised plan** with named rooms (brief § Place views,
question 18); rooms and positions are seed data in the repository for V3.5 and the authoring route is a later decision; a place without a
plan keeps the footprint dots and says so. At acceptance the same day:

1. **`GND` for areas.** An open area is a zone with one level coded `GND`, not a separate kind of record. Confirmed.
2. **The coordinate origin.** Metres from the zone's footprint centre, not from the campus centre or a building corner: the tech lead
   asked for the choice that is best for the UI, and the reason is in point 2. Confirmed.
3. **Closed lists.** The eight room kinds and eleven prop kinds; adding one is a contract change in a later PR without a new ADR.
   Confirmed.
4. **The second read.** Whether `GET /zones` carries the rooms or a per-level read does is left to V3-30.3, which measures the size of
   the demo's plans. Confirmed.
