# Console V2 — 3D digital twin: design brief and spec

Status: **in effect** (V2-19.8, 2026-10-21; designed in V2-01, 2026-10-08). Mockups: [Ops Console V2 — Digital Twin](https://claude.ai/artifact/7Snsv6XonSMMYRbXSWejbT)
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
- Built in V2-20 (2026-10-21): the theme is `ops/keycloak/themes/occ/`, the picture is made by
  `ops/sign-in-backdrop/render.ts`, and what is decided and checked is in ADR-0010 ("Settled in V2-20.1 and built in
  V2-20.2 – V2-20.7").

### Accessibility

A WebGL canvas is opaque to assistive technology, so the **Assets tab and the inspector are the accessible twin**:
every asset, part, reading and state in the scene is reachable there by keyboard and screen reader. The canvas gets
a live text summary (`aria-label`, as in the mockups) and is a single tab stop.

## Model contract

### Format and budgets

| Item                | Budget                                                                          | Enforced by                                                    |
| ------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Format              | glTF 2.0 binary (`.glb`)                                                        | CI rejects `.gltf` + loose files                               |
| Triangles per asset | ≤ 50,000                                                                        | `pnpm models:check` (gltf-transform) in CI                     |
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
   └─ Switch               turn X ±35° · switchState
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
- **The API sends a 1 Hz overview of every asset and at most 10 Hz for the assets a console watches**, changed keys
  only ([ADR-0019](../../adr/0019-telemetry-transport.md)). The console never depends on a device's rate.
- **Threshold breaches become incidents on the server** (the rule's `facilities` or `environment` type,
  `equipment_fault` by default, at most one open per asset and
  rule, [ADR-0018](../../adr/0018-assets-and-telemetry-as-domain-data.md)), so they
  reach the feed, toasts and other consoles the same way as any incident (frame 04). The client never decides that
  something is an incident.

### Message shape (draft for the contract)

```ts
// Server → client, namespace /telemetry: `telemetry.frames` carries one of these per changed asset (V2-08.2),
// at most 10 Hz per watched asset, changed keys only.
interface TelemetryFrame {
  assetCode: string; // "CT-01"
  at: string; // ISO time the device measured it
  receivedAt: string; // ISO time the API received it (freshness, ADR-0019)
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
  - A step of at least half the bound's span (a restart, a reconnect), and the first value after a model loads,
    snap instead of easing. The threshold is a fraction because no in-domain step can exceed the whole range; a
    boolean or an enum always eases by size (ADR-0020 § State).

- **Render on demand**: the loop runs while something moves (a spinning part, an easing value, a camera in motion)
  and sleeps otherwise. A hidden tab stops it.

### Freshness

| Age of the last reading                  | Twin                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| < 3 × the point's `expected_interval_s`  | Live                                                                                    |
| ≥ 3 × interval, or the namespace is down | **Stale**: motion stops, parts grey with dashed edges, values show their age (frame 05) |
| Device reports offline                   | `Offline` state; same look as stale                                                     |

Stale is decided in the worker per point, from `receivedAt` and its `expected_interval_s` (ADR-0019), so one silent
device does not grey the whole campus. An asset nobody is watching has one `receivedAt` and headline values only, so
it is judged by its shortest headline interval, on the server's clock (V2-08.1;
[asset-classes.md](asset-classes.md#open-questions), question 6).

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

### Reference hardware

Decided 2026-10-09 (V2-00.9) by the tech lead. The frame budget is measured on these two machines (V2-19). They are a
deliberate floor, weaker than a typical control-room machine: a build that holds the budget here holds it on the real
ones. If a site's own hardware turns out weaker, the floor moves down to it.

| Machine          | CPU                            | GPU                          | RAM   | Software                                                               | Screens                                                                        |
| ---------------- | ------------------------------ | ---------------------------- | ----- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Reference laptop | Intel Core i5-1235U (12th gen) | Intel Iris Xe (integrated)   | 16 GB | Windows 11, plugged in, balanced power; Chrome stable                  | 1920 × 1080 at 125 % scaling (`devicePixelRatio` 1.25)                         |
| Wall controller  | Intel Core i7-12700 (12th gen) | NVIDIA T1000 8 GB, 4 outputs | 32 GB | Windows 11; Chrome stable, one window and one WebGL context per screen | 4 × 3840 × 2160 at 60 Hz, pixel ratio 1.0 (the 4K wall mode, ≥ 3200 px, UI-17) |

Each measurement records the Chrome version and the GPU driver version, so it can be repeated.

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

Contrast (V2-02.1): a hover, selected or alarmed part's edge is held to 3:1 on the ground and on idle neighbours, not
on the part's own face, where it only draws the shape; the stale edge stays below 3:1 on purpose, because the dash,
the stopped motion and the age on every value carry stale (Principle 3). Ratios and reasons:
[tokens.md](../tokens.md#digital-twin-v2).

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
| 13 Heat overlay                      | Heat layer on: buildings coloured by indoor temperature (`indoorTempC` from air handlers and indoor climate sensors) on the sequential accent ramp with values; buildings without a reading faded; "Colour by" picker and legend                      |
| 14 2D view by choice                 | The user picked 2D on a capable device: site plan with asset markers (fault and stale variants), asset tooltip, Assets layer toggle; 3D stays one click away                                                                                          |
| 15 Asset without a 3D model          | Leak sensor LKS-B3 inside Dormitory B, drawn as a neutral box, in fault with its incident's severity; inspector with readings, the linked incident and why it is a box                                                                                |
| 16 Keyboard shortcuts                | The `?` help for V2: V1's groups plus the 3D view (keys and pointer), asset inspector, `F` and `V`; new rows marked; the 3D view's keys work in the canvas prototype                                                                                  |
| 17 Viewer, asset inspector           | Demo Viewer on CT-01: no "Report incident" in the header, the view-only footer in place of "Report a fault", the 3D view fully explorable                                                                                                             |
| 18 Video wall                        | One 1920 × 1080 wall screen, viewer, no pointer: 3D at pixel ratio 1.0 with a fixed camera, wall-sized labels and markers, no camera controls; flown to a critical incident with a return countdown; six cameras (incident first) and the active list |
| 19 Sign in                           | Keycloak theme `occ`: the sign-in card over a dimmed, slowly turning decorative campus with no labels or data; tagline, help line, recorded-sign-in notice                                                                                            |

Frames 01, 04, 06 and 07 show the full demo campus of the [Campus model](#campus-model) and incidents from several
categories.

### Frames to revise after Phase 0

Phase 0 (V2-00, 2026-10-09) kept every decision as drawn except the ones below. These frames were revised on the
canvas and in [mockups/](mockups/) together on 2026-10-09 (V2-00.12); where a frame and this brief, an ADR or
[asset-classes.md](asset-classes.md) still disagree, the written decision wins. The rows decided in V2-02.2 (glyphs)
came later and are not redrawn yet; until they are, [icons.md](../icons.md#v2-values-frame-deviations-and-choices-v2-022)
is the source. The V2-03.6 row (report form copy and fields) is not redrawn either; the console's report form is the
source.

Rows from V2-08 on are differences found while building the 2D console (Phase 3): each names its task, and the built
console is the source until the frame is redrawn. The V2-12 rows are decisions taken before building the 3D stage
(ADR-0020 § Scene): the written decision wins over the frame.

| Frame                                | Change                                                                                                                                                                                                                                                                 | Decision                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 00 Foundations V2                    | Node tree: `Switch` is `turn X ±35°`, not `flip`. `extras` list: drop `partRole` (the node name is the role); `axis` and `range` only on moving parts                                                                                                                  | V2-00.10 (ADR-0020)              |
| 13 Heat overlay                      | Every building has a reading: indoor climate sensors where there is no air handler. Only a building whose sensor is silent is faded                                                                                                                                    | V2-00.5 (`indoor_climate` class) |
| 13 Heat overlay                      | The mockup turns Cameras off by choice: Heat leaves Cameras as the operator set it. A building above 27 °C or below 19 °C reads its real mean and is coloured at the ramp's end; one with no fresh source is faded and reads "No data"                                 | V2-17.1 (ADR-0020)               |
| 13 Heat overlay                      | The marker legend stays under the heat legend, in one column: it still explains the beacons and the cameras and, at building level, says Esc returns to Campus                                                                                                         | V2-17.4 (ADR-0020)               |
| 13 Heat overlay                      | The legend's ramp is a continuous gradient over the six stops, not six blocks: a shell is continuous between the stops, so the 23 °C tick must sit on a colour and not on the border of two blocks                                                                     | V2-17.4 (ADR-0020)               |
| 13 Heat overlay                      | The legend's note adds "The Assets tab lists each reading." (the canvas is hidden from assistive technology). Heat is offered at every 3D level; "Colour by" and the legend show at campus and building level only                                                     | V2-17.4 (ADR-0020)               |
| 02, 03, 05, 08, 12, 15, 17 (Assets)  | The Assets list holds the 22 equipment assets (BAT-01, CRAC-01 and CRAC-02 too, not only in frame 12) and the indoor climate sensors                                                                                                                                   | V2-00.5                          |
| 00 Foundations V2 (categories card)  | Category glyphs: Security `ShieldUser`, Fire & safety `FireExtinguisher`, Medical `Stethoscope`, Facilities `HardHat` (not `Shield`, `Flame`, `HeartPulse`, `Wrench`)                                                                                                  | V2-02.2 (`icons.md`)             |
| 09 Report by category                | The same four category tiles; the Network outage type tile is `ServerOff`, not `WifiOff`                                                                                                                                                                               | V2-02.2 (`icons.md`)             |
| 09 Report by category                | The severity hint has no reason sentence; the Title field and the zone select ("Pick on map", which reads "Pick in 3D" while the 3D view is in effect, V2-16.7) stay instead of the free-text location                                                                 | V2-03.6                          |
| 11 Technician, out-of-scope incident | The Security category chip is `ShieldUser`, not `Shield`                                                                                                                                                                                                               | V2-02.2 (`icons.md`)             |
| 05 Telemetry paused                  | Two pill states it does not draw: "Telemetry reconnecting…", "Telemetry unavailable"; the banner button reads "Reconnect"                                                                                                                                              | V2-08.1                          |
| 02 Assets list                       | Groups run by zone name A–Z, not as drawn; the place line is the zone plus "roof" or "level n" ("east yard" is not data); no state word without a state value                                                                                                          | V2-09.1 (`asset-classes.md`)     |
| 03, 08 Inspector                     | Rows: headline, rule-watched points, then "All points"; no "Rated 22 A", "ΔT" or merged "Water in / out", no tank capacity; the set point is its own row                                                                                                               | V2-09.1 (`asset-classes.md`)     |
| 15 Sensor without model              | "Replace below 20 %" reads "Low at 20 %"; "Since 15:17" gives way to the reading's age; no "riser cupboard" place text; no Parts section                                                                                                                               | V2-09.1 (`asset-classes.md`)     |
| 02, 03 Assets list                   | Booster pump draws `Gauge` and Gas detector `Cylinder`, not `activity`: that glyph is Running and the Telemetry pill's live state                                                                                                                                      | V2-09.4 (`icons.md`)             |
| 03, 05, 08 Parts                     | Static parts are "static" rows (no "see-through"); a part shows its one bound reading, not "stopped · 41 °C", "71 °C · 18.6 A"; "last …" when stale                                                                                                                    | V2-09.9 (`asset-classes.md`)     |
| 15 Sensor without model              | The note gives the box's three sides ("1.4 × 1.4 × 1.4 m"); "Open INC-…" sits in the incident section, not in the foot                                                                                                                                                 | V2-09.9 (`asset-classes.md`)     |
| 03, 17 Asset inspector foot          | The report button is `primary`, not `secondary`; the report's title carries the tag "(CT-01)"; "Focus" is drawn in the 3D view only and without its `F` hint until V2-18.2                                                                                             | V2-09.10 (`asset-classes.md`)    |
| 03, 08, 17 Parts rows                | The selected row is `aria-selected` (a `treeitem` list item), not `aria-current` on a button; hover is the same accent tint, and the glyph turns accent when selected; a static row and every row in 2D are not selectable; the row's flight stops at the 4 m floor    | V2-15.11 (ADR-0020)              |
| 04 Telemetry alarm                   | The beacon stands at the top of the asset's model (`CT-01` 19 m with the stand-in, not 20.8 m); the toast offers "Fly to" and "Open incident" in 3D and "View incident" in 2D, for every role                                                                          | V2-16.1 (ADR-0020)               |
| 09 Report by category                | The pin stands at the height of the hit (a roof click at the roof, the ground at 0), not at z = 20 m; the incident keeps only its longitude and latitude                                                                                                               | V2-16.1 (ADR-0020)               |
| 03 Camera strip                      | An offline camera is after every online one, as for an incident; frame 03 draws the offline zone camera second                                                                                                                                                         | V2-09.11                         |
| 10 Telemetry incident                | The reported note reads "motorTempC 92 > 85 for 60 s" with no "on CT-01" (the API writes none); the asset link is a row with a real "Open asset" button, not a button around a button, and its place reads "Data Center · roof"; "Show in 3D" is not drawn until V2-16 | V2-11.1, V2-11.3                 |
| 04 Equipment alarm                   | The toast's place reads "Data Center · roof"; its reading ("92 °C for 60 s, limit 85 °C") arrives after the toast, in the same toast; in 3D the toast offers "Fly to" and "Open incident" (V2-16.5), in 2D the one action is "View incident"                           | V2-11.4, V2-16.5                 |
| 14 2D with assets                    | The tooltip's "Wet since 15:17" reads the value and the reading's age: the overview does not carry the time the value changed                                                                                                                                          | V2-10.4 (Open question 7)        |
| 07, 14 3D unavailable                | The banner reads frame 07's wording for a device without WebGL 2, and "3D view stopped working" after a lost context, over "The 2D map shows the same incidents, cameras and assets."; the build-time reason "not available in this version" was removed in V2-19.8    | V2-10.1 (Open question 3)        |
| 01 – 15 Buildings in 3D              | Shells are the 2D footprints (the zone inset 8 m) extruded to the zone's height, 12 m when it has none, not the raw zone polygon                                                                                                                                       | V2-12.1 (ADR-0020)               |
| 01, 02, 04, 10, 14 (Layers)          | In 3D the layers are Incidents and Cameras (Heat from V2-17, Inside at building level); frame 01's "Asset" legend entry reads "Asset — hover for readings" and there is no Assets toggle: equipment is the scene                                                       | V2-12.1 (ADR-0020)               |
| 06 Scene loading                     | The card lists the site plan, the 3D code and the equipment models only: no building rows ("Innovation Hub, Library 1.9 MB"), because buildings have no models                                                                                                         | V2-12.1 (ADR-0020)               |
| 12 Building level                    | No rack rows inside the Data Center: no asset class or site-plan feature describes them                                                                                                                                                                                | V2-12.1 (ADR-0020)               |
| 00 Foundations V2 (camera limits)    | "Never goes below 8° above the ground" is a drawing note; the written limit is 78° from vertical (12° above the ground)                                                                                                                                                | V2-12.1 (ADR-0020)               |
| 04 Telemetry alarm                   | The alarm tint is the whole asset (35 % of the severity into its material), not one part; at asset level the parts bound to the point the rule watches also take the severity edge                                                                                     | V2-14.1 (ADR-0020)               |
| 03, 08 Parts                         | No "Blade pitch", "Next service", "Rating", "Trips" or "Last operated": the catalogue holds no such data; a part shows its one bound reading, or "—" while the console does not hold it                                                                                | V2-14.1 (ADR-0020)               |
| 05 Telemetry paused                  | A stale spinning part freezes at its last pose; it does not run down, which would read as a real stop. An asset in stale and fault keeps its severity edge on grey faces                                                                                               | V2-14.1 (ADR-0020)               |
| 03, 08 Parts                         | Every named node of the model is a row, in the model's order (the delivery decides which static parts appear); a binding the catalogue cannot take reads "static"                                                                                                      | V2-14.10 (`asset-classes.md`)    |
| 03, 17 Legend                        | "Isolated — the campus is hidden" reads "Isolated — the rest of the campus is faded. Esc returns to {crumb}": the rest is drawn at `--tw-ghost-opacity`, not removed. An asset in a zone that is not a building (`TR-01`) has no middle crumb and returns to Campus    | V2-15.1 (ADR-0020)               |
| 03, 08, 17 Callout                   | The callout holds the part's label, its one bound reading with its age and "Limit …" when a rule watches it: no "Set point", "Blade pitch", "Next service", "Rating", "Trips" or "Last operated"                                                                       | V2-15.1 (ADR-0020)               |
| 02 Hover tooltip                     | The state word is the list's ("Standby", not "Standby · Auto" or "Running · on mains"); the foot is "Click to inspect · {place line}" ("east yard" is not data); two headline readings, or fewer when the asset has fewer                                              | V2-15.1 (ADR-0020)               |
| 12 Building summary                  | Three rows: assets (with how many have no data), open incidents and indoor temperature; no "IT load" and no "Power" row, which no point carries                                                                                                                        | V2-15.1 (ADR-0020)               |
| 12 Layers                            | At building level the layers are Incidents, Cameras and Inside: Cameras stays (frame 12 omits it) as the 3D markers follow it; Inside draws the building opaque, equipment hidden, and shows at building level only; the open sheet moves the card left                | V2-15.9 (ADR-0020)               |
| 03, 08, 17 Selected part             | The selected part keeps the hover look (a 30 % accent face and a 1 px accent outline) until it is deselected: WebGL lines are 1 px, and the frames' "2 px" edge is a canvas stroke of the prototype                                                                    | V2-15.10 (ADR-0020)              |
| 03, 08, 17 Callout (state)           | A stale asset's callout reads "last 1,420 rpm" and its age ("1 min old"), a live one "Live"; the card is a dialog that takes no focus; the leader starts at its right edge and follows the part                                                                        | V2-15.10 (ADR-0020)              |
| 16 Keyboard shortcuts, Main (Home)   | `Home` reads "Reset to the campus view" in both: it leaves the building and the asset, and keeps an open incident                                                                                                                                                      | V2-15.1 (ADR-0020)               |
| 15 Sensor without model (legend)     | At asset level in a building the legend is the isolation line of frames 03 and 17 ("Isolated — the rest of the campus is faded. Esc returns to Dormitory B"); "Walls see-through, other buildings faded. Esc returns to Campus" is the building level's (frame 12)     | V2-15.8 (ADR-0020)               |
| TwinScene (prototype)                | The substation, the utility yard label and the gate posts are not drawn: no zone, asset or site-plan feature describes them                                                                                                                                            | V2-12.1 (ADR-0020)               |
| 19 Sign in                           | Not shipped, because they are sample data: the username `minh.tran`, the password value, "Locked out? Call the control room, ext. 2000" (a message each site writes) and the footer's "v2.0 · English" (no hand-typed version)                                         | V2-20.1 (Open questions 11, 15)  |
| 19 Sign in                           | "Forgot password?" is shown only where recovery is configured (the demo realm has none); "sign-ins are recorded" is said only where the identity provider records them (V2-20.4); the fonts come from the theme, not from Google Fonts                                 | V2-20.1 (Open questions 11, 12)  |
| 19 Sign in                           | The backdrop is an authored loop with a poster, not `TwinScene`; it turns 2° a second, and under reduced motion and behind the console's own sign-in states it is the poster                                                                                           | V2-20.1 (Open question 10)       |
| 18 Video wall                        | Not shipped, because they are sample data: "Wall 1", the date and time, `INC-000107`, the readings ("92 °C, limit 85 °C"), the camera names and codes and the countdown's "48 s"                                                                                       | V2-21.1 (Open question 19)       |
| 18 Video wall                        | There is no frame for a wall that cannot draw 3D: it is the same shell with the 2D map in the stage, the focus banner kept and the camera rules unchanged                                                                                                              | V2-21.1 (Open question 9)        |
| 18 Video wall                        | The frame's sizes are drawn at 1920 px: in wall mode the console scales them from the window width (1.35 at 1920, 2.7 at 3840), not with the interactive console's 1.125 and 1.75                                                                                      | V2-21.1 (Open question 3)        |

Implementation tickets, their order, dependencies and which ticket builds each frame:
[implementation-order.md](implementation-order.md).

## Architecture impact

V2 is not a UI-only change. Four ADRs, accepted 2026-10-09, decide the parts outside the console's look; where they
refine this brief, the ADR wins.

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

1. ~~**Part-name language.** The request's examples are Vietnamese (`CanhQuat`, `CongTac`). This spec proposes
   English roles (`FanBlade`, `Switch`) because every identifier in the codebase is English and the names become
   code. Confirm, or keep Vietnamese roles consistently.~~
   **Decided 2026-10-09: English roles** (tech lead), as written in § Model contract and ADR-0020. No example
   changes.
2. ~~**Which equipment classes first.** The mockups use one reference asset: cooling tower CT-01 on the Data Center
   roof, plus a sample list (UPS, generator, air handlers, lift, barrier arm, pump). Which classes are in V2.0, and
   who authors the models (in-house 3D artist, vendor BIM export)?~~
   **Classes decided 2026-10-09** (tech lead, confirmed with the operations lead and the facilities lead): 16
   classes, the mockups' catalogue plus an indoor climate sensor for the heat overlay; cooling tower and standby
   generator are modelled, the rest are boxes. Points, ranges and bound parts: [asset-classes.md](asset-classes.md).
   **Model authors decided 2026-10-09** (tech lead): an external 3D vendor, with § Model contract and its budgets in
   the purchase scope. Delivery order: cooling tower, then standby generator, both before V2-13 starts. The vendor's
   name and the calendar date are named when the purchase is placed.
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
7. ~~**Thresholds** that raise incidents: per asset class with per-asset overrides, owned by operations (as V1's
   attention thresholds were).~~
   **Decided 2026-10-09: owned by operations** (tech lead, confirmed with the operations lead), per class with
   per-asset overrides. The 22 starting rules: [asset-classes.md § Threshold rules](asset-classes.md#threshold-rules),
   to be reviewed after the first week of real data.

## Notes

- All readings, asset codes and run hours in the mockups are illustrative sample data, not real limits.
- The canvas is private until shared from its Share menu.
