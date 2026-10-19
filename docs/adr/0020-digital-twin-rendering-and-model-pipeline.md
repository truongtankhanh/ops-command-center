# ADR-0020: The digital twin renders with three.js in a lazy console chunk; models are budgeted, content-hashed static files

- **Status:** Accepted 2026-10-09
- **Date:** 2026-10-08
- **Context documents:** [Console V2 design brief](../design/v2/brief.md), [ADR-0018](0018-assets-and-telemetry-as-domain-data.md), [ADR-0019](0019-telemetry-transport.md)

## Context

The V2 brief asks for a 3D stage with orbit, zoom and pan inside limits, hover and click on individual parts,
parts that move with live readings at 60 FPS, light models (`.glb`, under 50,000 polygons, 1K textures), no dynamic
shadows, and telemetry handled off the render thread.

The console is React 19 with Vite, TanStack Query, zustand and MapLibre for the 2D map (UI-08, UI-09). It runs on
laptops for 12-hour shifts, and on video walls from 1920 px wide, with a 4K wall mode from 3200 px (UI-17). Some of
those machines will have weak GPUs or WebGL disabled by policy.

Constraints:

- **The 2D console keeps working** with no 3D download and no WebGL: it is the fallback and the accessible view
  (brief, frame 07).
- **The catalogue is data** (ADR-0017, ADR-0018): a new asset or asset class must not need a console build.
- **New dependencies need a reason**, and anything heavy stays out of the 2D path.
- **jsdom has no WebGL.** The existing Vitest and Testing Library suites must keep running as they are.

## Options

**Rendering engine.**

1. **three.js with `@react-three/fiber` (R3F)**, and only the `drei` helpers we use. The scene is React components
   with pointer events and disposal on unmount, while per-frame work stays in refs inside `useFrame`.
2. three.js wrapped imperatively in one React component. One dependency fewer, but raycast events, disposal and
   resizing would be hand-written and owned by the team.
3. Babylon.js. A complete engine (inspector, GUI, picking), but a larger bundle and a second ecosystem that fits
   React less naturally.
4. MapLibre `fill-extrusion` for buildings plus a three.js custom layer for equipment. One camera for 2D and 3D, but
   picking across two renderers, map camera limits at 4 m from an asset, and matrix plumbing in a custom layer.
5. deck.gl (planned for the heatmap, OCC-18). Strong for geographic layers; its `ScenegraphLayer` plays a model's
   own animations but does not bind single nodes to live values.

**Moving values from the telemetry worker to the scene.**

1. Through React state or zustand. A re-render per reading cannot hold 60 FPS.
2. `SharedArrayBuffer`. No copy at all, but it needs cross-origin isolation (COOP/COEP), which would block camera
   streams and any other cross-origin resource that does not opt in.
3. **One transferable `Float32Array` per animation frame** from the worker, read by `useFrame` into refs.

**Where model files live.**

1. In the console build (`public/`). Every model change would need a console release, against the catalogue being
   data.
2. In the database, served by the API. Large binaries in rows, in backups and through Node.
3. Object storage (S3, MinIO). Right at scale, but a new service on-prem.
4. **A `models` directory served by nginx under `/models/`**, file names carrying a content hash, referenced by
   `asset_class.model_key` (ADR-0018).

**Optimising models.**

1. In CI. Texture compression to KTX2 needs the native `toktx` binary from KTX-Software in every CI image.
2. **By the author with documented `gltf-transform` commands; CI only checks the result** with the pure-JS
   `@gltf-transform/core` (no native binaries).

## Decision

three.js with R3F in its own lazily loaded chunk; values arrive by transferable buffer; models are optimised by
their author, checked in CI, and served by nginx as immutable files.

- **Packages:** `three`, `@react-three/fiber`, `@react-three/drei` (only `CameraControls`, `Bvh`, `useGLTF` with
  the Meshopt and KTX2 loaders), and `three-mesh-bvh` through `Bvh`. Latest stable at implementation, pinned by the
  lockfile. Model checks add `@gltf-transform/core` and `@gltf-transform/functions` as dev dependencies.
- **Lazy chunk.** The twin is one `React.lazy` boundary behind the `3D` view. The 2D view, the fallback and the
  sign-in screens never download it. The chunk budget is 350 KB gzipped including three.js; the CI build reports it
  and fails above it. That number is a budget to confirm in V2-12, not a measurement. No bundle check exists today:
  CI runs `pnpm build`, and Vite only warns above 1,200 KB minified (`chunkSizeWarningLimit`).
  - Settled in V2-12.3, without changing the decision: `pnpm build` now ends with `scripts/chunk-budget.ts`, which reads
    Vite's manifest and fails above the budget. It counts the zlib level 9 size of the twin chunk's `.js` and `.css`
    and of the chunks only it imports, with 1 KB = 1,000 bytes (350,000 bytes); Vite's own reporter prints about 1 %
    more for the same chunk. It also fails when the twin chunk is in the static import graph of `index.html`, when a
    statically loaded chunk holds `WebGLRenderer`, `BufferGeometry` and `Object3D` together (a heuristic for three.js
    pulled out of the lazy chunk), and when the manifest or the twin chunk is missing. After a pass it deletes
    `dist/.vite/`, so the console image never serves the manifest.
  - Measured on 2026-10-16 (`main` after V2-12.2): the empty shell (R3F `Canvas`) is 238,918 bytes gzipped, 111 KB under
    the budget; with the helpers the plan names (`CameraControls`, `Bvh`, and the `KTX2Loader`, `GLTFLoader` and
    Meshopt decoder of three's examples) it is 307,060 bytes, 42,940 bytes under. The budget stands, but the scene, the
    picking, the labels and the model loading of V2-12.6 – V2-15 have to fit in the remaining ~13 %. A static
    `import * as THREE from 'three'` in the entry shrinks the twin chunk (to 142,859 bytes) and passes the size
    check, which is why the graph check exists: it fails that build.
- **Capability check.** The console renders the twin only if a WebGL 2 context can be created. Otherwise, and after
  a `webglcontextlost` that does not restore within 5 s, it shows the 2D map with the reason (brief, frame 07). The
  viewer's last choice of 2D or 3D is a per-browser convenience in `localStorage`.
  - Settled in V2-12.1, without changing the decision: from V2-12.4 to V2-19.8 the capability also requires a preview
    gate (a development build, or `?twin=1` for the tab), so the 3D view cannot reach operators before incidents are
    drawn in it (V2-16) and the frame budgets are measured (V2-19). Until the gate is lifted the reason shown is
    "3D view isn't available in this version".
- **Scene.**
  - Local coordinates in metres, east-north-up from `SitePlan.center` (ADR-0017), Y up. A campus fits an
    equirectangular conversion without visible error.
  - Site plan and zones are drawn from API data; building shells are extruded from zone polygons to `zone.height_m`
    (ADR-0018). Only equipment uses authored models.
  - Lighting: one hemisphere light and one directional light, no shadow maps. Contact shadows are a baked blob
    decal under each asset; ambient occlusion is baked into textures.
  - `frameloop="demand"`: the loop runs while a part moves, a value eases or the camera moves, and stops otherwise.
    Pixel ratio is at most 1.5, and 1.0 on a wall (UI-17).
  - Video wall (decided 2026-10-08): the wall shows the 3D view with a fixed camera and no controls (labels and
    markers scaled for reading from metres away). It is the only place the camera moves by itself: on a new critical
    incident it flies to it and returns to the fixed view after 60 s or on acknowledgement. Each wall screen is one
    WebGL context; a screen that cannot hold the frame budget falls back to the 2D map.
  - Camera: `CameraControls` with the limits in the brief (distance, tilt 20°–78° from vertical, target clamped to
    the site boundary + 40 m, zoom to cursor, damping, fly-to 600 ms or instant with reduced motion). Outside the
    video wall, the view never moves on its own.
  - Picking: raycast against BVH-accelerated meshes, at most once per frame.
  - Settled in V2-12.1, without changing the decision (the frames and `TwinScene.dc.html` are the evidence; where a
    sentence above says otherwise, this block is the refinement):
    - **Axes.** Local metres, three.js `x` = east, `y` = up, `z` = −north (right-handed), origin at `SitePlan.center`.
      The conversion is `geo.ts`'s flat-earth model with the cosine of the centre's latitude, so the scene and the 2D
      map agree; its inverse serves picks.
    - **Shells are the 2D footprints.** A building is extruded from the footprint rule of `lib/sitePlan.ts` (the zone
      inset by 8 m, ADR-0017), not from the raw zone polygon, so 2D and 3D draw the same building. A building whose
      `heightM` is `null` is drawn at `DEFAULT_BUILDING_HEIGHT_M` = 12 m (no earlier document named a value; 12 m is in
      the lower half of the seed's 6 – 24 m, so a missing height is never taller than a real one). Zones that are not
      `building` are flat fills; the site plan's roads, fields, footprint outlines and parking rows are flat lines.
    - **Placement of an asset** is derived from catalogue data: `inside` when its zone is a `building`, its position is
      in the footprint and `elevationM < heightM`; `roof` when `elevationM` equals `heightM`; otherwise `outdoor`
      (`GEN-01` stands 3 m outside its zone; Utility Plant is `kind: utility`). Campus level draws `outdoor` and `roof`
      assets; `inside` assets appear with their building in focus (V2-15.8). Every asset stays in the Assets tab.
    - **Labels** are DOM overlays (the console's fonts and tokens, no new dependency, a hard cap on their number,
      `pointer-events: none`), not canvas text.
    - **Layers in 3D** are Incidents and Cameras (Heat arrives with V2-17, Inside with V2-15.9). There is no Assets
      toggle: equipment is the scene.
    - **The loading card** lists the site plan, the 3D code and, from V2-14.7, one row per equipment model. It has no
      rows for buildings, which have no models.
    - **Not drawn, for lack of data:** frame 12's rack rows, and the prototype's substation, utility yard and gate posts.
    - **Where code lives.** Everything that imports `three` or `@react-three/*` is under `apps/console/src/twin/`;
      pure helpers stay in `src/lib/twin*.ts`, so they test without WebGL.
    - **Camera floor.** The written limit, 78° from vertical (12° above the ground), stands; frame 00's note "never
      below 8° above" is a drawing note.
- **State.** Selection, hover, level and the 2D/3D choice live in a zustand store (already a dependency). Readings
  never enter React state: the telemetry worker owns the `/telemetry` socket (ADR-0019), keeps the ring buffers and
  posts one `Float32Array` of targets per frame; `useFrame` eases bound nodes toward them in refs.
  - Settled in V2-14.1 (2026-10-18, tech lead), without changing the decision. The brief's maths stands
    (`x += (target − x)·(1 − e^(−λ·dt))`, λ = 8 / s as `EASE_LAMBDA`; spin eases the _speed_ and integrates the
    angle); this block adds what a build needs to start:
    - **Encoding.** A reading becomes one number with `encodeReading(value, enumValues)` (`lib/ringBuffer.ts`): a
      number as it is, a boolean 0 / 1, an enum its index in the point's `enumValues`; a value that does not encode
      is no target, so the part keeps its pose. The layout message the worker posts at the start (V2-14.4) carries
      `enumValues`, so the reserved `enums` field of the `watch` message stays unused.
    - **Mapping onto `extras.range`** (`turn` and `slide`): linearly and clamped, from the point's domain (its `min`
      and `max`; `[0, 1]` for a boolean; `[0, n−1]` for an enum of `n` values, and `range[0]` when `n` is 1) onto
      `range`. So `switchState` `off` / `auto` / `hand` is −35° / 0° / +35°, `breakerClosed` false / true is 0° / 35°
      and `valveOpenPct` 0 – 100 is 0° – 90°.
    - **A spinning part shows a legible speed, not the rotor's.** Visual speed = reading / `range[1]` (clamped to
      0 – 1) × `MAX_VISUAL_REV_PER_S`, which is 1.5 rev/s: monotonic, zero at zero, about 9° a frame at 60 FPS, so the
      eye reads faster, slower or stopped and never the wagon-wheel of a real 1,420 rpm rotor. The readings carry the
      number. Both constants live in `lib/twinMotion.ts` (V2-14.3).
    - **`tint` shows alarm, not value.** A `tint` node keeps its idle material, and takes the severity of an open
      incident raised by a rule that watches its bound point (the key comes from the incident's evidence,
      `lib/telemetryEvidence.ts`) at `--tw-alarm-mix` (35 %). A threshold crossed without an open incident tints
      nothing: brief Principle 2 ("a part takes a severity colour only while an incident it raised is open") wins, so
      the colour and the incident list can never disagree. A `tint` bound to a point no rule watches (`controlMode`,
      `pumpFlowM3h`, …) never changes colour; its value is in the inspector.
    - **Unwatched assets.** The overview (1 Hz, headline values and the state point) reaches every asset; the 10 Hz
      frames only the at most `TELEMETRY_WATCH_LIMIT` (4) watched ones. A part follows its bound point, eased, while
      the console holds that point's reading (`CT-01`'s `FanBlade` and `FanMotor` on the overview; its `Valve`,
      `Switch` and `Pump`, and `GEN-01`'s `RadiatorFan`, only while watched). Otherwise it sits in the pose the model
      was authored in, and the inspector and callout read "—" as today. The watch limit is not widened for building
      focus; revisit it (ADR-0019) only if the video wall needs it.
    - **Alarm.** An open telemetry incident tints the whole asset at 35 % of its severity into the material at every
      level (frame 04); at asset level the parts bound to the rule's point also take the severity edge.
    - **Stale** (an asset is stale by the rule of V2-08.1: 3 × its shortest headline interval, 5 s at least) freezes
      every part at its last pose, without a run-down that would read as a real stop; faces take `--tw-stale-*` and the
      edge `--tw-stale-edge` (dashed). A fault is never hidden by a stale reading: an asset in stale _and_ fault keeps
      the alarm look, with stale-grey faces and the severity edge.
    - **Snap, not ease** (refined in V2-14.3, without changing the decision): on the first value after a model loads
      and on the first after a reconnect (the caller resets the previous value), and on a step of at least
      `SNAP_FRACTION` (0.5) of the bound's span, in the unit of the pose (rpm for a spin, the point's domain for a
      `turn` or a `slide`). The brief's "larger than the bound's range" is a step no in-domain value can make, since
      the API drops a reading outside `min` / `max`; so the threshold is a fraction of it. A boolean or an enum is
      discrete and eases by size, a breaker closing is a 290 ms motion, not a jump; only its first value snaps.
      `SETTLE_EPSILON` (0.001 of the span) says when a value has arrived and the loop may sleep.
    - **Reduced motion** shortens the camera's moves (V2-12.9) and stops the beacon's pulse (V2-16.3). It does not
      stop a spinning part: the spin is the reading, an essential movement under WCAG 2.2.2.
    - **A model that fails to load** leaves the asset as its neutral box, with one log line; the asset stays in every
      list.
- **Model contract.**
  - glTF 2.0 binary, **one file per asset class**, instanced for every asset of that class.
  - **Node names are part roles, unique within the file** (`FanBlade`, `FanMotor`, `Pump`, `Valve`, `Switch`), under
    a root named after the class. Code finds a part with `assetRoot.getObjectByName('FanBlade')`, so names are an
    interface: renaming one is a breaking change to the model.
  - Every bound node carries glTF `extras`: `{ "bind": "fanSpeedRpm", "motion": "spin" | "turn" | "slide" |
"tint", "axis": "x" | "y" | "z", "range": [min, max] }`; `axis` and `range` apply to `spin`, `turn` and `slide`,
    and a `tint` node (state only) carries neither. `bind` must be a `telemetry_point.key` of the class
    (ADR-0018). The console builds its bindings from `extras`, so a new class needs a model and catalogue rows, not
    code.
    - Settled in V2-09.1, without changing the decision: the models do not exist before V2-13, so until V2-14 binds
      from `extras` the inspector's Parts section is a code-owned table in the console (`lib/assetParts.ts`: role,
      label and bound point, from asset-classes.md) for the two modelled classes. V2-14 deletes it, and a class
      without a model has no Parts section.
    - Settled in V2-13.1 (2026-10-18, tech lead), without changing the decision; `pnpm models:check` and
      `ops/models/README.md` are its executable form:
      - **Size.** The model's real outside dimensions are authoritative and `footprint_m` follows them. The target
        dimensions given to the vendor are the catalogue's (width × depth × height): cooling tower 4.0 × 4.0 × 5.0 m,
        standby generator 6.0 × 2.5 × 3.0 m. The prototype's larger drawings (tower 8 × 6 × 5 m, generator
        12 × 3 × 3.8 m) are not data. If a delivery differs, `footprint_m` changes by a reviewed data change (a migration
        for the two classes' rows), never by the seed and never by the model; it is its own task.
      - **Trees.** Root `CoolingTower` / `StandbyGenerator` (the class in PascalCase). The tower is `Casing`,
        `FanStack`, `Pipe`, `Riser`, `ControlPanel` (static) and `FanBlade`, `FanMotor`, `Pump`, `Valve`, `Switch`
        (bound; asset-classes.md). The generator is `Enclosure` (static, drawn see-through), `FuelTank`, `Battery`,
        `Engine`, `Alternator`, `Radiator` (static) › `RadiatorFan` (spin), `ControlPanel` › `Breaker` (turn),
        `Silencer`, `ExhaustStack` (static).
      - **Materials by name.** Each glTF material is named for a console material: `Part`, `Steel`, `Concrete`, `Rail`,
        `Screen`, `Blade`, `Hub`, `Xray`. The console replaces the imported material with its own of that name
        (colours from `twinColors`), so hover, stale and alarm tint reliably; the vendor supplies baked ambient
        occlusion textures only. An unknown name falls back to `Part`; the checker rejects one.
      - **`extras`** as above, plus an optional `label` (the word the Parts row shows), so deleting `lib/assetParts.ts`
        (V2-14.10) loses nothing. Helper nodes whose names start with `_` are never listed as parts.
      - **LOD1** is a top-level sibling `<Root>_LOD1` with the root's pivot and no `extras`; the console builds a
        `LOD` from the pair.
      - **Counts.** "At most 50,000 triangles" is the class root's (LOD0); LOD1 adds at most a further 25 % of it.
        Counts come from accessor sizes, so Meshopt-compressed geometry is counted without decoding.
      - **File name** `<class code>.<first 12 hex of the SHA-256 of the file's bytes>.glb`; `model_key` is that name
        (`varchar(64)`). A replacement is a new name, never an edit.
  - Each bound node's pivot sits on its axis of motion; +Y up; 1 unit = 1 m; origin at the centre of the footprint.
  - Static nodes are merged at load; only bound nodes stay separate.
- **Budgets, checked by `pnpm models:check` in CI** (added in V2-13; no such script exists yet) on every `.glb` under
  `ops/models/`: at most 50,000 triangles, textures KTX2 and at most 1024², at most 4 materials, at most 1.5 MB,
  Meshopt-compressed geometry, every `extras.bind` a valid key of its class, every node name unique. The authoring
  commands (`gltf-transform` with `meshopt`, `uastc` / `etc1s`, and `simplify` for LOD1) are documented next to the
  models.
- **Serving.**
  - Files are named `<class>.<first 12 hex of SHA-256>.glb`. nginx serves `/models/` from a mounted directory with
    `Cache-Control: public, max-age=31536000, immutable`; a new model is a new file name, so no cache is ever wrong.
  - The demo's models are committed under `ops/models/` and mounted read-only; a real deployment mounts its own
    directory and sets `asset_class.model_key`.
  - The Meshopt decoder and the Basis transcoder (WASM) are copied from `node_modules` into the console build under
    `/decoders/` at build time, so they always match the installed three.js.
- **Testing.**
  - Pure modules carry the logic and are unit-tested in Vitest: easing, bindings built from `extras`, the
    east-north-up projection, staleness, camera clamps.
  - DOM around the scene (tooltip, callout, inspector, Assets tab, fallback) is tested with Testing Library as today,
    with the canvas mocked.
  - Real WebGL rendering is covered by the Playwright smoke (OCC-25, not built yet; Playwright is not installed)
    with a software renderer.

## Consequences

- **The 2D console costs nothing more.** Users of the 2D view, the fallback and the sign-in screens never load
  three.js.
- **New dependencies:** three.js, R3F, part of drei and three-mesh-bvh at runtime, gltf-transform in development.
  R3F follows React's major versions, so a React upgrade must wait for a compatible R3F release.
- **Equipment is reusable and data-driven.** One model per class serves every asset of the class; a new class is a
  model plus catalogue rows.
- **Part names are a contract** between whoever authors models and the code, enforced in CI.
- **Models are not behind sign-in**, like the console's own JavaScript. They show equipment shapes, not where any
  asset is (positions come from the authenticated API). If a site treats its models as sensitive, nginx can put
  `/models/` behind `auth_request`; that is not decided here.
- **Content Security Policy.** The console sends none today. When one is added, it must allow the decoders: WASM
  (`'wasm-unsafe-eval'`) and their workers (`worker-src 'self' blob:`).
- **Authoring needs skill and tools** outside this repository (Blender or a vendor export, then gltf-transform).
  CI rejects a model that breaks the budget, but cannot make a good one.
- **Accessibility does not come from the canvas.** The Assets tab and the inspector remain the accessible twin
  (brief); the canvas is one tab stop with a text summary.
- **Revisit** MapLibre with a custom layer if the twin must sit on a real basemap or terrain, and object storage
  for models if several sites share one deployment.

## Decided before acceptance

- **Part-name language** (brief, open question 1). Decided 2026-10-09 by the tech lead: English roles (`FanBlade`,
  `Switch`), as written in the model contract above; the request's Vietnamese examples (`CanhQuat`, `CongTac`) are
  not used.
- **Default view** (brief, open question 3). Decided 2026-10-09 by the tech lead, confirmed with the operations lead:
  3D by default on devices that pass the capability check; 2D is the switch and the fallback. The `localStorage`
  memory of the last choice is unchanged. With 3D as the default, the lazy chunk loads on start for capable devices;
  the 2D view, the fallback and the sign-in screens still never download it.
- **Video walls** (brief, open question 6). Decided 2026-10-08: 3D with a fixed camera (see Decision).
- **Model authors** (brief, open question 2). Decided 2026-10-09 by the tech lead: an external 3D vendor, with the
  model contract and budgets above in the purchase scope. Delivery order: `cooling_tower`, then `standby_generator`
  ([asset-classes.md](../design/v2/asset-classes.md)), both before V2-13 starts. The vendor's name and the calendar
  date are named when the purchase is placed.
- **Reviewed against the code** 2026-10-09 (V2-00.10, PR #32): facts corrected in place; no decision changed.
