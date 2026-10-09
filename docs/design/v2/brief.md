# Console V2 — 3D digital twin: design brief and spec

Status: **draft for review** (V2-01, 2026-10-08). Mockups: [Ops Console V2 — Digital Twin](https://claude.ai/artifact/7Snsv6XonSMMYRbXSWejbT)
(design canvas, private until shared from its Share menu). Source of every frame: [mockups/](mockups/) —
`Main.dc.html` is frame 00, the rest are numbered like the frames. As in V1, they render on the canvas only (they
load its `support.js` runtime); read them for markup and values, not in a browser.

V2 replaces the console's 2D map stage with a 3D digital twin of the campus and its equipment, driven by live
telemetry. It builds on the approved V1 brief ([../brief.md](../brief.md)); everything V1 decided still holds unless
this document says otherwise.

**Product scope (confirmed 2026-10-08).** V2 turns the security console into the operations console of the whole
campus: security, safety, medical response **and** the technical operation of buildings and equipment, for the
security team and the facilities team in one place. It monitors equipment; it never commands it.

Every 3D view in the mockups (frames 01–06, 08, 09) is one shared, **interactive** component,
[mockups/TwinScene.dc.html](mockups/TwinScene.dc.html): a canvas stand-in for the WebGL build, drawn from 3D data in
metres (the real site-plan coordinates of V1, the cooling tower and the generator). On the canvas, press Play on a
frame and:

- **drag** to orbit 360° and tilt (20°–78° from vertical, the spec's limits), **Shift + drag** or right-drag to pan,
  **wheel** to zoom toward the cursor;
- use the camera buttons (zoom, rotate ±30°, reset) and the compass (face north);
- **hover** a building or part for the highlight and tooltip, **click** to select; callout leaders follow their part;
  in frame 09, click the ground to move the location pin.

It fixes layout, states, colour, copy and the camera behaviour — not the final lighting or model detail, which the
WebGL build and the models decide. It draws with an orthographic camera and painter's ordering, which the three.js
build replaces with a depth buffer (ADR-0020).

## Requirements and how V2 meets them

| #   | Requirement                                                                  | Decision                                                                                                                                                                                              | Frame      |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| R1  | Ultra-light models: `.glb`, < 50,000 polygons, 1K textures                   | glTF 2.0 binary only; ≤ 50,000 triangles per asset, ≤ 250,000 on screen; 1024² KTX2 textures; Meshopt geometry; ≤ 1.5 MB per file. Checked in CI on every `.glb` ([Model contract](#model-contract)). | 00         |
| R2  | Parts grouped and named so code can move each one                            | One model per asset class; one node per moving or state-bearing part, named by its role (`FanBlade`), pivot on its axis of motion, binding metadata in glTF `extras`.                                 | 00, 03     |
| R3  | Real-time over WebSockets/MQTT, interpolated to a smooth 60 FPS              | Devices → MQTT broker → API bridge → Socket.IO `/telemetry` → Web Worker → render loop. The render loop eases every bound node toward its latest target with a frame-rate-independent lerp.           | 00, 03, 05 |
| R4  | Orbit / zoom / pan with distance limits; hover colour; click for a spec card | Damped orbit camera with distance, tilt and pan clamps. Hover = accent tint + tooltip; click = part callout + asset inspector.                                                                        | 00, 02, 03 |
| R5  | No dynamic shadows; IoT processing off the render thread                     | Baked ambient occlusion + one blob shadow decal; no shadow maps. Telemetry is parsed and buffered in a worker; the main thread only reads one snapshot per frame.                                     | 00         |

## What changes, what stays

| Area                                     | V2                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Header, KPI tiles, toasts, sheet, tokens | **Unchanged.** One addition: a second connection pill, `Telemetry`, next to `Live` (frames 01, 05).                       |
| Feed                                     | Becomes a side panel with two tabs: **Incidents** (V1 feed, unchanged) and **Assets** (new list, grouped by zone).        |
| Map stage                                | **3D twin by default**, with a `3D / 2D` switch. The V1 MapLibre map stays as the 2D view and as the fallback (frame 07). |
| Camera strip                             | Unchanged; when an asset is selected, the cameras covering it come first (as V1 does for an incident's zone).             |
| Detail sheet                             | Same 440 px overlay; a new **asset inspector** variant (frames 03, 05) next to the incident detail.                       |
| Icons                                    | Lucide, as V1. New glyphs: `fan`, `thermometer`, `zap`, `activity`, `pause`, `rotate-ccw/cw`, `house`, `box`, `map`.      |

## Campus model

Decided in [ADR-0021](../../adr/0021-incident-categories-zone-uses-and-technician-role.md); this section is the
design view of it.

### Users

| Role                   | Who                                             | In the console                                                                                                                               |
| ---------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `operator`             | Security operator on shift                      | Reports, acknowledges and resolves every category                                                                                            |
| `supervisor`           | Shift lead                                      | Same as operator today                                                                                                                       |
| **`technician`** (new) | Facilities technician (electrical, HVAC, lifts) | Reads everything, reports any category, acknowledges and resolves **Facilities** and **Environment** only; a "Mine to handle" tab (frame 09) |
| `viewer`               | Management, other teams, video wall             | Reads everything, changes nothing                                                                                                            |

On an incident outside a technician's categories, the sheet ends in the same designed view-only footer as for a
viewer ("Security incidents are handled by operators"), never a gap (frame 11).

**Viewer in V2** (frame 17). V1's rule carries over to every new screen: a hidden action never leaves a hole, and the
API's `403` stays the real control.

| Screen                                  | For a viewer                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| Header                                  | No "Report incident"; the account shows "View only" (V1 frame 06)                             |
| Asset inspector (frames 03, 05, 08, 15) | "Report a fault" is replaced by the view-only footer; "Focus" stays                           |
| Incident raised by telemetry (frame 10) | No note, Acknowledge or Resolve: the view-only footer; "Show in 3D" stays                     |
| Critical toast (frame 04)               | "Fly to" and "Open incident" only                                                             |
| Keyboard help (frame 16)                | No `N`, `A`, `R`; `F`, `V` and the 3D view's keys stay                                        |
| 3D view, Assets tab, overlays, 2D view  | Unchanged: orbit, zoom, hover, inspect, heat overlay and readings are all reading, not acting |

### Zones of the demo campus

`kind` says how a zone is drawn; `use` (buildings only) says what it is for and orders the report form's type
suggestions.

| Zone                             | Kind     | Use              | Typical incidents                                  |
| -------------------------------- | -------- | ---------------- | -------------------------------------------------- |
| Lecture Hall A                   | building | `academic`       | Crowding, medical, fire alarm                      |
| Library                          | building | `library`        | Theft, fire alarm                                  |
| Innovation Hub                   | building | `academic`       | Intrusion, equipment fault                         |
| Science Lab (new)                | building | `laboratory`     | Hazmat spill, gas leak, fire alarm                 |
| Data Center                      | building | `data_center`    | Equipment fault, power outage, intrusion           |
| Student Center                   | building | `dining`         | Suspicious object, crowding, injury                |
| Dormitory A, Dormitory B (new)   | building | `residential`    | Water leak, lift entrapment, fire alarm, theft     |
| Health Clinic (new)              | building | `healthcare`     | Medical, power outage                              |
| Sports Hall (new)                | building | `sports_hall`    | Injury, crowding                                   |
| Admin Building (new)             | building | `administration` | Intrusion, network outage                          |
| Security office (new)            | building | `security_post`  | —                                                  |
| Utility Plant (new)              | utility  | —                | Power outage, equipment fault, intrusion           |
| Sports Field, Central Lawn       | outdoor  | —                | Injury, severe weather, fallen tree                |
| Lake (new)                       | water    | —                | Medical (drowning risk), flooding                  |
| West Parking, East Parking (new) | parking  | —                | Theft, vandalism, blocked access, traffic accident |
| Main Gate, East Gate (new)       | gate     | —                | Crowding, traffic accident, intrusion              |

### Incident categories

Two levels: six fixed categories, each type in exactly one. Every type keeps its own icon (V1); the category is the
first step of the report form (frame 09), a feed filter and the technician's permission scope.

| Category      | Types                                                                                  | Acknowledge / resolve  |
| ------------- | -------------------------------------------------------------------------------------- | ---------------------- |
| Security      | Intrusion, Theft, Vandalism, Suspicious object, Suspicious person, Assault, Crowding   | Operators              |
| Fire & safety | Fire alarm, Fire, Gas leak, Hazmat spill                                               | Operators              |
| Medical       | Medical emergency, Injury                                                              | Operators              |
| Facilities    | Equipment fault, Power outage, Water leak, Lift entrapment, HVAC fault, Network outage | Operators, technicians |
| Environment   | Severe weather, Flooding, Fallen tree                                                  | Operators, technicians |
| Traffic       | Traffic accident, Blocked access                                                       | Operators              |

Report form (frame 09): **1. Category** (six tiles) → **2. Type** (the category's types; types likely for the picked
zone first) → severity, pre-selected from the type's default and always changeable → location, typed or picked in
3D → description. Telemetry rules raise only Facilities or Environment types (ADR-0018).

## Principles

V1's seven principles still apply. V2 adds:

1. **The twin is a view, not a second source of truth.** Every number in 3D is also in the Assets tab and the
   inspector. Nothing is only discoverable by looking at the scene.
2. **Severity is still the only loud colour.** Parts are one neutral material. Hover and selection use the accent.
   A part takes a severity colour only while an incident it raised is open. The telemetry overlay uses one
   sequential hue (the accent's), never red, orange, yellow or cyan.
3. **Never pretend to be live.** When telemetry stops, parts stop moving, turn grey with dashed edges, and every
   value shows its age (frame 05). Motion means data is arriving.
4. **The view never moves on its own.** No idle rotation, no auto fly-to on an alarm; the toast offers "Fly to"
   (frame 04). The operator owns the camera. **One exception, the video wall** (frame 18): nobody holds its camera,
   so on a new critical incident it flies to it, shows a countdown, and returns to its fixed campus view after 60 s
   (or once the incident is acknowledged). It never rotates when idle. **And the sign-in page** (frame 19): its
   decorative campus turns slowly (2° a second), because nothing on it is being watched; reduced motion stops it.
5. **3D is progressive.** The site plan, incidents and cameras appear before any model; a device without WebGL 2
   gets the 2D map with a one-line reason (frames 06, 07).

## Scene levels and interaction

Four levels, shown in a breadcrumb (`Campus › Data Center › CT-01`):

| Level    | Enter by                              | Shows                                                                         |
| -------- | ------------------------------------- | ----------------------------------------------------------------------------- |
| Campus   | Default; `Home`                       | Buildings as shells, zones, incident beacons, cameras, asset markers          |
| Building | Click a building; `Esc` from an asset | Rooftop and plant equipment of that building; other buildings at 18 % opacity |
| Asset    | Click an asset (scene or Assets tab)  | Asset isolated, inspector open, camera flown to fit it                        |
| Part     | Click a part of the isolated asset    | Part outlined, callout anchored to it, matching row selected in Parts         |

- **Hover** (frame 02): the part takes the hover tint and a 1 px accent edge, the cursor becomes a pointer, and a
  tooltip appears after 150 ms with name, code, state and two key readings. The tooltip is never interactive. The
  matching row in the Assets tab highlights, and hovering a row highlights the part (two-way).
- **Click** (frame 03): selects. The camera flies to fit the selection (600 ms ease-out, instant with
  `prefers-reduced-motion`). An asset opens the inspector sheet; a part also opens its callout, a spec card joined
  to the part by a leader line that follows the part as the camera moves.
- **Escape** goes up one level and closes the callout first; it never discards anything (V1 rule).
- **Picking** uses a BVH-accelerated raycast against a merged pick mesh, throttled to the frame, so hover costs
  < 0.5 ms with 250,000 triangles.

### Camera limits

| Limit        | Value                                                          |
| ------------ | -------------------------------------------------------------- |
| Distance     | Campus 60 – 900 m; asset 4 – 40 m (recomputed from its bounds) |
| Tilt (polar) | 20° – 78° from vertical: never under the ground, never flat    |
| Pan          | Target clamped to the site boundary + 40 m                     |
| Zoom         | Toward the cursor                                              |
| Damping      | 0.12; settles in ≈ 300 ms                                      |
| Fly-to       | 600 ms ease-out; 0 ms with reduced motion                      |

### Keyboard

The `?` help (frame 16) lists every key; V2 adds the rows marked "New" to V1's `SHORTCUTS` (`lib/shortcuts.ts`).

| Where                       | Keys                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| Anywhere                    | `V` switch 3D / 2D; `F` fly to the selection (incident, asset or part)                                   |
| Incident panel              | `F` show the incident's asset in 3D (next to V1's `A`, `R`, `Esc`)                                       |
| Asset inspector             | `F` fly to the asset or selected part; `Esc` closes the part callout, then the inspector                 |
| 3D view, while it has focus | `←` `→` orbit, `↑` `↓` tilt, `Shift` + arrows pan, `+` / `−` zoom, `Home` reset view, `Esc` up one level |
| 3D view, pointer and touch  | drag rotate, Shift-drag / right-drag / two-finger drag pan, wheel / pinch zoom, click select             |

- **`Home` resets the view only while the 3D view has focus.** Everywhere else `Home` keeps V1's meaning (first item
  in a list or tab row), so the two never collide. Arrows and `+` / `−` are scoped the same way.
- `F` and `V` are single-key shortcuts: they sit behind the account menu's "single-key shortcuts" switch (WCAG 2.1.4,
  UI-16) and disappear from the help when it is off.
- As in V1, the help lists only what the user may do: a viewer sees no `N`, `A`, `R`; a technician sees `A` and `R`
  described as "Facilities and Environment incidents" (ADR-0021).

### Sign-in

The console has no sign-in form of its own: it redirects to the identity provider (ADR-0010), so the page in frame 19
is a **Keycloak login theme** (`occ`, under `ops/keycloak/themes/`, set as the realm's `loginTheme`), styled with the
console's tokens.

- **The backdrop carries no site data.** The page is public, so it shows shapes only: no labels, cameras, incidents,
  assets or readings, and it cannot call the API (everything there needs a token). Ship it as a pre-rendered loop or
  image of a stylised campus, not as live three.js in Keycloak.
- The form is Keycloak's own (username, password, remember me, forgot password); the theme only restyles it, so
  MFA and federation keep working. Errors use Keycloak's messages in the card.
- The console's own auth states (V1 frames 08–11: signing in, failed, no access, insecure context) reuse the same
  backdrop behind their card, so the hand-off to Keycloak and back looks like one page.

### Accessibility

A WebGL canvas is opaque to assistive technology, so the **Assets tab and the inspector are the accessible twin**:
every asset, part, reading and state in the scene is reachable there by keyboard and screen reader. The canvas gets
a live text summary (`aria-label`, as in the mockups) and is a single tab stop.

## Model contract

### Format and budgets

| Item                | Budget                                                                          | Enforced by                                                    |
| ------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Format              | glTF 2.0 binary (`.glb`)                                                        | CI rejects `.gltf` + loose files                               |
| Triangles per asset | ≤ 50,000                                                                        | `gltf-transform inspect` in CI                                 |
| Triangles on screen | ≤ 250,000                                                                       | LOD1 (≈ 25 % of LOD0) below 5 % screen height; frustum culling |
| Textures            | 1024², KTX2 (Basis), ≤ 3 per material                                           | CI                                                             |
| File per asset      | ≤ 1.5 MB                                                                        | CI                                                             |
| Materials per asset | ≤ 4, from a shared library                                                      | Review                                                         |
| Draw calls          | ≤ 150 per frame                                                                 | Merged statics, instancing for repeats (towers, lamp posts)    |
| Lighting            | Baked AO in the texture; one hemisphere + one directional light, no shadow maps | Review                                                         |

The site plan stays data from the API (ADR-0017). Buildings are extruded shells from zone polygons until a building
has its own model; only equipment needs authored models.

### Node naming and hierarchy

```text
cooling_tower.glb
CoolingTower               class root · one file for every cooling tower
├─ Casing                  static
├─ FanStack                static
│  └─ FanBlade             spin +Y · fanSpeedRpm
├─ FanMotor                state tint · motorTempC
├─ Pump                    state tint · pumpFlowM3h
├─ Pipe, Riser             static
├─ Valve                   turn X 0–90° · valveOpenPct
└─ ControlPanel            static
   └─ Switch               flip X ±35° · switchState
```

- **One model per asset class**, instanced for every asset of the class: CT-01 and CT-02 load the same file. The
  console tells assets apart by their instance root, not by node names
  ([ADR-0020](../../adr/0020-digital-twin-rendering-and-model-pipeline.md)).
- **Name** = the part role in English PascalCase (`FanBlade`, `Switch`), unique within the file. Code finds a part
  with `assetRoot.getObjectByName('FanBlade')`, so a rename is a breaking change to the model.
- **Pivot** on the part's own axis of motion. +Y up, 1 unit = 1 m, origin at the centre of the asset's footprint.
- **Static** parts are merged at load; only bound nodes stay separate objects.
- **`extras`** on every bound node:

  ```json
  {
    "partRole": "FanBlade",
    "bind": "fanSpeedRpm",
    "motion": "spin",
    "axis": "y",
    "range": [0, 1800]
  }
  ```

  `motion` is one of `spin` (speed drives angular velocity), `turn` (value maps to an angle in `range`), `slide`,
  or `tint` (state only). The client builds its bindings from `extras`, so a new asset class needs a model, not
  code.

### Pipeline

`.blend` / vendor export → `gltf-transform` (dedupe, weld, Meshopt, KTX2, LOD1) → CI budget check → static files
served with a content hash and `Cache-Control: immutable`. Models are versioned with the asset catalogue, not with
the console build.

## Real-time data

### Path

```text
Device / PLC ──MQTT──▶ Broker ──▶ API telemetry bridge ──Socket.IO /telemetry──▶ Web Worker ──snapshot──▶ render loop ──▶ three.js
                       (TLS, ACL)   (validate, cap 10 Hz,      (same OIDC token and         (parse, ring buffer,     (rAF, ease)
                                     raise threshold incidents)  roles as /events)           1 snapshot / frame)
```

- **The browser never talks MQTT.** The broker stays inside the network; the API subscribes, validates and fans out
  over a Socket.IO namespace that reuses ADR-0010's token and ADR-0011's roles. Every replica subscribes to the
  broker itself, so readings never go through the outbox or `NOTIFY` ([ADR-0019](../../adr/0019-telemetry-transport.md)).
  One authentication and authorization model instead of two.
- **The API caps each asset at 10 Hz** and sends only changed keys. The console never depends on a device's rate.
- **Threshold breaches become incidents on the server** (type `equipment_fault`, at most one open per asset and
  rule, [ADR-0018](../../adr/0018-assets-and-telemetry-as-domain-data.md)), so they
  reach the feed, toasts and other consoles the same way as any incident (frame 04). The client never decides that
  something is an incident.

### Message shape (draft for the contract)

```ts
// Server → client, namespace /telemetry. One message per asset per tick, changed keys only.
interface TelemetryFrame {
  assetCode: string; // "CT-01"
  at: string; // ISO time the device measured it
  values: Record<string, number | boolean | string>; // { fanSpeedRpm: 1420, motorTempC: 71.2 }
}
```

### Worker and render loop

- A dedicated Web Worker owns the `/telemetry` socket. It parses, validates against the asset's bindings, keeps a
  15-minute ring buffer per key (the inspector's sparklines), and once per animation frame posts **one**
  transferable `Float32Array` of current targets to the main thread. The main thread never handles a message per
  reading.
- The render loop eases each bound value toward its target, independent of frame rate:

  ```text
  x += (target − x) · (1 − e^(−λ·dt)),   λ = 8 /s   (≈ 90 % of a step in 290 ms)
  ```

  - `spin` parts ease the **speed**, then integrate the angle (`angle += speed · dt`), so a fan never jumps or
    reverses when a reading arrives.
  - `turn` / `slide` parts ease the value and take the shortest path for angles (quaternion slerp).
  - A step larger than the bound's `range` (a restart, a reconnect) snaps instead of easing.

- **Render on demand**: the loop runs while something moves (a spinning part, an easing value, a camera in motion)
  and sleeps otherwise. A hidden tab stops it.

### Freshness

| Age of the last reading                  | Twin                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| < 3 × the asset's expected interval      | Live                                                                                    |
| ≥ 3 × interval, or the namespace is down | **Stale**: motion stops, parts grey with dashed edges, values show their age (frame 05) |
| Device reports offline                   | `Offline` state; same look as stale                                                     |

Stale is decided per asset in the worker, so one silent device does not grey the whole campus.

## Performance

| Budget             | Value                                                    | How                                               |
| ------------------ | -------------------------------------------------------- | ------------------------------------------------- |
| Frame              | 16.7 ms (60 FPS); p95 ≤ 14 ms on the reference laptop    | Render on demand; main thread ≤ 8 ms              |
| Shadows            | None dynamic                                             | Baked AO, one blob decal under each asset         |
| Pixel ratio        | ≤ 1.5; video wall 1.0                                    | Drops one step when frames run long for 2 s       |
| First useful frame | Site plan + incidents ≤ 1 s after data                   | Models stream after, nearest first (frame 06)     |
| Bundle             | 3D code in its own lazy chunk                            | The 2D console and the fallback never download it |
| Memory             | Dispose geometry, materials and textures on level change | Checked in the dev HUD                            |

A developer-only HUD (`?debug=twin`, development builds only) shows FPS, p95 frame time, draw calls, triangles,
telemetry messages per second and worker posts per frame (frame 00).

## New tokens

Added in [mockups/twin.css](mockups/twin.css), ready for `tokens.css`. The material values are the three face tones
of one neutral; in WebGL they become one material's base colour (`--tw-top`) under the scene's two lights.

| Token                             | Value                             | Use                                       |
| --------------------------------- | --------------------------------- | ----------------------------------------- |
| `--tw-top / -south / -east`       | `#2a4658` / `#1f3748` / `#172b3a` | Part material (idle)                      |
| `--tw-edge`                       | `#3e5a6e`                         | Part outline                              |
| Steel (`.tw-steel`)               | `#435766` / `#334553` / `#273745` | Motors, pumps, pipes, valves, cabinets    |
| Concrete (`.tw-concrete`)         | `#363c41` / `#2b3034` / `#22262a` | Basins, plinths, skids                    |
| Rails, fan guards                 | `#8199aa`                         | Handrails, ladders, fan guard mesh        |
| `--tw-hover-*`                    | 30 % `--accent` into the material | Hover and selection                       |
| `--tw-alarm-*`                    | 35 % severity into the material   | Part with an open incident it raised      |
| `--tw-stale-*`, `--tw-stale-edge` | desaturated, `#4a555c` dashed     | No recent data                            |
| `--tw-ghost-opacity`              | 0.18                              | Context while an asset is isolated        |
| `--heat-0 … --heat-5`             | `#1f2a4d` → `#b3bdff`             | Telemetry overlay, sequential, accent hue |

## Frame index

| Frame                                | Shows                                                                                                                                                                                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 00 Foundations V2                    | Part states, materials, telemetry ramp, camera limits, node tree, budgets, data path, controls, tooltip and callout, device states, dev HUD                                                                                                           |
| 01 Campus twin — nothing selected    | 3D stage with view switch, layers, compass and camera controls; Incidents / Assets panel; second pill                                                                                                                                                 |
| 02 Hover an asset                    | Hover tint, quick tooltip, synced row in the Assets tab, the asset's cameras first in the strip                                                                                                                                                       |
| 03 Inspect an asset                  | Isolated asset, breadcrumb, part callout with leader line, inspector with live readings and part tree                                                                                                                                                 |
| 04 Telemetry alarm                   | Server-raised critical incident: alarm tint on the part, pulsing beacon, toast with "Fly to", hot KPI                                                                                                                                                 |
| 05 Telemetry paused                  | `Telemetry paused` pill and banner; stale parts; values with age; sparklines stop at the gap                                                                                                                                                          |
| 06 Scene loading                     | Site plan and incidents first; models stream in; placeholders; feed already usable                                                                                                                                                                    |
| 07 No WebGL                          | 2D map fallback with the reason; `3D` disabled in the switch                                                                                                                                                                                          |
| 08 Inspect the standby generator     | A second asset class: enclosure drawn see-through so engine, alternator, radiator, battery and fuel tank stay pickable; main breaker selected; standby readings                                                                                       |
| 09 Report by category                | Technician signed in; report form with category then type, suggested severity, location picked in 3D; "Mine to handle" tab and Facilities tags in the feed                                                                                            |
| 10 Incident raised by telemetry      | Incident detail over the twin: source "Telemetry rule", the rule and the reading that broke it, a link to the asset and part ("Show in 3D"), system actor in the timeline, selected beacon ring                                                       |
| 11 Technician, out-of-scope incident | A security incident opened by a technician: the sheet ends in the designed view-only footer and points to "Mine to handle" (ADR-0021)                                                                                                                 |
| 12 Building level                    | Data Center in focus: walls see-through, equipment inside (UPS, batteries, precision cooling, rack rows), other buildings faded; breadcrumb, building summary, Assets filtered by zone                                                                |
| 13 Heat overlay                      | Heat layer on: buildings coloured by indoor temperature on the sequential accent ramp with values; buildings without a reading faded; "Colour by" picker and legend                                                                                   |
| 14 2D view by choice                 | The user picked 2D on a capable device: site plan with asset markers (fault and stale variants), asset tooltip, Assets layer toggle; 3D stays one click away                                                                                          |
| 15 Asset without a 3D model          | Leak sensor LKS-B3 inside Dormitory B, drawn as a neutral box, in fault with its incident's severity; inspector with readings, the linked incident and why it is a box                                                                                |
| 16 Keyboard shortcuts                | The `?` help for V2: V1's groups plus the 3D view (keys and pointer), asset inspector, `F` and `V`; new rows marked; the 3D view's keys work in the canvas prototype                                                                                  |
| 17 Viewer, asset inspector           | Demo Viewer on CT-01: no "Report incident" in the header, the view-only footer in place of "Report a fault", the 3D view fully explorable                                                                                                             |
| 18 Video wall                        | One 1920 × 1080 wall screen, viewer, no pointer: 3D at pixel ratio 1.0 with a fixed camera, wall-sized labels and markers, no camera controls; flown to a critical incident with a return countdown; six cameras (incident first) and the active list |
| 19 Sign in                           | Keycloak theme `occ`: the sign-in card over a dimmed, slowly turning decorative campus with no labels or data; tagline, help line, recorded-sign-in notice                                                                                            |

Frames 01, 04, 06 and 07 show the full demo campus of the [Campus model](#campus-model) and incidents from several
categories.

Implementation tickets, their order, dependencies and which ticket builds each frame:
[implementation-order.md](implementation-order.md).

## Architecture impact

V2 is not a UI-only change. Four proposed ADRs decide the parts outside the console's look; where they refine this
brief, the ADR wins.

1. **[ADR-0018](../../adr/0018-assets-and-telemetry-as-domain-data.md) — assets, telemetry points and threshold
   rules as domain data.** Asset classes, assets, points and rules in PostgreSQL; a sustained breach raises a
   Facilities or Environment incident (default `equipment_fault`) with source `telemetry` (new in
   `INCIDENT_SOURCES`) and a system actor; 5 s samples kept 7 days in daily partitions; read-only API.
2. **[ADR-0019](../../adr/0019-telemetry-transport.md) — telemetry transport.** `TelemetrySource` (`mock` by
   default, `mqtt` with Mosquitto in a Compose profile); every replica subscribes; one advisory-lock leader persists
   and evaluates rules; `/telemetry` namespace with a 1 Hz overview of every asset and up to 10 Hz for watched
   assets.
3. **[ADR-0020](../../adr/0020-digital-twin-rendering-and-model-pipeline.md) — rendering and models.** three.js +
   `@react-three/fiber` in a lazy chunk; readings reach the scene as one transferable buffer per frame; one model per
   asset class, budget-checked in CI, served by nginx as content-hashed files. Also records the Content Security
   Policy the decoders will need.
4. **[ADR-0021](../../adr/0021-incident-categories-zone-uses-and-technician-role.md) — incident categories, zone
   uses and the technician role.** Six fixed categories over about 24 types (the six existing ones kept), new zone
   kinds and a building `use`, and a `technician` role that may act only on Facilities and Environment incidents.

## Open questions for review

1. **Part-name language.** The request's examples are Vietnamese (`CanhQuat`, `CongTac`). This spec proposes English
   roles (`FanBlade`, `Switch`) because every identifier in the codebase is English and the names become code.
   Confirm, or keep Vietnamese roles consistently.
2. **Which equipment classes first.** The mockups use one reference asset: cooling tower CT-01 on the Data Center
   roof, plus a sample list (UPS, generator, air handlers, lift, barrier arm, pump). Which classes are in V2.0, and
   who authors the models (in-house 3D artist, vendor BIM export)?
   **Classes decided 2026-10-09** (tech lead, confirmed with the operations lead and the facilities lead): 16
   classes, the mockups' catalogue plus an indoor climate sensor for the heat overlay; cooling tower and standby
   generator are modelled, the rest are boxes. Points, ranges and bound parts: [asset-classes.md](asset-classes.md).
   Model authors: open (V2-00.7).
3. ~~**3D by default, or 2D by default with 3D as a mode?** The mockups default to 3D on capable devices.~~
   **Decided 2026-10-09: 3D by default on devices that pass the WebGL 2 check** (tech lead, confirmed with the
   operations lead), as drawn in frame 01. 2D stays a switch (frame 14) and the fallback (frame 07). The viewer's last
   choice is still remembered per browser in `localStorage` (ADR-0020); with no stored choice, a capable device opens
   in 3D, so the lazy 3D chunk loads on start there.
4. ~~**Telemetry transport**: API bridge over Socket.IO (recommended) or browser → broker over MQTT-over-WebSocket?
   The second exposes the broker and adds a second auth model.~~
   **Decided 2026-10-09: the API bridge** (tech lead, confirmed with the security lead). The API is the only MQTT
   subscriber and forwards readings on the `/telemetry` Socket.IO namespace with ADR-0010's tokens; the broker is
   never exposed to browsers (ADR-0019).
5. ~~**Read-only twin.** No device control (start / stop / setpoints) from the console in V2. Controlling equipment
   is a safety decision with its own interlocks and audit; confirm it stays out of scope.~~
   **Decided 2026-10-09: V2.0 is read-only** (tech lead, confirmed with the operations lead and the facilities lead).
   The API has no write routes (ADR-0018) and its broker account may publish nothing (ADR-0019). Commanding equipment
   would need a new ADR (command path, interlocks, confirmation step, audit, permission) outside V2.0.
6. ~~**Video wall (UI-17).** One WebGL context per wall screen, at pixel ratio 1.0 — or the wall keeps the 2D map?~~
   **Decided 2026-10-08: 3D with a fixed camera** (frame 18, principle 4's exception, ADR-0020). A wall screen whose
   GPU cannot hold the frame budget falls back to the 2D map like any other device.
7. **Thresholds** that raise incidents: per asset class with per-asset overrides, owned by operations (as V1's
   attention thresholds were).

## Notes

- All readings, asset codes and run hours in the mockups are illustrative sample data, not real limits.
- The canvas is private until shared from its Share menu.
