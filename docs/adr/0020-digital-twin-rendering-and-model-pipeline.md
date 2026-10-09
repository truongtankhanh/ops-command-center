# ADR-0020: The digital twin renders with three.js in a lazy console chunk; models are budgeted, content-hashed static files

- **Status:** Proposed
- **Date:** 2026-10-08
- **Context documents:** [Console V2 design brief](../design/v2/brief.md), [ADR-0018](0018-assets-and-telemetry-as-domain-data.md), [ADR-0019](0019-telemetry-transport.md)

## Context

The V2 brief asks for a 3D stage with orbit, zoom and pan inside limits, hover and click on individual parts,
parts that move with live readings at 60 FPS, light models (`.glb`, under 50,000 polygons, 1K textures), no dynamic
shadows, and telemetry handled off the render thread.

The console is React 19 with Vite, TanStack Query, zustand and MapLibre for the 2D map (UI-08, UI-09). It runs on
laptops for 12-hour shifts, and on video walls at up to 3200 px wide (UI-17). Some of those machines will have weak
GPUs or WebGL disabled by policy.

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
  and fails above it. That number is a budget to confirm in V2-05, not a measurement.
- **Capability check.** The console renders the twin only if a WebGL 2 context can be created. Otherwise, and after
  a `webglcontextlost` that does not restore within 5 s, it shows the 2D map with the reason (brief, frame 07). The
  viewer's last choice of 2D or 3D is a per-browser convenience in `localStorage`.
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
    the site boundary + 40 m, zoom to cursor, damping, fly-to 600 ms or instant with reduced motion). The view never
    moves on its own.
  - Picking: raycast against BVH-accelerated meshes, at most once per frame.
- **State.** Selection, hover, level and the 2D/3D choice live in a zustand store (already a dependency). Readings
  never enter React state: the telemetry worker owns the `/telemetry` socket (ADR-0019), keeps the ring buffers and
  posts one `Float32Array` of targets per frame; `useFrame` eases bound nodes toward them in refs.
- **Model contract.**
  - glTF 2.0 binary, **one file per asset class**, instanced for every asset of that class.
  - **Node names are part roles, unique within the file** (`FanBlade`, `FanMotor`, `Pump`, `Valve`, `Switch`), under
    a root named after the class. Code finds a part with `assetRoot.getObjectByName('FanBlade')`, so names are an
    interface: renaming one is a breaking change to the model.
  - Every bound node carries glTF `extras`: `{ "bind": "fanSpeedRpm", "motion": "spin" | "turn" | "slide" |
"tint", "axis": "x" | "y" | "z", "range": [min, max] }`. `bind` must be a `telemetry_point.key` of the class
    (ADR-0018). The console builds its bindings from `extras`, so a new class needs a model and catalogue rows, not
    code.
  - Each bound node's pivot sits on its axis of motion; +Y up; 1 unit = 1 m; origin at the centre of the footprint.
  - Static nodes are merged at load; only bound nodes stay separate.
- **Budgets, checked by `pnpm models:check` in CI** on every `.glb` under `ops/models/`: at most 50,000 triangles,
  textures KTX2 and at most 1024², at most 4 materials, at most 1.5 MB, Meshopt-compressed geometry, every `extras.bind`
  a valid key of its class, every node name unique. The authoring commands (`gltf-transform` with `meshopt`, `uastc` /
  `etc1s`, and `simplify` for LOD1) are documented next to the models.
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
  - Real WebGL rendering is covered by the Playwright smoke (OCC-25) with a software renderer.

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

## Open before acceptance

- Part-name language: this ADR uses English roles (`FanBlade`, `Switch`), matching every identifier in the codebase;
  the request's examples were Vietnamese (`CanhQuat`, `CongTac`) (brief, open question 1).
- ~~3D by default on capable devices, or 2D by default with 3D as a mode (brief, open question 3).~~ Decided
  2026-10-09 by the tech lead, confirmed with the operations lead: 3D by default on devices that pass the capability
  check; 2D is the switch and the fallback. The `localStorage` memory of the last choice is unchanged. With 3D as the
  default, the lazy chunk loads on start for capable devices; the 2D view, the fallback and the sign-in screens still
  never download it.
- ~~Video walls: 3D at pixel ratio 1.0, or keep walls on the 2D map (brief, open question 6).~~ Decided: 3D with a
  fixed camera (see Decision).
- Who authors the first models (brief, open question 2).
