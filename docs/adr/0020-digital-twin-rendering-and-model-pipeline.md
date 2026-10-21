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
  - Amended in V2-17.3 (2026-10-20, the tech lead's decision): the budget is **375,000 bytes** gzipped, 25 kB more. After
    V2-17.2 the chunk was 345,375 bytes, 4.63 kB under 350,000, with the heat overlay's drawing (V2-17.3), its legend and
    picker (V2-17.4), the keys (V2-18) and the HUD and budgets (V2-19) still to land; the budget is raised rather than the
    scene trimmed now. It is a budget and not a measurement, as the first figure was: it is re-measured at V2-19.7 and kept
    or lowered then. The figures written in this ADR as "of 350,000" are what was measured at the time. The rule is
    unchanged (the build fails above the number, `scripts/chunk-budget.ts`).
- **Capability check.** The console renders the twin only if a WebGL 2 context can be created. Otherwise, and after
  a `webglcontextlost` that does not restore within 5 s, it shows the 2D map with the reason (brief, frame 07). The
  viewer's last choice of 2D or 3D is a per-browser convenience in `localStorage`.
  - Settled in V2-12.1, without changing the decision: from V2-12.4 to V2-19.8 the capability also requires a preview
    gate (a development build, or `?twin=1` for the tab), so the 3D view cannot reach operators before incidents are
    drawn in it (V2-16) and the frame budgets are measured (V2-19). Until the gate is lifted the reason shown is
    "3D view isn't available in this version". (Lifted in V2-19.8, below.)
  - Confirmed in V2-19.8 (2026-10-21), without changing the decision: the preview gate is removed. The capability is
    the WebGL 2 check and the recorded fault, in that order; `not-built`, its copy and `?twin=1` are gone, so a device
    that can create a WebGL 2 context opens in 3D unless the operator stored `2d`, and one that cannot opens in 2D with
    frame 07's banner. The probe is asked once per page load, when the store is created, so every page that loads the
    console, the sign-in screens and an operator whose stored choice is 2D included, creates and releases one
    throwaway context; the 2D view, the fallback and the sign-in screens still download none of the twin chunk. The
    twin chunk is 348,672 B gzip of its 375,000 B budget (348,670 B at V2-19.6). **The frame, main-thread, draw-call, triangle,
    first-useful-frame, idle and memory budgets were not measured on the reference hardware:** V2-19.7 was closed on
    2026-10-21 without a run, so they remain targets, and the HUD's "Frame (p95)" is still the interval between frames
    (about 16.7 ms at 60 Hz), which the 14 ms target cannot be read from. The release can be undone by restoring the
    gate in `lib/twinCapability.ts`; no data or contract changed. The blocks from "Settled in V2-15.1" onward are
    confirmed with this release.
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
    - **Layers in 3D** are Incidents and Cameras, and Inside at building level (V2-15.9; Heat arrives with V2-17). There
      is no Assets toggle: equipment is the scene.
    - **The loading card** lists the site plan, the 3D code and, from V2-14.7, one row per equipment model. It has no
      rows for buildings, which have no models.
    - **Not drawn, for lack of data:** frame 12's rack rows, and the prototype's substation, utility yard and gate posts.
    - **Where code lives.** Everything that imports `three` or `@react-three/*` is under `apps/console/src/twin/`;
      pure helpers stay in `src/lib/twin*.ts`, so they test without WebGL.
    - **Camera floor.** The written limit, 78° from vertical (12° above the ground), stands; frame 00's note "never
      below 8° above" is a drawing note.
  - Settled in V2-15.1 (2026-10-19, confirmed 2026-10-21 with V2-19.8), without changing the
    decision: how the four levels, picking, hover, the callout and building focus fit together. The brief fixes the
    levels, hover, click, Escape and the BVH rule; this block adds what a build needs to start.
    - **Level is derived, never stored twice.** `part` when a part is selected, else `asset` when `selectedAssetCode`
      is set, else `building` when a building is in focus, else `campus`. The store gains `focusZoneId` (the id of a
      `building` zone, else `null`), `selectedPart` (a node name, only ever set with an asset selected) and
      `hoveredPart`; `hoveredAssetCode` and `selectedAssetCode` exist. Selecting another asset, or none, clears
      `selectedPart`. `lib/twinLevels.ts` (V2-15.2) holds the derivation and the transitions, pure.
    - **The middle crumb is the focused building.** Selecting an asset (scene, Assets tab or inspector) flies to fit
      it and, when its zone is a `building`, focuses that building, so `Campus › Data Center › CT-01` and
      `Campus › Data Center › GEN-01`: `GEN-01` stands 3 m outside the footprint, but its zone is `BLD-DC` and the
      Assets tab groups it there. An asset whose zone is not a building has no middle crumb (`Campus › TR-01`; Utility
      Plant is `kind: utility` and has no building level, its assets are outdoors at campus level). Focusing a
      building also sets the Assets tab's zone filter (`assetZoneId`, as asset-classes.md § Order, filter and search
      says); leaving it clears the filter only while it still equals the building's id, so a filter the operator chose
      in between stays.
    - **The rest of the campus is faded, not removed.** At building, asset and part level everything but the subject
      is drawn at `--tw-ghost-opacity` (0.18), the token's own description. Frames 03 and 17 say "Isolated — the
      campus is hidden"; the legend line becomes "Isolated — the rest of the campus is faded. `Esc` returns to Data
      Center" (without a middle crumb: "… `Esc` returns to Campus"). Frame 08's "Enclosure shown see-through" is the
      model's `Enclosure` node in the `Xray` material (V2-13.9), not a state of the scene. Frame 12 and 15's "Walls
      see-through, other buildings faded. `Esc` returns to Campus" stand.
    - **Escape is one ladder, one step a press.** Close the callout and deselect the part → deselect the asset
      (closes the inspector) → leave the building → nothing. With focus in the inspector sheet, Escape takes the first
      two steps and stops there (V1's rule: the sheet is a panel); leaving the building by Escape works only while the
      3D view has focus, like every key the brief scopes there, so no panel's Escape is taken. At campus level Escape
      does nothing: it never switches to 2D. **Home**, while the 3D view has focus, goes to the campus level and the
      home view: it deselects the part and the asset, leaves the building (the zone filter clears by the rule above) and
      keeps an open incident and an open report form. Its help word is "Reset to the campus view" (frame 16's "starting view"
      and `Main`'s wording merge into this one).
    - **Picking precedence.** Beacon (V2-16) > part > asset > camera > building. Beacons and camera markers are
      sprites hit-tested in screen space (`lib/twinMarkers.ts`); everything else is one BVH raycast, at most once a
      frame, and the nearest surface on the ray wins, so a wall hides what is behind it. Kind decides only between a
      sprite and a ray hit under the same pixel. At campus level an asset is one target: its parts are pickable only
      while the asset is isolated, and a static part (merged at load, ADR-0020 § Model contract) is never a target;
      its Parts row stays read-only. At asset and part level only the isolated asset is pickable (the faded rest is
      not, and a click on nothing selects nothing and deselects nothing; Escape, Close, the crumbs and Home leave). At
      building level the faded buildings stay pickable, so a click moves the focus.
    - **Hover** shows the tooltip after 150 ms: name, code, the state word with its glyph of asset-classes.md § State
      of an asset (none when the state is unknown), the asset's first two headline readings as the Assets list writes
      them (the 1 Hz overview, no watch; one row when it has one, none when it has none), and a foot "Click to inspect
      · {place line}" (§ Place line, so `GEN-01` reads "Data Center" and `CT-01` "Data Center · roof"; frame 02's
      "east yard" and the bare "Click to inspect" of an inside asset are not data). An asset with no model ends "No 3D
      model · drawn as a box" instead (frame 15). The tooltip is never interactive and never a new source of a number
      (Principle 1). An `inside` asset hovered in the Assets tab at campus level tints its building, because nothing of
      it is drawn.
    - **The callout** (a part) reads "CT-01 · FanBlade" over the part's label (the `extras.label` the Parts row shows),
      the bound reading large with its unit and its age (or "last …" when stale), and "Limit 85 °C" or "Low at
      20 %" when a rule watches the key, as a Reading row writes it. Nothing else: no "Blade pitch", "Next service",
      "Rating", "Trips" or "Last operated" (no data), and no set point row (`fanSetpointRpm` is a point of the asset,
      not of the part; a candidate for the model's `extras` later). A part the console holds no reading for reads "—".
    - **The building summary** (frame 12) is three rows: "Assets — n · all reporting" (or "· k without data"), where
      _n_ counts the assets whose zone is the building, `GEN-01` included, as the Assets tab's zone filter counts them;
      "Open incidents — 1 · INC-000105" (none: "No open incidents"); and "Indoor — 22.1 °C", the building's heat
      reading (V2-17.1; omitted when it has none). No "IT load" and no "Power" row: no point is a building's load, and
      `powerSource` is not a headline. The frame's 7 assets is the frame's; the seed has 8 in `BLD-DC`.
    - **Focus** (the inspector's button, "added in V2-12" in asset-classes.md § Inspector words) is built in V2-15.11
      and shown only in the 3D view: it flies to the selection (`F` is V2-18.2's).
  - Settled in V2-15.3 (2026-10-19), without changing the decision: how the one raycast per frame is built.
    - **No separate pick proxy; the drawn meshes are raycast.** The task text called for a merged low-poly proxy "from
      each model's LOD1 or its box". The `_LOD1` sibling is dropped when a model is built (V2-14.7, level of detail is
      V2-19.5), and the shells and boxes are already single merged meshes with `ranges` tables, so a proxy would be a
      second copy that could diverge from what is seen. Instead: the shell faces and the box faces are registered with
      the picker as they are, and a hit's triangle names its building or asset through `entryAt` over the table
      (`lib/twinPicking.ts`); a model's own merged static meshes and bound parts are registered per instance, and a
      hit names the asset, or a part when the mesh sits under a node a binding names. The hidden `_edges` outlines are
      lines and are never registered. What can be hit is what is drawn: a mesh that is not drawn is unregistered.
    - **One bounds tree per geometry.** A `three-mesh-bvh` tree is built the first time a mesh using a geometry is
      registered (`twin/picker.ts`) and kept on `geometry.boundsTree`, so the instances of a class, which share their
      geometry, share one tree. Bound parts get one too: it is built in the part's local space and holds for a part
      that moves. No tree is rebuilt per frame; disposal on a level change stays V2-19.6's. The raycast is not
      `firstHitOnly`: a merged mesh holds many things and the nearest may be out of scope (a faded box in front of
      the isolated asset), so every crossing is named and `choose` filters.
    - **The scope** (`scopeOf`, from the store at the moment of the frame): at campus and building level buildings,
      assets and, while the Cameras layer is on, cameras (the faded buildings of building level stay pickable, so a
      click moves the focus); at asset and part level only the isolated asset and its parts; while a report location
      is being picked nothing, until V2-16.7 adds the ground. A bound part is a part only while its asset is isolated;
      otherwise a ray through it is its asset. Every node a binding names is a part, a `tint` included; any other
      mesh of a model is the asset.
    - **Which hit wins.** Of the ray hits the nearest, with hits within `TIE_EPSILON_M` (0.01 m, `unverified`) tied and
      won by the higher kind (part, asset, camera, building); a camera sprite and a ray hit under the same pixel are
      compared by kind only, never by distance. Camera markers are tested in screen space from the projected anchor,
      a target of at least 24 × 24 CSS pixels standing on it (`CAMERA_HIT_SIZE_PX`, WCAG 2.5.8, `unverified`).
    - **The seam to the pointer.** `lib/twinPicker.ts` is module state in the pattern of `twinCommands`: V2-15.4's
      `Pointer` calls `requestPick(point)` (CSS pixels from the canvas's top-left corner), the stage's `PickLayer`
      records the point and asks the on-demand canvas for a frame, and the ray is cast in that frame, at most one a
      frame; the winner is published to `onPick` listeners only when it changes. A frame with no request casts nothing.
    - **Measuring.** In development (`MODE === 'development'`, not `DEV`, which Vitest sets) `PickLayer` logs the count,
      mean and maximum cost of the picks once a second at `console.debug`; the brief's 0.5 ms is read from that on the
      reference laptop. No test asserts it.
  - Settled in V2-15.4 (2026-10-19), without changing the decision: how the pointer becomes hover, select and drag.
    - **A click is a press released within 3 px** (`CLICK_SLOP_PX`; 4 px is a drag, which is the camera's). The press
      is followed on the document once it has begun, as `camera-controls` does, so a release over the inspector sheet
      still ends it, and it counts as a click only if it is near where it began. Only the primary button clicks; a
      second pointer down (a pinch) is never a click. `DragHint`'s own 4 px, for when to stop showing its
      instruction, is a different question and is left as it is.
    - **A click gets the pick for its own point.** `requestPick(point, done?)` takes a completion that the canvas
      calls in the frame that casts the ray, whether or not the winner changed (`onPick` is silent when it did not);
      requests that arrive between two frames share it, the latest point is cast and every completion gets that
      answer, and the pointer asks for no hover while a click waits. This keeps one ray a frame.
    - **What a click does.** An asset: `toggleAsset(code, building)` (the selected one is deselected and its building
      stays in focus, the 2D map's rule, now one store action used by both); the body of the isolated asset at part
      level: the callout closes and the inspector stays (`unverified`); a part: `selectPart` (the selected one
      toggles off); a building: `focusBuilding`; a camera marker: `openViewer`. A click on nothing selects and
      deselects nothing, and while a report location is picked a click does nothing until V2-16.7 adds the ground.
      The actions are not permission-gated, so viewer, technician and operator behave alike; the inspector's footer
      and the API decide the rest.
    - **Hover.** Mouse and pen only, no button down, not while a click waits or a location is picked. An asset writes
      `hoveredAssetCode`; a part writes it and `hoveredPart`; a building or a camera writes neither (the cursor is
      their only hover here). The pointer takes back only what it wrote, also when it leaves the canvas, so a hover
      set by an Assets row is never cleared by it; a tap writes no hover.
    - **The cursor**, in this order: `crosshair` while a report location is picked, `grabbing` while a press has
      moved past the slop (any button), `pointer` over a pick, else `grab`.
    - **Where the code is.** The logic is `lib/twinPointer.ts`, a DOM controller with no `three`, tested with synthetic
      pointer events; `twin/Pointer.tsx` only wires it. Known gap, left to V2-15.5: when the camera moves under a
      still pointer no `pointermove` fires, so the hover and the cursor are stale until the next move.
  - Settled in V2-15.5 (2026-10-19), without changing the decision: how hover looks and speaks.
    - **Hover is the asset's look; a selected asset keeps its own.** `lookOf(flags, hovered, selected)` is called with
      `selected = false` for assets: frames 03, 08 and 17 select the _part_ and draw nothing on the asset, and frame 15
      keeps an inspected asset in its alarm look, which a selection tint would have hidden (Principle 2). The selected
      part's look is V2-15.10's. Hover sits above stale and alarm, as `lookOf` already says, and leaving restores them.
    - **A hovered part is tinted alone.** The pointer writes `hoveredAssetCode` and `hoveredPart` together, so while a
      part is hovered the asset around it keeps its own look and only the meshes under that bound node take the hover
      face and accent outline (`lib/twinHover.ts` `assetHover`, `twin/useAssetLooks.ts`). A node the model does not
      have, and a part of another asset, change nothing; a box has no parts.
    - **The paint loops read the store, not the feed.** `twin/useHoverRef.ts` subscribes to the store's two hover fields
      once per consumer, keeps a ref (a new object per change) and asks the on-demand canvas for a frame; the loops
      repaint the asset the hover left and the one it came to, and no other. `realtime/twinFeed.ts` stays free of
      UI state and of a store (this replaces the "with `getStore`" hand-over of V2-14.5 and V2-14.9); hover is not a
      reading, so the rule that readings never enter React state is untouched.
    - **A hovered `inside` asset tints its building.** Nothing of it is drawn at campus level, so the building of its
      zone takes `--tw-hover-top` (the accent at 30 % into the idle top, the tokens' arithmetic) while it is hovered
      (`lib/twinHover.ts` `hoveredShellZone`, `twin/shellLooks.ts`). The shells became one white material with a
      colour per vertex (`--tw-top` for every building, so the idle picture is unchanged; `unverified` until looked at),
      painted per building through `userData.ranges`: the first reader of the colour V2-15.8 and V2-17.3 also write.
      Hovering a building with the pointer tints nothing and says nothing yet (the cursor is its only hover).
    - **The tooltip follows the pick, for assets and cameras.** `twin/TwinTooltip.tsx` shows the bodies the 2D map's
      tooltip uses (`components/Tips.tsx`) after 150 ms of resting on one target, at the pointer plus 18 px, flipped to
      the pointer's left at the stage's edge and clear of the open sheet (`lib/twinTooltip.ts`); a part, a building and
      nothing get none, and a row hovered in the Assets tab gets none (it tints the asset; there is no pointer to put a
      tooltip beside). Its foot is "Click to inspect · {place line}", or "No 3D model · drawn as a box" for a class with
      no `modelUrl` (`AssetTip`'s optional `foot`; the map's foot is unchanged). It is `aria-hidden`, never interactive,
      and reads only the catalogue, the incidents and the 1 Hz overview: no watch, no new number.
    - **The known gap of V2-15.4 is closed for the tooltip only.** A press, a wheel turn, leaving the stage, a touch and
      picking a report location hide it, and it stays hidden until the next `pointermove`, so it never describes what
      a flying or damping camera has moved from under the pointer. The tint and the cursor can still be stale in that
      moment (re-casting the last point on a camera change was not done: it would touch the picking seam for a few
      frames of stale tint).
    - **Where the code is.** The tip bodies and their surface moved out of `MapTooltip` unchanged (`Tips.tsx`,
      `Tips.module.css`, the class exported by `tipSurface.ts`); `MapTooltip` keeps only its placement and its
      tests are untouched. Chunk: see the figure `-verify` reports for this task (the budget was 17,005 bytes under after V2-15.4).
  - Settled in V2-15.6 (2026-10-19), without changing the decision: how the level is shown and how the camera follows it.
    - **The camera follows the level through a watcher, not through the store's actions.** The task said `goUp()` and
      `goCampus()` call the fly commands; the store holds neither a building's box nor the stage's shape, which the
      fit needs, and the level changes in more ways than those two (a click on a building, a row, the crumbs, the
      Reset button, later the keys of V2-18.3). `twin/useLevelCamera.ts` listens to the store outside React and, when
      the level or the focused building changes, asks the rig for the new level's fit (`lib/twinLevelCamera.ts`,
      pure): campus → the home view; building → that building's box, whether the operator flies in by clicking it or
      back out of an asset; asset and part → nothing yet (V2-15.7). It reads the store only, never data, so the camera
      moves only for an operator's act, and it does nothing at mount.
    - **A fit is the rig's.** `twinCommands.fit({ bounds, heightM })` is a new command because only the rig knows
      the stage's aspect and the open sheet's inset. `fitBounds` (`lib/twinCamera.ts`, pure) fits the **box**: the
      footprint's corners at the ground and at the roof, looking at half the height from the home angles, within the
      campus limits (a building that would fit nearer than 60 m is shown from 60). With a height of nothing it is `homeView`.
      A building too small to have a shell falls back to its zone polygon. The asset's limits (4 – 40 m) are
      V2-15.7's.
    - **The first view.** The store keeps its level while the operator is in 2D, and the camera is back at home when
      3D returns, so the rig's first view is the fit of the focused building when the stage starts at building level
      (`startBoxOf`), not a flight at mount, which would race the canvas's children registering their commands.
    - **Home is campus level plus the home view.** The cluster's Reset button calls `goCampus()` and then `home()`,
      as ADR-0020 "Settled in V2-15.1" says (it deselects the asset, leaves the building, keeps an open incident and
      the report form) and flies home even from the campus level. Its name stays "Reset view"; "Reset to the campus
      view" is the keyboard help's word. No key is bound here: V2-18.3 calls `goUp()` and `resetView()`
      (`goCampus()` and `home()`), and the camera already follows the level ("Settled in V2-18.3").
    - **The breadcrumb is main-chunk code, in the switch's place.** `components/TwinBreadcrumb.tsx`, not
      `src/twin/` as the task wrote: it sits in `StageView`'s tools and `src/twin/` can only be crossed by the dynamic
      import (as the loading card, V2-12.11). The frames (03, 12, 15) put it where the 3D / 2D switch is, with the
      layers beside it at building level, not in the layers control's place as the task text says; so at building
      and asset level the switch is replaced, the layers stay, and the switch is one press of the back button away
      (and the context-lost fallback puts the 2D view and the switch back). Its parts are native buttons in a `nav`
      "Scene level" with an `ol`, and the current item is `<strong aria-current="location">`. The back button is one
      step of Escape's ladder: at the level of a part it closes the callout and its name says the asset; otherwise it
      names the previous crumb (`Campus` for an asset outside every building). After a press focus goes to the 3D view
      (`TWIN_VIEW_ID`), because the pressed control may be gone.
    - **No legend line here.** The asset's line ("Isolated — …") is V2-15.7's and the building's ("Walls
      see-through, …") V2-15.8's, which draws the walls it speaks of.
    - **Still open from V2-15.5:** with the camera flying under a still pointer the tint and the cursor are stale
      until the next move (the tooltip is handled); V2-15.7 is the next to move the camera and decides.
    - **Chunk.** The breadcrumb is main-chunk; the twin chunk gains the hook, `fit` and `fitBounds`. See the figure
      `-verify` reports for this task (334,669 bytes gzip of 350,000 after V2-15.5).
  - Settled in V2-15.7 (2026-10-19), without changing the decision: how an asset is isolated and the camera fits it.
    - **One watcher, and the asset is in its key.** The asset's flight is one more case of the V2-15.6 watcher
      (`useLevelCamera`, `lib/twinLevelCamera.ts`), not a second hook as the task named (`useFocusTarget`): selecting an
      asset in another building changes the level, the building and the asset in one store update, which must be one
      flight, the asset's. The level key gained the asset's code, because one level (`asset`) holds many selections and
      a second selection is a flight too; a part of the same asset is not.
    - **A fit of an asset is the rig's.** `twinCommands.fitAsset(box)` (separate from `fit`: a building is looked at from
      fixed angles within the campus limits). The box is the placed footprint turned by the pose, standing on its base
      elevation (`FitBox.baseM`; `CT-01` is on a roof): the model's bounds are the footprint by the model contract, so a
      class whose model has not arrived is fitted the same. The camera keeps the operator's own yaw and tilt (tilt held
      to 20° – 78°), the distance is the closest that shows the eight corners, held to 4 – 40 m (a sensor is shown from
      4 m), with the margin of the home view.
    - **Distance limits follow the level.** An isolated asset and its parts: 4 – 40 m; everything else: 60 – 900 m
      (`distanceLimitsOf`). The rig gives the controls a level's limits when a flight to it has landed, at the first
      view, or when a drag cancels the flight, and the **union** of both ranges during it, so the library never clamps a
      camera that is still far from the new range in a jump. The wheel therefore cannot zoom an isolated asset out
      past 40 m. `unverified` against the library's clamping: judged by eye.
    - **Beside the sheet, before it exists.** The fit is asked for in the same store update that opens the inspector, so
      the sheet is not in the DOM yet. The stage carries `--sheet-inset-open` (the sheet's width, 0 on a phone, in
      `App.module.css`, registered in `tokens.css`) beside `--sheet-inset`, and the asset fit uses the larger of the two
      insets: no timing, and the phone breakpoint stays in the stylesheet.
    - **Leaving is the parent's fit, not the old pose.** Closing the inspector, Escape in the sheet, another selection,
      Home: the building's fit or the home view of V2-15.6. No earlier pose is saved. An incident selected or a report
      started while an asset is isolated clears the asset and so flies out; that is leaving the asset, not flying to the
      incident, which V2-16.1 still owns. The first view of a stage that starts with an asset isolated (3D → 2D → 3D)
      is its fit.
    - **The rest is faded, not removed.** `lib/twinLevel.ts` holds the rule (`isolationOf`, `isFaded`): every building
      but the asset's, every other asset and the camera markers are drawn at `--tw-ghost-opacity`; the ground and the
      zone labels are not (the ground faded against the background would only vanish; the labels are V2-15.8's). Picking
      was already isolated (V2-15.3, 15.4). How it is drawn: the shells and the boxes are still one merged mesh each, with
      two materials (as they are, faded: transparent, no depth write) and **geometry groups** from the per-building and
      per-asset ranges, so isolating rebuilds nothing and the picking tables do not move (a test with real three guards
      it); the models take a pooled `ghost` look (`MaterialTable.look`), one more material per name, never a clone per
      instance; the markers an opacity uniform. A faded fault keeps its tint at the faded opacity (`ghost` is a state of
      the look, not a colour). **The outlines of faded equipment are not drawn** (a model's are hidden, a box's leave both
      edge layers) and the faded shells keep theirs at the faded opacity: the boxes' edge layers are indexed and split by
      stale, so a faded outline would be a third layer and draw call; context is a faint volume, and the stale dash and
      the severity edge return with the level. V2-15.8 puts the focused building's see-through look in the same groups.
    - **The legend is one line.** While an asset is isolated the legend is the line of frames 03 and 17, in place of its
      toggle and entries: "Isolated — the rest of the campus is faded. `Esc` returns to Data Center" (Campus for an asset
      in none; nothing after the first sentence while the building is not known yet). `Esc` works from the sheet, and
      in the scene while the 3D view has focus (V2-18.3, "Settled in V2-18.3"); the breadcrumb's back button is the same step. At part level the
      line is the asset's; V2-15.10 may want to say that the first Escape closes the callout.
    - **Not drawn yet.** `inside` assets (`LKS-B3`) are drawn with their building in focus by V2-15.8, so the camera
      flies to one, behind opaque walls, and nothing of it is on screen until then.
    - **Still open from V2-15.5, decided:** the hover tint and the cursor are stale under a camera that flies under a
      still pointer until the next move; at asset level only one asset is pickable, so the staleness is small, and
      re-casting the last point when a flight ends would touch the picking seam for a few frames. Left as it is.
    - **Chunk.** The twin chunk gains the asset fit and limits, the groups, the faded look and the uniform; the legend
      line is in it too. See the figure `-verify` reports for this task (334,669 bytes gzip of 350,000 after V2-15.5;
      V2-15.6's figure is not recorded).
  - Settled in V2-15.8 (2026-10-19), without changing the decision: how a building in focus is drawn.
    - **One rule decides how everything is drawn.** `presenceOf` (`lib/twinLevel.ts`, extending V2-15.7's `isFaded`) gives
      each building, asset and camera marker one of `drawn`, `faded`, `xray` or `hidden` from the focus (`focusOf`: the
      building in focus and, at asset and part level, the isolated asset). The shells, the boxes, the models, the markers
      and the pick scope read it, so they cannot disagree. A building is `xray` when it is the one in focus and `faded`
      otherwise; an asset is `hidden` when it is `inside` a building that is not in focus, `drawn` when its zone is the
      building in focus (so `GEN-01`, which stands outside the footprint, and `CT-01/02` on the roof are drawn with the
      Data Center) and `faded` otherwise; markers are `faded` only while an asset is isolated, not at building level.
    - **See-through at every level below the campus.** The building in focus is see-through at building, asset and part
      level (frame 15 draws an inspected box inside a see-through building); the other buildings and the equipment of
      other buildings stay faded at all three. With no building in focus (`TR-01`) the asset-level rule of V2-15.7 is
      unchanged. The look is the `Xray` material of the models: the idle face at `--tw-xray-opacity` (0.14, no depth
      write), its outline `--tw-hub`, no new colour token.
    - **Groups, not a rebuild.** The shell's faces and outline have three materials (as it is, faded, see-through) and
      `groupsForLooks` (`lib/twinGroups.ts`) turns the looks into the geometry's groups, as V2-15.7 did for two: this
      replaces the "per-building attribute" the task suggested, which would have needed a shader and would have shared
      the colour attribute of hover and heat (V2-17.3). A `hidden` span is in no group, so it is neither drawn nor hit
      (`three-mesh-bvh` only tests the triangles inside a group of a multi-material mesh). The boxes are built once from
      every box asset, `inside` ones included, and hidden by their groups and by their outline index lists
      (`edgeIndices` takes the set of the codes that keep an outline); a model instance is made once for every modelled
      asset and only mounted, and registered with the picker, while it is not `hidden`, so its bound parts keep their
      pose across a focus. Focusing and leaving rebuild no geometry.
    - **Draw calls are groups.** A mesh costs one draw call per group, and the boxes, in asset-code order, interleave
      drawn, faded and hidden spans: at most two groups for each drawn box plus one (a bound of 17 for the Data Center of
      the seed, against the budget of 150 and about 11 calls at campus level before). The code order is kept; a development log
      (`twin/DrawCallLog.tsx`, `renderer.info`, until the HUD of V2-19.1) reads the real figure, and ordering the merged
      boxes by zone is the follow-up if it is far higher. `unverified` until read in a browser.
    - **The focused building's walls are not a target (refines "Settled in V2-15.1").** The nearest-surface rule said a
      wall hides what is behind it, which holds for an opaque building and would make the equipment inside a
      see-through one unclickable from outside. `PickScope.excludedBuildingId` is the building in focus at building
      level: a ray goes through its walls to the equipment behind them, and a click on a wall with nothing behind it
      does nothing. The faded buildings and the faded equipment of other buildings stay pickable, so a click on them
      moves the focus, as V2-15.1 already said for buildings; the frames' scene made them dead, which is not kept.
    - **The labels fade by the focus alone.** The zone labels of every building but the one in focus are drawn at
      `--tw-label-faded-opacity` (0.35, a CSS-only token: WebGL does not draw labels), at building, asset and part
      level; with no building in focus nothing fades. It is a `data-faded` attribute from the store (`ZoneLabels`),
      not a per-frame write: the projector still owns the position.
    - **The legend at building level** is frame 12's line, "Walls see-through, other buildings faded. `Esc` returns to
      Campus" (`buildingLine`), in place of its toggle and entries, as V2-15.7 did for the asset. At asset and part level
      the isolation line of V2-15.7 stays (frames 03 and 17); frame 15 draws the see-through line there, which is a
      "Frames to revise" row of the brief. `Esc` was bound later, by V2-18.3 ("Settled in V2-18.3"); the breadcrumb's back button is the same step.
    - **Tests.** No DOM test of `Buildings`: it renders three objects inside `<Canvas>` and jsdom has no WebGL, as for
      its siblings. The guarantees are in the pure rule and groups (`twinLevel`, `twinGroups`, `twinBoxes`,
      `twinPicking`), in `picker.test.ts` with real `three` (a hidden span is not hit, the focused shell is skipped, no
      bounds tree is rebuilt by a focus), and in the DOM tests of `ZoneLabels` and `TwinLegend`.
    - **By eye, still to do in a browser:** that the opaque boxes show through the near walls of the see-through shell
      and that the transparent passes order as intended (shell 9 and 10, faded boxes 12); that no hole or flicker
      appears on focusing and leaving; clicking `UPS-01` from outside; the labels; and the draw-call figures.
    - **Chunk.** The twin chunk gains the rule, the third material, the log and the labels' fade; see the figure `-verify`
      reports for this task (336,916 bytes gzip of 350,000 after V2-15.7).
  - Settled in V2-15.9 (2026-10-19), without changing the decision: the building summary and the Inside layer.
    - **Inside is the building level's layer.** `SceneFocus` carries `inside` (`lib/twinLevel.ts`) and `presenceOf` reads
      it: with it off and no asset isolated, the building in focus is `drawn` (opaque) instead of `xray` and its `inside`
      assets are `hidden`; its roof and outdoor assets (`CT-01/02`, `GEN-01`) stay drawn and the other buildings stay
      faded. At asset and part level `focusOf` makes it `true`: the isolated asset is drawn and the shell stays
      see-through (frame 15), whatever the operator chose. The store keeps the operator's value, so `Esc` back to the
      building finds Inside as it was left, and selecting an asset does not turn it on (the precedent of Incidents and
      Assets, which do, is for a layer whose marker the map is about to centre on; here isolation already shows the
      asset). Nothing is rebuilt: the shells, boxes and models follow the groups and the mounted instances, as in
      V2-15.8. The focused walls are still not a target (V2-15.8), so with Inside off a click on them does nothing.
      The hover of an `inside` row in the Assets tab tints the opaque shell (`hoveredShellZone` asks `presenceOf`).
    - **The scene layers are a type of their own.** `SceneLayers` (`lib/twinLayers.ts`) is the map's `LayerVisibility`
      plus `inside`, so the 2D map reads the store as it did and has no layer it cannot draw; `layersOf(view, level)` is
      the control's list: 2D the three map layers; 3D Incidents and Cameras, plus Inside at building level only, where
      it does something. Frame 12 draws "Incidents · Inside · Heat" with no Cameras: Cameras stays, because
      `CameraMarkers` still reads it and a hidden toggle for a layer that is off would strand it (a "Frames to revise"
      row). Heat joins the list with V2-17.4 the same way.
    - **The building summary** (`lib/twinBuilding.ts`, `twin/BuildingSummary.tsx`) is shown at building level only: at
      asset level the inspector carries the asset and frame 15 has no card, and at part level the callout of V2-15.10
      does. A region named "{zone} summary", an eyebrow ("Building · data center", the zone's `use` as a word, "Building"
      without one), the name and three rows; not a live region. It stands at the top right like frame 12 and is
      offset by the open sheet (`--sheet-inset`) as the camera controls are.
    - **What the rows count.** "Assets" counts the zone's assets, `GEN-01` included (8 in the seed's Data Center, the
      frame's 7 being the frame's), and "without data" those the Assets tab lists under "No data" (`nodata` and
      `offline`), so the two give one number. Because a fault is never hidden by a stale reading, a stale fault counts as
      reporting here, although the scene draws it grey. "Open incidents" counts the active ones (`open` and
      `acknowledged`, the tiles' rule) raised in the zone or at one of its assets, once each, and names the first in the
      feed's order (most severe, then newest); with none it reads "None", under the label, not the echo "No open
      incidents" of "Settled in V2-15.1". While the incident list has not loaded the row is left out rather than read as
      "None".
    - **The interim indoor rule** (until V2-17.2's `buildingReadings` replaces it, and V2-17.1 settles the heat reading):
      the zone's assets that have an `indoorTempC` point (not a list of class codes), in code order, the first that is
      online and not stale on the server clock; one decimal. A stale or offline source is skipped and no source omits the
      row, so a stale temperature is never shown beside "all reporting". The mean of the fresh sources is V2-17.1's
      proposal, not this rule.
    - **Tests.** The pure rules (`twinBuilding`, `twinLayers`, `presenceOf`, `hoveredShellZone`, a group case), the store,
      `LayersControl` and a DOM test of the card, which needs no canvas. `visibleAssets` had no reader left once the hover
      asked `presenceOf`, and is gone.
    - **By eye, still to do in a browser:** the shell going opaque and the boxes disappearing with no flash or hole when
      Inside is toggled, the roof equipment staying, the hover of an `inside` row on the opaque shell, the draw calls at
      building level with Inside off, and the card's place beside the incident sheet and on a narrow stage.
  - Settled in V2-15.10 (2026-10-19), without changing the decision: the selected part, its callout and its leader.
    - **The selected part keeps the accent look, at 1 px.** `lookOf(flags, false, true)` (`selected`) gives the same
      face and edge as the hover: the part's face takes 30 % of the accent and its outline is the accent. A part is
      painted in it from the click until it is deselected, over the asset's own look (an alarm or a stale dash stay on
      the rest of the asset), and a part that is both hovered and selected is one paint. `useModelLooks` takes the
      selection as a fifth, defaulted argument (`useSelectedPartRef`, the hover ref's twin) and `partsPicked`
      (`lib/twinHover.ts`) decides which nodes of a model are picked and why. The frames' "2 px accent edge" is not
      built: the outlines are `LineSegments`, which WebGL draws 1 px wide, and the 2 px of the frames' scene is a
      canvas stroke. Fat lines (`Line2`) would cost a second geometry and material per part, a draw call and bytes
      the chunk's budget needs for V2-16 and V2-17; the callout and the leader are the strong cue. A candidate for
      V2-19 if it is missed.
    - **The callout is `calloutOf`'s answer** (`lib/twinCallout.ts`), built from what the inspector already holds for
      the asset (`useAsset`, `useModelParts`, the telemetry store and the server clock; no request of its own).
      Where the task wrote `calloutOf(asset, binding, …)` it takes the model's **`PartRow`** (`partRows`), the source
      of the label the Parts rows and the incident link already use. The eyebrow is "CT-01 · FanBlade" (the node as the
      model names it), then the part's label; the big value is `readingParts` (`lib/readings.ts`: the figure and the
      unit apart, a word such as "Closed" with no unit); "Limit 85 °C" or "Low at 20 %" comes from `limitLine` for the
      first rule on the point. The figure is `--type-3xl` and the unit `--type-l` (frame 03's 30 px has no token).
    - **Stale and unknown readings.** A stale or offline asset reads **"last 1,420 rpm"** (the Parts row's own wording)
      with the age beside it ("1 min old", `formatAgeCoarse`, two units at most so it does not change every second);
      a live one reads "Live". A bound part with no reading reads "—" with no age; a node of the model that binds
      nothing reads "static"; with the asset's detail or the model's tree still on its way the part reads "—" under
      its node's name in sentence case, and the card opens all the same. Nothing is announced: it is not a live region.
    - **A named dialog that takes no focus.** `role="dialog"` named for the part, no `aria-modal`, no focus trap and no
      focus moved on open: it opens from a click on a canvas beside a live scene, and the 3D view is the stage's one tab
      stop. It comes after the view in the DOM, so Tab reaches its real Close button. Close and Escape pressed inside
      it close the card only (`selectPart(null)`), keep the asset and its inspector, and give focus back to the 3D view,
      as the breadcrumb does. **The inspector's own Escape** (with focus in the sheet, today `selectAsset(null)`, which
      ends the part and the asset together) is **not changed here**: its "part, then asset" step is V2-15.11's, with the
      rows that make a part reachable from the sheet. The legend at part level is unchanged (the scene's Escape is
      V2-18.3's; the breadcrumb's back button already names the step).
    - **The leader is drawn from the frame loop.** An SVG over the stage, `aria-hidden` and under the card, from the
      card's right edge (measured by the card with a `ResizeObserver` when its box changes, never per frame) to the
      centre of the part node's world bounds (`Box3.setFromObject`, so a spinning blade's anchor moves with it).
      `LeaderProjector`, inside the canvas under `Equipment`, projects it as the zone labels are (`stagePoint`) on
      each **drawn** frame while a part is selected and writes the line and the dot through refs only when the rounded
      line changed (`leaderLine`, `sameLine`): no React state and no render per frame. It hides when nothing is
      selected, the card has not been measured, the node is not in the shown instance, or the anchor is behind the
      camera or off the stage. The stage owns the refs (the overlay's line and dot, and where the line starts) and no
      child writes to a ref it was handed: the card reports its edge through a callback, and the stage keeps it and asks
      the on-demand canvas for a frame through the `invalidate` it already holds.
    - **A card family.** `TwinCallout.module.css` repeats `BuildingSummary.module.css`'s surface: two copies are
      tolerated and a shared popover surface is extracted when a third appears.
    - **Tests.** The pure modules (`readings`, `twinCallout`, `twinHover`, `twinLeader`), the painter with real `three`
      (`useAssetLooks`) and a DOM test of the card; the writer inside the canvas is not unit-tested (no WebGL in jsdom,
      as for its siblings). jsdom has no `ResizeObserver`, which the card test stubs for itself.
    - **By eye, still to do in a browser:** the selected blade keeps its tint after the pointer leaves; the leader sticks
      to a spinning blade while orbiting, hides behind the camera and off the stage, and the canvas draws no frame at
      rest; the generator's breaker reads "Open" or "Closed"; a stale asset reads "last …" and its age; the card stays
      clear of the tools row on a narrow stage; Close and Escape in the card leave the inspector open.
  - Settled in V2-15.11 (2026-10-20), without changing the decision: the Parts rows select, and the inspector's "Focus".
    - **A bound row is selectable, in the 3D view only.** `selectable = view === '3d' && row.bind !== null`: a static
      part is merged into the model at load and is never a target (V2-15.1), so its row stays read-only, and in the 2D
      view there is no scene to show a selection in, so every row is read only, as before (no control that does
      nothing). Click, Enter or Space selects (`selectPart`, which opens the callout) and flies to the part; the same on
      the selected row selects nothing again and does not fly, as a second click on the part does. The rows are
      `li role="treeitem"` with `aria-selected` on selectable rows only; one tab stop, the arrow keys, Home and End are
      as before. `aria-selected` follows the store, so a click on the blade in 3D marks its row.
    - **Hover writes the asset and the part.** The scene ignores a part hovered without its asset (`assetHover`), so a
      row writes `hoverAsset(code)` and `hoverPart(node)`, as the pointer does, and takes both back on leave. On unmount
      (the inspector closes under the pointer, which fires no `mouseleave`) it takes back only what it wrote and only if
      the store still holds it, so a hover written meanwhile by the map or the Assets tab stays. A part hovered in the
      scene marks its row (`data-hovered`).
    - **The look is the frames' accent tint, not the scene's `--tw-hover` colours.** `--tw-hover-*` are opaque WebGL
      face colours and cannot be a row background; hover is `--accent-tint`, selected is the same tint with the 55 %
      accent edge and glyph (frames 03, 08 and 17 `.tree-row[aria-current]`). No new colour.
    - **"Focus" is the inspector's foot button, for every role.** Shown iff the 3D view is in effect and the scene draws
      the asset (`focusAvailable`: not `hidden` by `presenceOf`, which only an `inside` asset whose building is not in
      focus is). It follows the report button as a `flex: none` ghost button, and ends the viewer's note through the
      note's new `action` slot. It has no `F` hint until V2-18.2.
    - **How it flies.** The foot is main-chunk code and the part's bounds live in the lazy chunk, so `lib/twinFocus.ts`
      holds a resolver the canvas registers (`useFocusTargets`, under `Equipment`): the part's world bounds at the
      moment of the call (a spinning blade is where it is now), else the asset's box. `focusSelection` hands it to the
      camera's existing `fitAsset`, so the camera, `TwinCommands` and the rig are unchanged. The distance floor of
      4 m for an isolated asset and its parts holds, so a small part is shown from 4 m, centred on its bounds.
    - **Escape is the ladder's first two steps in the sheet.** With focus in the inspector, Escape closes the callout
      (`selectPart(null)`) and the next press closes the asset; the Close button ends both at once. `Sheet` calls its
      `onClose` for Escape alone, so `AssetInspector` passes it the stepping handler and `Sheet` is unchanged. The Close
      button keeps its `Esc` hint (one press away from the second step).
    - **Tests.** `lib/twinFocus.test.ts` (the box, the availability rule, the registry), `AssetParts.test.tsx` (new:
      selection by click and keys, the 2D read-only case, the hover and its cleanup, axe), and `AssetInspector.test.tsx`
      (the Focus matrix by role and view, the Escape order). The resolver's `Box3` reading and the flight are not
      unit-tested (no WebGL in jsdom, as for their siblings).
    - **By eye, still to do in a browser:** clicking "Fan blade" flies to it and opens the callout; the blade clicked in
      3D marks the row; a row hover tints the part and leaving clears it; closing the inspector under the pointer leaves
      no stuck hover; "Focus" re-frames the part, and the asset after Escape; the viewer's note and "Focus" share one
      row; the foot in 2D has no "Focus"; the ghost button reads on the foot's surface.
  - Settled in V2-16.1 (2026-10-20, confirmed 2026-10-21 with V2-19.8), without changing the
    decision: how incidents are drawn in 3D, when the camera moves for them, and how a location is picked. Each proposal
    of the task is accepted unless a bullet says "changed".
    - **Beacon height: accepted, with the asset's height from the box the camera already fits.** An incident that
      belongs to an asset (`assetId`, resolved in the Assets list) stands at the top of that asset: the base elevation
      plus the model's height, which is the box's (`assetBoxes`: `baseM + heightM`; the footprint follows the model,
      Model contract). An incident whose position is inside a building's footprint (the footprint ring `placementOf`
      uses, so 2D and 3D agree) stands at the building's roof (`heightOf(zone)`); any other is at 0. An incident whose
      asset the console does not hold yet is placed by its position. The shipped cooling-tower stand-in is 5 m tall on
      a 14 m roof, so `CT-01`'s beacon is at 19 m; frame 04's 20.8 m is the frame's 6.8 m stack (a "Frames to revise"
      row), and the other heights in the frames (0, 14, 16, 20 m) are the frames', not a rule.
    - **Set and look: accepted, with the pulse rule stated as the map's.** The set and the fan-out are the 2D map's
      (`incidentFeatures`, `fanOut`: active incidents, and the selected one even when resolved). A beacon is a filled
      disc while the incident is `open` and hollow while `acknowledged`; a critical one is larger and **pulses while it
      is critical and open** (`isPulsing`, the map's own rule; the task's "while fresh" is not a second rule), and the
      pulse stops under reduced motion. A telemetry incident carries a tag with its asset's code (frame 04); the
      selected one has an accent ring (frame 10). The Incidents layer switches the beacons, as it does the markers.
    - **The camera moves only when asked: accepted, with the level rule kept.** Selecting an incident (feed, search,
      toast, beacon) opens its sheet and rings its beacon and **does not fly to it**; a new incident never moves the
      camera (principle 4). The camera moves for "Fly to", `F` and "Show in 3D". Selecting an asset flies, because the
      Levels table says so. One thing is unchanged and is not "flying to the incident": `select` clears the asset (the
      sheet is exclusive), so an incident selected while an asset is isolated leaves the asset, and the camera leaves
      with the level (the parent's fit, "Settled in V2-15.7"). At campus and building level nothing is isolated, the
      level does not change and the camera stays where it is. This closes the phase's open question 9.
    - **Fly to, Open incident, Show in 3D: accepted, with the order fixed.** "Fly to" (toast) selects the incident and
      then flies to its beacon: the flight is asked for after the selection, so it replaces the leaving flight above
      (the rig holds one flight). It keeps the camera's yaw and tilt and takes the beacon as target, from the current
      distance but no farther than 120 m (`unverified`, judged by eye). "Open incident" selects only. "Show in 3D"
      (the sheet's asset link) flies to the incident's asset **without selecting it**, so the sheet stays open (frame 10) and no asset is isolated: the level is campus or building, whose distance limits (60 m and up) apply, so the
      asset is shown from at least 60 m. With no rig (the 2D view, a stage that has not loaded) a flight is a no-op and
      the selection still happens.
    - **Pick in 3D: accepted, with the scope rules unchanged.** A click hits the nearest of the building shells (roofs
      included) and the ground plane, under the scope of "Settled in V2-15.8" (the walls of the focused building are
      not a target); the pin takes that hit's east and north through the scene frame (`fromLocal`, the exact inverse of
      `toLocal`) and is drawn at the hit's height, so a click on a roof lands inside the building and stands at the
      roof. The incident keeps only its longitude and latitude; the API's zone containment check (`400` outside) is the
      control. Frame 09's z = 20 m is the frame's roof, not a rule (a "Frames to revise" row).
    - **Non-telemetry incidents: accepted, and `F` made consistent with the brief's keyboard table.** An incident with
      no asset has no "Show in 3D" (frame 10 draws it on the asset link only). `F` with an incident open flies to its
      asset when it has one (the brief: "Incident panel: show the incident's asset in 3D") and to its beacon when it
      does not; with an asset or a part selected it is "Focus" (V2-15.11).
    - **The toast: accepted.** In 2D the toast keeps its single action, "View incident". In 3D it offers "Fly to" and
      "Open incident" (frame 04), for every role, because both only read. The actions are chosen when the toast is
      shown, from the view in effect; if the operator switches to 2D while it is up, "Fly to" still selects and the
      flight is a no-op.
    - **Not settled here:** the beacon's model (a sprite or a mesh, its size on screen) and its place in the pick
      precedence beyond "Beacon (V2-16) > part" are V2-16.3 and V2-16.5; beacons stay out of the pick scope while an
      asset is isolated, as every other target, so a beacon is reached then through the feed, the search or the toast.
  - Settled in V2-16.2 (2026-10-20, confirmed 2026-10-21 with V2-19.8), without changing the
    decision: how an incident becomes a beacon, as plain data (`lib/twinBeacons.ts`, `beaconsOf`). Drawing is V2-16.3's.
    - **The set and the positions are the map's.** The drawn set is the map's (active incidents, and the selected one
      even when resolved), `x` and `z` are `fanOut`'s position over that set through the scene frame, so two incidents
      at one point are spread the same way in both views. `isPulsing` (critical and open) is exported from
      `mapFeatures.ts` and is the only pulse rule. The fan-out's distances (3.5 m to group, 4.4 m between neighbours)
      are the map's, tuned for its pixels; the 3D view has no clusters and draws screen-sized sprites, so beacons that
      share a point can still overlap at campus distance. That is expected, not a defect of the data.
    - **A resolved beacon has its own form.** `form` is `filled` (open), `hollow` (acknowledged) or `resolved`: a
      selected resolved incident is neutral and the same size whatever its severity, as on the map, so it is never
      `big` or `pulse`. `big` is critical and not resolved (the frames' one larger beacon; the map's 10 / 11 / 12 px
      discs are the map's), and `type` reads `UNKNOWN_TYPE_IMAGE` for a type this console does not know.
    - **Height, as V2-16.1 said, with the details fixed.** An incident whose `assetId` the catalogue holds stands at
      that asset's top: the caller's `assetTopM(asset)` (the model's top once it is loaded) or, with none or an
      `undefined` answer, `elevationM + class.footprintM.height`, which is the box the camera fits. An `assetId` the
      console does not hold is "no asset": no tag, and the position rule. Otherwise the roof: the incident's **own
      zone** must be a `building` with a footprint, and the incident's **own position** (not the fanned-out one, so
      incidents spread on a ring stay on the roof) must be inside it; the height is the shell's (`heightOf(zone)`,
      the default 12 m when the zone has none). Any other case, including a position in the footprint's 8 m inset
      band, a zone that is not a building and a zone the console does not hold, is 0. The tag is the asset's code.
    - **The list is ordered by incident `code`,** unique and unaffected by an acknowledgement, so a caller can compare
      two lists. `position[1]` is the marker's ground point (the stem's foot), the `MarkerPlacement` convention.
    - **Not data, so not here:** reduced motion (the pulse off) and fading by level are the drawing's (V2-16.3), and
      picking is V2-16.4's. The function reads no store and no preference.
    - **Tests.** `lib/twinBeacons.test.ts`: frame 01's eight and frame 04's telemetry ninth, the roof and its edge
      cases, the resolved form, selection, the fan-out, an unknown type, an unresolved `assetId`, the order and
      purity.
  - Settled in V2-16.3 (2026-10-20, confirmed 2026-10-21 with V2-19.8), without changing the
    decision: how the incident beacons are drawn (`twin/Beacons.tsx`, one draw call).
    - **Never faded, over all geometry.** Unlike the camera markers, a beacon is drawn at full strength at every level
      (the frames that isolate an asset or focus a building still draw them) and has no depth test, so an incident
      behind a wall is still seen. It does not wait for a model: it needs the zones the stage already has. It is hidden
      when the Incidents layer is off (the mesh stays, it is not drawn); selecting an incident turns the layer on.
    - **The cues are the 2D marker's, nothing new.** Severity is the hue and the disc's size step (10, 10, 11, 12 px),
      status is filled versus a ring, the type is the glyph, a telemetry incident carries its asset's code on a pill,
      and the selected one an accent ring. The canvas is `aria-hidden`; the accessible twin of a beacon is the incident
      feed and the Assets tab (principle 1). The bitmaps are the map's (`markerSvg`, `renderMarkerImages`).
    - **One mesh, a few cells.** A beacon is up to four sprites of the camera markers' layer (`Markers`): the pulse
      ring, the selection ring, the base (a ground ellipse at 35 % severity, a 2 px stem in the severity hue and the
      bitmap, 28 × 42 px, standing on the ground point) and the tag pill. The rings and the pill are sprites of their own
      with a pixel offset from the base's anchor, so the atlas holds a base per form, a ring per disc radius, one pulse
      ring and a pill per tag, not a cell for every combination. `Markers` gained optional per-sprite offset and
      phase and a clock; a camera has none and renders as before.
    - **A growing atlas.** The set of forms is data, so the atlas appends cells without moving the old ones
      (`lib/twinAtlas.ts`, shelf rows up to 2048 px wide) and only the forms that are new are rasterised. The pill's
      font is awaited before it is measured and drawn; its width is the drawn cell's, and a pill whose cell is not in
      the atlas yet is skipped until it is. The texture is rebuilt larger when a cell is added and the old one disposed.
    - **The pulse is the map's wave.** The ring grows 0.7× to 1.8× about its centre while it fades 0.9 to 0 with a
      quadratic ease-out over `mapMotion.pulseMs` (1800 ms), from the constants `lib/mapPulse.ts` now exports, in the
      shader; every pulse has phase 0 (the beacons pulse together, like the map's one wave). The on-demand canvas is
      asked for the next frame only while the layer is shown, motion is allowed, the tab is visible and a beacon
      pulses (`pulseRunning`); under reduced motion the pulse ring is not placed at all and the critical beacon keeps
      its size and ring. The clock is an object the layer writes from its frame loop: no React render per frame.
    - **Paint order** is by priority, independent of the data's order (by code): resolved, then low to critical, open
      above acknowledged, the selected beacon last; a beacon's ring is under its disc and its pill over it.
    - **Where the data is read.** The incidents and the catalogue are queries, which a canvas child cannot read, so the
      stage derives the beacons (`useTwinBeacons`: `beaconsOf` over the cached incidents, catalogue, zones, frame and
      `selectedIncidentId`) and hands the canvas the list, like the scene and the feed.
    - **Tests.** The packer and the sprite builder (cells, offsets, paint order, the pulse decision) are pure and
      tested without WebGL; the sprite arrays in `twinMarkers.test.ts`; the stage test reads the `beacons` it hands the
      mocked canvas. `Beacons`, the atlas hook and the shader are R3F glue and untested, as `Markers` is.
    - **By eye, still to do in a browser, and the chunk to measure:** the demo's incidents at campus level before any
      model appears; open filled and acknowledged hollow; the critical beacon larger, pulsing and tagged; the ring on
      the selected one; a beacon behind a wall; nothing with the Incidents layer off; no pulse under reduced motion and no
      frame drawn at rest with no critical incident; a new type adding one form without a flicker; an `inside` incident on
      its roof; the twin chunk's gzip size after `pnpm build` (10,403 B were left).
  - Settled in V2-16.4 (2026-10-20, confirmed 2026-10-21 with V2-19.8), without changing the
    decision: how a beacon is hovered and selected, and how the incident's zone is outlined on the ground.
    - **A beacon is hit in screen space, on its disc.** It is a sprite, so it is not in the ray cast: the picker
      projects its ground point, lifts it by the stem (`DISC_CENTRE_PX`, a fixed number of screen pixels) and tests a
      circle of the disc's radius plus 4 px (`BEACON_HIT_PAD_PX`, `unverified`), which is 28 px across for the smallest
      disc, above the 24 px of WCAG 2.5.8. The stem, the ground ellipse and the tag pill are not targets. A beacon
      wins over everything else under the pixel (a part, an asset, a camera, a building: first in `KIND_ORDER`), as
      "Settled in V2-15.1" says, and is in the scope only at campus and building level while the Incidents layer is on:
      never with an asset isolated or a report location being picked.
    - **Overlapping beacons: what is on top is what is hit.** The nearest disc centre wins, unless another is within 1 px
      of it (`BEACON_TIE_PX`, `unverified`), and then the one painted later wins: the same number that paints
      (`paintRank`: resolved, then low to critical, open above acknowledged, the selected one last, exported from
      `lib/twinBeaconSprites.ts` and not copied). Beacons that share a point overlap exactly (the 3D view has no
      clusters), so the tie is the common case.
    - **The hit list is what is drawn.** `Beacons` moved inside `PickLayer` and registers, through the picker, the
      beacons whose base sprite is placed (`beaconTargets`), as `Buildings` and `Equipment` register their meshes
      ("Settled in V2-15.3"); one whose bitmap has not decoded is not a target. Where the paint order comes from is
      `renderOrder`, not the place in the tree.
    - **Click selects, as the map's.** `select(id)`, and a second click on the selected beacon deselects (the rule is the
      pointer controller's, `selection().incidentId`, tested with synthetic events). It is not role-gated: a viewer, a
      technician and an operator all select the same beacons, and the sheet's footer (the designed view-only note of
      frame 11) and the API decide the rest; nothing in the pick or in `beaconsOf` takes a role. It is not gated by the
      report form either (only `picking` blocks, as on the map), so a click on a beacon while the form is open closes
      the form and discards the draft, as the map's click does; V2-16.7 owns the report form in 3D and may revisit it.
      A beacon writes no hover (the cursor is `pointer`, the tooltip follows the pick).
    - **The tooltip is the map's incident tooltip.** After 150 ms on one beacon (`TIP_DELAY_MS`) the body is `IncidentTip`
      (title, severity, status, code, zone, age), shown only for an incident that is active or the selected one, as
      `MapTooltip`'s rule, so one that has just left the picture says nothing. The existing rules hold: hidden on a
      press, a wheel turn, leaving, a touch and `picking`; `aria-hidden`, never interactive.
    - **The camera stays still.** Selecting, switching and closing an incident, from the feed, the search, the toast or a
      beacon, moves no camera command, at campus or building level (a test now says so); the ring follows
      `selectedIncidentId` whatever opened it (V2-16.3). "Fly to", `F` and "Show in 3D" are the only ways the camera
      moves for an incident (V2-16.5, V2-16.6, V2-18).
    - **The zone outline is a ribbon.** The selected incident's zone, or the report's while the form is open (the 2D
      rule: the report's wins, and with no zone chosen yet nothing), is outlined on the ground in the accent. A WebGL line
      is one pixel wide whatever is asked, so the outline is a mesh: the existing road ribbon over the zone's closed
      ring (`lib/twinHighlight.ts`), `HIGHLIGHT_WIDTH_M` = 2 m (`unverified`, tuned by eye), so it **thins with distance**
      instead of staying 2 px as the map's. One draw call, depth tested and not written, `renderOrder` between the
      building faces and their outlines, so the outer half of a building's outline shows and a ring behind a wall is not
      drawn through it. It does not follow the Incidents layer, as the map's does not (it marks a place, not an
      incident).
    - **Tests.** The pick rules (scope, `beaconHits`, `choose`), the pointer's click and hover, the paint rank and the
      targets, the picker with real `three` objects, the tooltip, the zone rule and the ribbon, the stage's
      `highlightZoneId` and the camera guard are tested without WebGL. `PickLayer`, `Pointer`, `Beacons` and
      `ZoneHighlight` are R3F glue and are not, as before. The role-by-role, number-matching and axe cases are V2-16.8's.
    - **By eye, still to do in a browser, and the chunk to measure:** hover a beacon (the tip after 150 ms, the pointer
      cursor); click selects, rings it and opens the sheet; a second click deselects; the camera does not move; selecting
      from the feed rings it; nothing is hit with the Incidents layer off; two beacons on one spot pick the more severe;
      a beacon in front of a building or an asset wins; the outline of the selected incident's zone and of the report's,
      its width at campus and at building distance, and against a building's walls; a technician on an out-of-scope
      incident sees the view-only footer; the twin chunk's gzip size after `pnpm build` (7,417 B were left).
  - Settled in V2-16.5 (2026-10-20, confirmed 2026-10-21 with V2-19.8), without changing the
    decision: how the toast of a new incident offers "Fly to" in the 3D view.
    - **The toast has two actions in 3D, one in 2D, chosen when it is made.** With the 3D view in effect at the moment
      the toast is built (`useConsole.view`), a new critical or high incident toasts with "Fly to" as its action and "Open
      incident" as its secondary one, for every role, because both only read; the same pair for either severity and either
      source. In 2D it is the single "View incident", exactly as before. A toast already shown is not rebuilt if the view
      changes (V2-16.1 says so); the telemetry reading that arrives later changes only its words (`updateToast`), so the
      pair on screen stays.
    - **"Fly to" selects, then flies; "Open incident" only selects.** `select(id)` and then `flyToIncident(id)`, in that
      order, so the flight replaces any flight the selection starts (an asset isolated: the camera leaves it with the
      level, "Settled in V2-15.7", and the beacon's flight takes over). **The handler checks no view**: in 2D the stage and
      the rig are unmounted, no commands are registered and the flight does nothing, which is "Fly to still selects and the
      flight is a no-op" ("Settled in V2-16.1") without a second rule. Nothing moves the camera when an incident arrives, nor
      when its reading is added (a test says so), nor on "Open incident".
    - **A narrow command, not a widened `flyTo`.** `TwinCommands` gained `flyToIncident(id)`; `flyTo(FlyTarget)` is
      unchanged and `home` and `fit*` stay their own commands. The task proposed `flyTo({ kind, id })` for incident, asset,
      part and home; only one kind is needed here, and "Show in 3D" (V2-16.6, a different rule: no selection, the level's
      60 m floor) and `F` (V2-18.2) have not shown yet what a general subject-flight looks like (Rule of Three). It
      costs one key in the commands' test fakes.
    - **The rig resolves the position from the beacons the stage draws.** The caller of the toast (`useLiveIncidents`, in the
      main chunk) has the incident and not the scene's frame, so `Rig` takes the stage's `beacons` as a prop, keeps the
      latest in a ref, and finds the one with the id when it is asked; an incident with no beacon (not drawn, or unknown) is
      a no-op after the selection. The pose is a pure function, `incidentView(position, now)` in `lib/twinCamera.ts`: the
      target is the beacon's **ground point** (the foot of its stem, so the disc stands above the middle of the view), the
      camera's yaw and tilt are kept, and the distance is the current one but at most `INCIDENT_FLY_DISTANCE_M` = 120 m
      (`unverified`, judged by eye); the rig then flies it through its usual limits (60 m floor at campus and building
      level, the pan box, the tilt limits) and the 600 ms tween (one frame under reduced motion).
    - **`Toast` has a second action.** `ToastAction` names the shape once; `Toast.secondaryAction` is optional and shown
      only with an `action`, between it and Dismiss (frame 04's order), as a default-variant `Button` with its own
      `data-toast-control`. One `run(action)` hands focus off, runs, and dismisses for both, so the existing rule holds
      (the same control of the neighbouring toast, else its first button, else where focus came from) and an urgent toast
      still stays until dismissed. A toast without a secondary action renders as before. The labels are plain, without
      frame 04's asset code and `F` hint (the key is V2-18.2's) and Dismiss stays a text button.
    - **Tests.** The pose and the camera limits, the command forwarding, the store and the component (order, each handler
      alone, focus, keyboard, absence, axe), `incidentToast` with and without the way to fly, and the live-incidents role
      table in both views (the V2-11.5 table, changed on purpose) are tested without WebGL; `Rig` and `TwinCanvas` are R3F
      glue and are not, as before.
    - **By eye, still to do in a browser, and the chunk to measure:** a critical and a high arrival in 3D show the pair
      and the camera does not move; "Fly to" opens the sheet and flies in about 600 ms, keeping yaw and tilt, at most 120 m
      away, and ends with the beacon in view (its disc above the middle); from an isolated asset it leaves the asset and
      still ends at the beacon; "Open incident" selects without moving; the toast goes after either; Tab, Enter and Space on
      each button and where focus lands; the three buttons fit at the wall scale (a `flex-wrap` on `.actions` is the fix if
      not); reduced motion; the 2D toast is unchanged; the twin chunk's gzip size after `pnpm build` (6,729 B were left).
  - Settled in V2-16.6 (2026-10-20, confirmed 2026-10-21 with V2-19.8), without changing the
    decision: how the incident sheet's "Show in 3D" frames the incident's asset.
    - **A second button beside "Open asset", for every role, wherever the twin is available.** On the sheet of an incident a
      telemetry rule raised (the only incident with an asset link: "Settled in V2-16.1", frame 10), `AssetLink` has "Show
      in 3D" next to "Open asset". It is drawn when the twin is available (the preview gate, WebGL 2, no lost context),
      **whatever the current view**: from the 2D map it is the way in. Where the twin is unavailable it is not drawn
      (not disabled). Looking is reading, so no role is excluded.
    - **It selects nothing and changes no level.** It does not call `selectAsset` or `focusBuilding`, so the incident
      sheet stays open, the beacon stays ringed and no asset is isolated (frame 10). The level is campus or building, so
      the campus distance limits apply and the asset is shown from at least 60 m: the existing `limitPose`, not a new
      rule. For an asset the scene does not draw (an `inside` one with its building not in focus) the camera still frames
      its place and the beacon, which is drawn over everything, shows where; focusing the building on a "Show" press
      would change the level and the breadcrumb, which nobody asked for. This is a known limit.
    - **A narrow command, resolved by the rig.** `TwinCommands.showAsset(code)`, not the task's `flyTo({ kind: 'asset',
isolate: false })`: the second narrow command after `flyToIncident` ("Settled in V2-16.5"), and still not the third
      subject (`F`, V2-18.2), so a general subject-flight is not built yet. The rig takes the asset's box from the stage's
      placed asset boxes (`assetBoxes`, the box the isolate fit already uses), read through a ref so the latest is used,
      and flies the isolated fit's view (the middle of the box, the camera's own yaw and tilt) through its usual limits
      and the 600 ms tween. It is not the drawn box (`lib/twinFocus.ts`' resolver): the placed box needs no model, and the
      models are still loading in exactly the 2D case. An unknown asset does nothing.
    - **From 2D the request waits for the stage.** The button switches the view and asks in the same tick, but the 3D
      stage is a lazy chunk, then a scene, then the rig. With no rig, `twinCommands.showAsset` keeps **one** pending
      request (the latest wins), and `registerTwinCommands` runs it when the rig registers and drops it, so it runs once. It
      expires after `PENDING_SHOW_MS` = 15 s (`unverified`, long enough for a slow chunk) so that a switch that never
      finished cannot fly a camera at a later, unrelated mount. The camera lands at the home view and flies in: a visible
      "Show in 3D" working. The flight is asked for only when the view really is `'3d'` after `setView`, which does nothing
      where the twin cannot be drawn, so a refused switch queues nothing. `flyToIncident` has no queue: a toast is offered
      once a stage exists.
    - **The name, the glyph.** The visible text is "Show in 3D" and the accessible name `Show in 3D CT-01` (the visible words
      first, then the code, as "Open asset CT-01"), which satisfies WCAG 2.5.3. The task's "Show CT-01 in 3D" would not
      contain the visible words, a voice command "click Show in 3D" would not match it, and the task cites 2.5.3 itself.
      The glyph is `Box`, the view switch's 3D glyph, already in `ui/icons.ts`; frame 10 draws `focus` (corner brackets)
      and the inspector's "Focus" uses `Crosshair`, so adding one more export and an icon row for one button was not
      worth it. Frame 10's `F` hint arrives with V2-18.2.
    - **Tests.** The pending request (queued, run once, the latest wins, the edge of the window, expired, not run twice,
      not disturbed by other commands) is tested with a fake clock; the sheet's button has a role matrix (operator,
      supervisor, technician, viewer), a view matrix (3D only flies; 2D switches and the flight waits; unavailable, not
      drawn; a refused switch queues nothing), the name, no selection, and axe. `Rig` is R3F glue and is not, as before.
    - **By eye, still to do in a browser, and the chunk to measure:** from 2D one press switches to 3D and the camera ends
      framing the asset from about 60 m with the incident sheet still open and the beacon ringed; from 3D it only flies,
      keeping yaw and tilt; no inspector opens and the asset is not selected; the same for a viewer; the button is gone
      without WebGL 2 or the preview gate; an `inside` asset (the camera frames the building, the beacon shows where);
      the two buttons in a narrow sheet and at the wall scale (a wrap on `.assetActions` is the fix if they crowd the
      heading); reduced motion; the twin chunk's gzip size after `pnpm build` (6,655 B were left).
  - Settled in V2-16.7 (2026-10-20, confirmed 2026-10-21 with V2-19.8), without changing the
    decision: how the report's location is picked, shown and dragged in the 3D view.
    - **A pick can answer with a place.** `PickKind` gained `'ground'` and `PickRef` a variant with coordinates (scene
      metres, no id). While the location is picked the scope is the building shells and the ground, nothing else (no
      asset, part, camera or beacon, as the 2D map hits nothing but the ground), and the picker answers with the
      **nearest** of the shell crossings (roofs and walls, from the ray's own intersection points) and the ground plane
      `y = 0` (an analytic ray–plane intersection: the ground is drawn but is not a mesh the ray meets). The rule is a
      pure function, `nearestSurface`; `choose`, hover and every other kind are untouched. The building in focus is still
      not a target ("Settled in V2-15.8"), so a click through its see-through walls lands on its floor.
    - **A click places the pin by the map's rule.** The pointer controller, which did nothing while picking by design,
      now asks for the pick at the release point as a click does and a `ground` answer calls `placePin`; an answer that is
      a thing, or that arrives after picking ended, does nothing, and no hover is asked while picking. The point becomes a
      longitude and latitude (`frame.fromLocal`) and goes through `placePinAt`, moved verbatim to `lib/reportPin.ts` so
      the 2D map and the 3D view place pins by one rule (`zoneAt`, the API's own): the zone it is in is selected, outside
      every zone the pin stays and the existing message shows. The function stays coupled to the console store, where the
      location lives.
    - **The pin is a screen-sized sprite at a derived height.** One `Markers` sprite with its own one-cell texture of the
      2D marker's drop (the same path, the accent, a ground-coloured edge and centre), over the beacons, drawn whenever the
      form is open and `reportPosition` is set however it was set (a click, the zone select, a preset), so it survives
      orbiting. Its height is **derived, not stored**: the roof of the building whose footprint contains the position
      (the ring the shells and the beacons use), else the ground, and the floor inside the building in focus (a roof that
      is not drawn must not carry it). A click on a wall therefore snaps to the roof when inside the footprint, which is
      "lands inside the building".
    - **Dragging it without the camera orbiting.** Whether a press is on the pin is decided at once, by a screen-space
      test of its tip (`pinHits`, 24 × 34 px, the picker projects the tip as it does the beacons') reached through a
      second function on the pick seam, `pinUnderPoint`, because the press has to decide before the camera's controls
      hear it. The controller's `pointerdown` listener is registered in the **capture phase**, and on a primary-button
      press on the pin while picking it calls `stopImmediatePropagation()` so `camera-controls` never starts an orbit;
      it takes pointer capture, asks for the place under each move and shows the pin there (a preview held in a small
      module with `useSyncExternalStore`, not in the store, because it changes on every move and is not a location until
      it is dropped), and on the release asks once more and drops it: `placePinAt` runs, so a drop outside every zone
      puts the pin back where it was, as the 2D marker does. A cancel, a release the window lost, a second pointer (a
      pinch) and tearing the controller down drop it nowhere. A move between the release and its answer is not a cancel.
      **This depends on the capture-phase ordering against `camera-controls` and on touch, which no unit test can prove**:
      it is checked by hand in a browser (mouse, pen, touch), and the fallback if it proves unreliable is no drag (the pin
      moves by clicking elsewhere).
    - **Escape stops picking, in 3D only.** A capture-phase `keydown` on the document, owned by the report form
      (`useStopPickingOnEscape`, enabled while the 3D view is in effect and `picking`), ends picking and stops the key so
      the sheet's own Escape does not also close the form or announce the kept draft; the next Escape is the sheet's. It
      works wherever focus is (after a click on the canvas it is on the body). In 2D no listener is added, so Escape there
      is exactly what it was.
    - **The hint and the label.** A `PickHint` pill on the stage (frame 09's `.map-hint`: "Click the scene to place the
      incident · Esc stops picking"), decoration like `DragHint`; the form's toggle reads "Pick in 3D" while the 3D view is
      in effect and "Pick on map" otherwise. `aria-pressed` and the zone select stay the keyboard route. The report's
      zone outline is "Settled in V2-16.4".
    - **Tests.** `placePinAt`, the pin's height and hit rectangle, `nearestSurface`, the scope while picking, the seam's
      `same()` for places, the picker with real `three` objects (a roof's point, the ground, the floor inside the excluded
      building, a ray that goes up, the pin's tip), the controller with stub deps (a click places the pin, the whole drag
      lifecycle, the capture-phase stop), the drag preview, the hint, Escape and the label are tested without WebGL.
      `Pointer`, `PickLayer`, `ReportPin` and the pin texture are R3F glue and are not, as before. There were no cases of
      `placePinAt` to move: it was private to `CampusMap`, so `reportPin.test.ts` is new and `CampusMap.test.tsx` is
      unchanged.
    - **By eye, still to do in a browser (and by hand on touch), and the chunk to measure:** a click on a roof of
      Dormitory B puts the pin at that roof's east and north, zone Dormitory B; the lake and the lawn put it in theirs;
      outside every zone leaves the pin and shows the message; the pin stands on the roof's height and stays put while
      orbiting; a building in focus puts it on the floor; dragging it follows the pointer and the camera does not orbit, a
      drop in another zone selects that zone, a drop outside returns it; Esc stops picking and the form and its draft
      stay; the hint and "Pick in 3D"; 2D unchanged; a viewer has no form; the twin chunk's gzip size after `pnpm build`
      (6,617 B were left).
  - Settled in V2-17.1 (2026-10-20, confirmed 2026-10-21 with V2-19.8), without changing the
    decision: what the heat overlay reads, how it colours a building and what it does to the rest of the scene. Each
    proposal of the task is accepted unless a bullet says "changed" or "rejected". The same facts are written as rules in
    `asset-classes.md` § Heat overlay.
    - **Source: accepted, with the key and not the class.** The sources of a building are the assets whose `zoneId` is the
      building and that have an `indoorTempC` point (today the air handlers and the indoor climate sensors; the roof air
      handler counts, it measures the zone), and the reading is the overview's `headline.indoorTempC`, which the 1 Hz
      overview already carries for every asset, so Heat asks for no watch and adds nothing to the telemetry path
      ("Settled in V2-14.5"). A class added later with the key counts with no change here. The building card's "Indoor" row
      ("Settled in V2-15.9") is the **same number** as the heat label, and `buildingReadings` (V2-17.2) replaces that row's
      interim "first fresh source" rule for both, so the two cannot disagree.
    - **Aggregate: accepted, the mean of the fresh sources.** A source is fresh when it is online and not stale on the
      server's clock by its own asset's rule (three times the shortest headline interval: 90 s for an air handler, 180 s for
      a sensor); with no clock yet a reading cannot be judged and is not stale, as the building card and `hasDimmedAsset`
      say. An asset in fault with a fresh reading counts: a reading is a reading, the overview's state does not matter
      here; a stale or offline source never does, and a source with no value yet is not a source. The mean is taken on the
      raw values and rounded only for the label. Rejected: the maximum (one hot sensor would hide a cool building, and a
      breach is an incident's business), the median (it means nothing with one or two sources, which is the demo), and the
      first source (the interim rule: it lets the code order choose the number).
    - **Silent: accepted.** A building with no fresh source is silent, whether it has no source at all, a stale one or an
      offline one: faded at `--tw-ghost-opacity` (0.18) and labelled "No data", the word the Assets tab uses for an asset
      with no data. One word for "no sensor" and "sensor silent" is deliberate: the Assets tab, filtered to the zone, says
      which. Zones that are not buildings have no shell and no reading.
    - **Scale: accepted, fixed 19 – 27 °C, clamped; the colour spelt out.** `t = clamp((mean − 19) / 8, 0, 1)`; fixed so
      that two days compare and the legend's 19 · 23 · 27 °C is true of every frame (frame 13's `heat` values are exactly
      this: 22.0 °C is 0.375, 21.4 °C is 0.300, 26.4 °C is 0.925). The six `--heat-0 … --heat-5` stops sit evenly at
      `t` = 0, 0.2, 0.4, 0.6, 0.8, 1; the colour is **piecewise linear in sRGB** between neighbours and converted to the
      working space as the zone fills are, so a shell's colour is the legend's swatch at a stop and continuous between
      them (the legend shows the six stops, not six bands). Lightness carries the value (the ramp's pairs against the
      ground are reported only, `docs/design/tokens.md`). Rejected: a data-driven range (a cool day and a hot day would
      look alike). The **label** is the real mean to one decimal, "22.0 °C", also above 27 or below 19: the colour clamps,
      the number does not. 27 °C is the air handler rule's limit but the overlay draws no breach.
    - **Layer: accepted, with the building and asset levels spelt out.** Heat is a layer of the 3D stage, off by default and
      not remembered, like the others. On, at campus level: every shell takes its colour, equipment is ghosted at
      `--tw-ghost-opacity` unless it is in alarm (an open incident of its own), hovered or selected, beacons are unchanged
      (never faded, "Settled in V2-16.3") and cameras follow their own layer, not Heat (the mockup turned Cameras off by
      choice; that is not a rule). **Changed, at building level:** the focused building stays see-through and its edge and
      label carry the colour, and **its own equipment keeps its look** (it is the subject; ghosting it under an X-ray shell
      would leave nothing to look at); the other buildings keep the level's fade and their colour at that fade, and a silent
      one is the level's neutral fade, so only its "No data" label tells it from a non-heat fade. **Changed, at asset and
      part level:** the layer stays on but draws nothing different: the isolated asset is the subject, the shells keep
      V2-15.7's neutral fade and the legend stays, so toggling Heat is never a surprise there.
    - **Picker: accepted as drawn.** "Colour by" is a control that opens a listbox with one option, "Indoor temperature",
      shown while Heat is on (frame 13 draws it only then; off, it would be a dead control). A second measure is a data
      addition, not a redesign. Rejected for now: `humidityPct`, although it is the sensor's second headline, because the
      air handler has no such point (its second headline is `supplyAirTempC`), so a building with an air handler would
      always be silent for it; it needs a source rule and a scale of its own when it is wanted.
    - **Not alarms: accepted.** The ramp is the accent's hue; no severity hue is used, so no warm building looks like a
      fault (`docs/design/tokens.md`). A building above 27 °C is the brightest and nothing more. A building with only a
      sensor never raises an incident for being hot: the sensor has no rule on purpose ("comfort alerts would flood the
      feed", `asset-classes.md`), and an air handler's "Zone too warm" is its own incident.
    - **Where the numbers also are.** The legend, the building card's "Indoor" row and the Assets tab's readings carry
      every number the colours stand for; the canvas stays `aria-hidden`.
    - **Left for the tickets, `unverified` until looked at:** the continuous colour against the legend's six stops, a
      silent building's look at campus level next to the 0.18 fade of the level, and where the labels stand.
  - Settled in V2-17.3 (2026-10-20, confirmed 2026-10-21 with V2-19.8), without changing the
    decision: how the heat overlay is drawn, what it costs and where it is wired. Each question of the ticket's analysis
    was answered with its recommendation.
    - **One value, `HeatScene`.** The overlay is data (`lib/twinHeat.ts`): a `#rrggbb` per building with a reading, the
      silent zones, the line under each building's name, the silent buildings' names, the assets in alarm and a `key`.
      One stage hook builds it (`useHeatScene`, because `<Canvas>` has no query client) and hands it to the canvas, the
      labels and the 3D view's name; `null` means "not shown" and every reader then does nothing. It is one object while
      its `key` is equal: the clock ticks every second and most seconds change nothing a reader draws, and an identity of
      its own would repaint a quiet scene and wake the on-demand canvas for nothing. While the layer is off the hook follows
      neither the overview nor the clock (`useServerNow(active)`): each overview re-anchors the clock, so following it
      costs a render a second. Nothing is said before the catalogue is there (never "every building is silent").
    - **Campus and building level only (Q5).** With an asset isolated, or one of its parts, the layer stays on and draws
      nothing different: no colours, no silent fade, no ghost, no temperature lines, no sentence. This is the one place the
      level is read (`showsHeat`), so the five things cannot disagree.
    - **The shells.** The colour is the shell's own vertex colour (`paintHeat`), written when the overlay changes, with no
      geometry touched; a building with no reading keeps the idle top and is faded by its **group**, the same mechanism as
      V2-15.7/15.8 (`presenceOf` takes a `HeatFade`, at campus level only). The hover tint of a hidden `inside` asset wins
      over a colour while it is hovered and the building goes back to its ramp colour, not to idle. At building level the
      see-through building's outline (material 2, `--tw-hub`) takes its ramp colour (Q4); its faces keep the see-through
      look.
    - **"No extra draw call" (Q3) means** no new mesh, no material beyond the three of V2-15.8, no geometry rebuild, and the
      draw calls of a frame within the brief's budget (150). A silent building is a group of the merged mesh, and a mesh
      costs one call per group, so with silent buildings the faces and the outline can each have up to two calls more
      than with every building drawn as it is, as they do with a focus; adjacent runs of one material stay merged.
    - **The equipment (campus level).** Every drawn asset is faded unless it is in alarm (`openIncidentOf`, the feed's own
      rule, so the ghost lifts exactly where the severity tint shows) or under the pointer. The hovered code is read as
      React state only while the overlay is shown at campus level; a selection is asset level, where the overlay is not
      shown. Boxes and models already follow the presence map, so neither painter changed. Beacons and cameras are not
      part of the rule; a lifted asset in alarm keeps its severity tint, the only warm colour on screen.
    - **The labels.** A building's label has a second line, its temperature or "No data" (`ZoneLabels`), out of flow under
      the name so the name stays on its anchor and the projector's by-index contract is untouched. It is in the light text
      colour (`--text-primary`, 13 px, as frame 13 draws it), not in the ramp: the dark end of the ramp would not read on
      the ground. A zone that is not a building has none.
    - **The accessible name (Q6).** The canvas is `aria-hidden`; the sentence is part of the 3D view's name
      (`twinSummary`), between the incident clause and the pointer: "Campus coloured by indoor temperature per building,
      19 to 27 °C; lighter is warmer." and, when a building is silent, "{names} faded: its (their) sensor is silent." The
      scale is passed in as data because `twinSummary.ts` is main-chunk code. The number agrees with the count.
    - **State.** `heat` is a key of `SceneLayers` (`false` by default, not remembered); nothing offers the toggle until
      V2-17.4 adds it to `layersOf`.
    - **Left for the tickets, `unverified` until looked at:** the ramp on the shells against the legend's six stops, a
      silent building beside the 0.18 fade, the temperature line's place and size, and the draw calls with silent
      buildings (`DrawCallLog`, development build).
  - Settled in V2-17.4 (2026-10-20, confirmed 2026-10-21 with V2-19.8), without changing the
    decision: the Heat toggle, the "Colour by" picker and the legend. Each question of the ticket's analysis was answered
    with its recommendation.
    - **The toggle is `layersOf`'s, at every 3D level.** Heat is the last entry in the 3D list (frames 12 and 13:
      `Incidents · Cameras · [Inside] · Heat`), at campus, building, asset and part level, for the reason Cameras stays:
      at asset and part level it draws nothing different, but a toggle that vanishes while it is on would strand the
      state. The 2D map never offers it. Off by default and not remembered, as V2-17.3 left the state.
    - **The picker and the legend follow the level, not the list (Q3).** They show only where the overlay is drawn:
      the layer is on and the level is the campus or a building (`showsHeat`, the one place the level is read), so
      nothing explains colours that are not drawn. The "legend stays" of "Settled in V2-17.1" is read as the marker
      legend and its lines: toggling Heat at asset level changes nothing on screen.
    - **The picker is main-chunk code (Q1), and `showsHeat` moved.** "Colour by" stands in the tools row beside the layers
      (frame 13), which `StageView` renders in the main chunk, and a main-chunk module cannot import the lazy chunk's
      `twinHeat.ts`. So `components/ColourBy.tsx` is not in `src/twin/` as the task wrote, `showsHeat` is defined in
      `lib/twinLevel.ts` beside `SceneLevel` and `twinHeat.ts` re-exports it (the overlay's readers did not move), and
      the measures are `lib/heatMeasures.ts`, which imports nothing. The legend is lazy-chunk code (`twin/HeatLegend.tsx`).
    - **The legends are stacked (Q2).** The heat legend is above the marker legend in one bottom-left column
      (`TwinStage`'s `.legends`), which is the positioned box; neither sets its own position. Frame 13 shows the heat
      legend alone, but the marker legend still explains the beacons and the cameras, and at building level it is the
      line that says `Esc` returns to the campus: dropping it while Heat is on would remove the only hint. A "Frames to
      revise" row of the brief records it.
    - **The ramp is a gradient (Q4).** Six equal blocks, as drawn, would put the 23 °C tick on the border of blocks 3 and
      4, while a shell at 23 °C is the colour halfway between stops 2 and 3. A `linear-gradient` over the six `--heat-*`
      stops with no stated positions places them at 0, 0.2 … 1, which is where `heatColor` puts them, so the strip is
      the shells' colour at every temperature of the scale. The ticks (19, the middle, 27 °C) come from
      `HEAT_DOMAIN`, never typed twice. The strip is `aria-hidden`: the numbers are in words.
    - **The note says where the numbers are (Q5).** Frame 13's sentence is kept verbatim and followed by "The Assets tab
      lists each reading.", because the canvas is hidden from assistive technology and the Assets tab is the accessible
      twin ("Settled in V2-17.1", "Where the numbers also are"). "Every building reports one" is frame 13's own wording
      and stays; the next clause says what a silent building is.
    - **The listbox.** The first one in the console: the WAI-ARIA APG collapsible dropdown listbox. The button has
      `aria-haspopup="listbox"`, `aria-expanded` and `aria-controls`; opening moves focus to the list, whose active
      option is `aria-activedescendant` (one focus target and no roving `tabindex` over a list of one); Escape closes it
      and returns focus to the button, and while it is open it owns Escape in the capture phase, as `ui/Popover` does, so
      the sheet, the search box, the part callout and the picking mode do not also act. The open and close logic is
      written locally rather than extracted from `Popover`; a second listbox is the moment to extract it.
    - **The choice is not state while there is one measure.** The selected option is a constant and choosing it only
      closes the list. A second measure needs a source rule and a scale of its own (`humidityPct` stays rejected), a list
      entry in `lib/heatMeasures.ts` and a store field for the choice; the ADR's "a data addition, not a redesign" holds.
    - **Left for the tickets, `unverified` until looked at:** the ramp on the shells against the legend's strip, the two
      legends stacked at 1072 × 671 and narrower and with the sheet open, the picker beside the layers when the row
      wraps, and the listbox with a screen reader. The cross-cutting accessibility cases with Heat on are V2-17.5's.
  - Settled in V2-18.3 (2026-10-20, confirmed 2026-10-21 with V2-19.8), without changing the
    decision: the 3D view's own keys. Each question of the ticket's analysis was answered with its recommendation.
    - **The keys are handled on the group, which has focus (Q1).** `TwinView` renders the one focusable element, so the
      `onKeyDown` is there and not in `TwinStage` as the task wrote. A pure `lib/twinKeys.ts` (`keyCommand`) maps a key
      press to a command, and `twin/runKeyCommand.ts` runs it and says whether the key was used; `preventDefault()` is
      called for a used key only, so `Tab`, `V`, `F`, `?`, `/` and `N` reach their own handlers and an `Escape` at the
      campus (nothing to close) is not taken. The keys work only while the view has focus, so `Home` and the arrows keep
      V1's meaning in the lists. They are not behind the account menu's single-key switch: they are active only on focus
      of the component, which WCAG 2.1.4 allows (the help lists them as non-character keys, V2-18.1).
    - **Tilt and pan are commands of their own (Q2).** `twinCommands` gained `tiltBy(degrees)` and `panBy(dx, dy)`,
      implemented in `Rig` as `rotateBy` is: relative to where the camera is going, smoothed, taking the camera back from
      a fly-to, and clamped by the controls (the 20° – 78° polar limits, the pan box). `panBy` takes **fractions of the
      current distance**, so a step feels the same at 60 m and at 900 m and no caller needs the level's scale. A flight
      per key press (`flyTo`) was rejected: a held key would restart it on every repeat.
    - **Signs and steps (Q3).** `←` turns the camera `+15°` (the sense of the "Rotate left" button), `→` `−15°`; `↑` tilts
      `−5°` (towards overhead), `↓` `+5°`; `Shift` and an arrow pan a tenth of the distance (`←` left, `↑` forward).
      `+` and `=` zoom in by a factor `0.8` of the distance and `-` and `_` out by `1.25`: the task and the prototype
      write them as a scale, the other way round, and `zoomBy` takes the distance. The factors are shared with the
      on-screen buttons (`ZOOM_IN_FACTOR`, `ZOOM_OUT_FACTOR` in `lib/twinCamera.ts`), and `Shift` is ignored for the zoom
      keys because `+` needs it on most layouts. The steps are the prototype's and `unverified` against the real camera.
    - **`Home` is the Reset button's function.** `resetView` (campus level, then the home view; an open incident and the
      report form stay) moved from `TwinControls` to `lib/twinFlight.ts`, and both call it. **`Esc` is `goUp()` only** and
      asks for no camera: `useLevelCamera` flies with the level, so a second request would fly twice. It leaves a building
      only here, while the view has focus; the inspector's Escape still stops at the asset (V2-15.11).
    - **A press on the picture focuses the group (Q4).** `onPointerDownCapture` calls `focus({ preventScroll: true })` and
      not `preventDefault()`, so a drag is unaffected. Nothing else would give the group focus, and a mouse user who
      orbited and pressed an arrow would get nothing. `unverified` in a browser.
    - **Repeat (Q5).** A held arrow, `+` or `-` repeats, since the smoothing and the limits absorb it. `Home` and `Escape`
      take one step per press, so a held Escape cannot climb the whole ladder in a second; a `Shift`-modified `Home` or
      `Escape` is not ours.
    - **The keys are described, not named.** The group's `aria-describedby` points at a `hidden` sentence
      (`TWIN_VIEW_KEYS`), read once on focus; the name stays the summary of the site. A test keeps the sentence in step
      with the help's group "3D view, while it has focus".
    - **Left for the tickets, `unverified` until looked at:** the feel of 15° / 5° / a tenth of the distance with a held key,
      the clamps and the pan box under a held key, that a press on the canvas focuses the group, the ring over the canvas,
      and the description read once by a screen reader. The app-level axe, role and keyboard-only cases are V2-18.4's.
  - Settled in V2-19.1 (2026-10-20, confirmed 2026-10-21 with V2-19.8), without changing the
    decision: the developer HUD and the load marks. Each question of the ticket's analysis was answered with its
    recommendation.
    - **The HUD is absent from production by construction and by a check.** Its two pieces (`Hud`, the readout, and `HudProbe`,
      inside the canvas) are dynamic imports under a literal `import.meta.env.MODE === 'development'` at each import site,
      plus `?debug=twin`. A check that is local to the module is what the build folds away (the draw-call log of V2-15.8 and
      the pick timing of V2-15.3 are not in `dist`); a helper, or a constant shared between modules, would not be, and the
      chunk would ship. `MODE` and not `DEV`, which Vitest sets too. `scripts/chunk-budget.ts` fails `pnpm build` when `debug=twin` or the label of a HUD row
      is anywhere in `dist/assets`, and when there is nothing to scan.
    - **What a frame time is.** The canvas draws on demand and R3F's `delta` spans the idle time before a frame, so a delta
      above 250 ms is a gap and is left out of the window of 120 times (`unverified` as a cut-off until read in a browser);
      FPS is the frames drawn per window, so an idle canvas reads 0. The p95 is therefore a figure for continuous motion, which
      is what the budget describes. Draw calls and triangles are read from the HUD's timer between frames, so they are the last
      completed frame's. The HUD's `useFrame` stays at priority 0: a higher one stops R3F rendering.
    - **Telemetry figures.** Messages per second and worker posts per frame come from the client's cumulative counts, which the
      engine posts at most once a second: a rate is the change between two changes of the count over the real time between them
      (and, for posts, over the frames drawn in that span), a decrease (a replaced client) starts over, and no client is a dash.
    - **The marks ship.** `twin:data` (the stage's first scene), `twin:first-frame` (the first frame drawn with a scene) and
      `twin:models-done` (every class ready or failed) are three `performance.mark` calls in every build, so the cold load of
      V2-19.7 can be measured on the production build. `twin:data` is when the stage first has the zones, not when the queries
      arrived (the 2D map shares them).
    - **`DrawCallLog` is gone.** The HUD shows the same figure. The two sentences above that name it ("Settled in V2-15.8" and
      "Settled in V2-17.3") describe what was true then and are not rewritten. The pick timing of V2-15.3 stays in `PickLayer`'s
      development log: the HUD's six values do not include it.
    - **Not done here and `unverified`:** the HUD's own cost (under 0.2 ms a frame) and that its numbers move, both in a
      browser; the HUD exists in `pnpm dev` only (React in development mode), so a figure read there is pessimistic and
      V2-19.7 must say which build it measured; the production build's `dist` has not been scanned until `pnpm build` is run.
      Logging telemetry worker faults once per change (the open item of Phase 3) is **not** part of this ticket and has no owner.
  - Settled in V2-19.2 (2026-10-20, confirmed 2026-10-21 with V2-19.8), without changing the
    decision: what asks the on-demand canvas for a frame, and the hidden tab. Each question of the ticket's analysis was
    answered with its recommendation.
    - **Three loops keep the canvas drawing; everything else is a one-shot.** The audit of every `useFrame` and `invalidate`
      found no call that asks without a reason. The loops that sustain themselves are the bound parts and their spin
      (`stepBound`, `useBoundParts`), the camera's fly-to (`Rig`) and the pulse of a critical beacon (`pulseRunning`,
      `Beacons`); each writes a field of a `FrameDemand` (`lib/twinPerf.ts`) in the frame it runs, through a reporter function
      (`useReportFrameDemand`: the console's lint rules for React forbid modifying an object a hook returns, a ref from a
      custom hook included), and no longer calls `invalidate()`. `needsFrame(demand, { hidden })` is the table. A camera in motion is drei's (`CameraControls`
      invalidates on its own `update` event), and a pick, a label or leader projection, a changed look or layer and a
      reading that arrived are one-shots tied to a change; none of them is a field, because nothing keeps them alive.
    - **`FrameDriver` turns the flags into frames.** One `useFrame` at priority 0, a parent of everything that can report,
      asks R3F for the next frame when `needsFrame` says so. It has to be a `useFrame`: an `invalidate()` from a global
      after-effect is lost, the loop having decided to stop. **The reporters run below it** (`Rig` at −2, `useBoundParts`
      and `Beacons` at −1): R3F orders subscribers by priority and then by when they subscribed, and a model that loads
      later subscribes after the driver, whose read of its flag would then be a frame late and could stall a part short
      of its target. No `useFrame` takes a positive priority, which would stop R3F rendering the scene. A loop puts its
      flag down on unmount, or the driver would draw for ever.
    - **A hidden tab.** The browser draws no frame in it (no animation frame fires), so what the console owes is not to
      queue work and to be current on return: the feed's one-second tick does nothing while hidden, the feed and the
      stage's `invalidate` ask for no frame, the driver asks for none, and on `visibilitychange` the feed catches its
      flags up (`step()`, exact because ages are judged on `performance.now()`) and asks for one frame whether or not
      anything changed. The socket, the worker and the client are untouched, so the state stays current. **Not
      `frameloop="never"`**: R3F's `setFrameloop` stops the clock and resets `elapsedTime` to 0, which moves the pulse's
      phase and the delta of the next frame, for a saving the browser gives anyway.
    - **A spin is the one steady load.** A live part that spins asks for a frame every frame while it lasts, at the
      display's rate, on screen or not. It is the rule as specified; a cap (30 fps while only a spin asks) or a cull
      (only while the part is in the frustum) is a behaviour change to be judged from the HUD in V2-19.7's scenes.
    - **The audit is kept by a note and a scan.** Every file that calls `useFrame` or `invalidate` has a `Frame demand:`
      paragraph in its comments, and `twin/frameDemand.test.ts` fails when one lacks it, when a `useFrame` takes a
      priority that is not a literal number at or below 0, or when one of the three loops stops running below 0. It does
      not try to prove that no `invalidate()` is unconditional: a scan of the code cannot tell a guarded call from an
      unguarded one.
    - **Not done here and `unverified` until looked at in a browser:** that an idle scene (Incidents layer off, nothing
      moving) reads 0 frames on the HUD, that a background tab draws none, and that nothing stops short (a fan that spins
      down, a fly-to, a pulse). The demo is not idle by default: the Incidents layer is on and a critical open incident
      pulses at the display's rate.
  - Settled in V2-19.3 (2026-10-20, confirmed 2026-10-21 with V2-19.8), without changing the
    decision: the pixel ratio steps down when frames run long. Each question of the ticket's analysis was answered with
    its recommendation.
    - **The rule.** `createDprController` (`lib/twinPerf.ts`) is fed every drawn frame's time and the clock and judges in
      tumbling windows of 2 s: at the end of a window with at least 30 kept frames whose p95 is above the budget, the ratio
      goes one step down (1.5 → 1.25 → 1.0) and the next window starts at once, so one full window passes before the
      next judgment. It never steps up: a ratio that flapped would be worse than a stable lower one (`unverified` as a
      choice). Frame times above 250 ms are idle wake-ups, not frames, as in the HUD.
    - **The budget is 18 ms, not the brief's 14.** What the controller is fed is the interval between drawn frames, which a
      display fixes: about 16.7 ms at 60 Hz whatever a frame costs. A budget of 14 ms would step down every healthy 60 Hz
      machine, and since a step is never undone, leave all of them at 1.0. 18 ms is above a 60 Hz frame and its jitter, below
      a 50 fps stutter and far above 120 Hz. An interval also sees a GPU that cannot keep up (the frames come later), which
      is the usual reason to lower a ratio and which a CPU timer around the frame does not; the brief's 14 ms is the
      frame's _cost_. `unverified` until read on the reference hardware.
    - **A grace, because a false step is permanent.** Nothing is judged until one window after the first frame drawn with
      a scene (`PixelRatio` is mounted with the scene), so shader compiles, model parsing and the first layout are not mistaken
      for a slow device. A window with fewer than 30 frames is not judged either: a short fly-to does not decide. Both
      are options of the controller.
    - **The step is state in `TwinCanvas`**, passed as `dpr={[1, step]}`. R3F applies the `dpr` prop again on every
      configure, so a `setDpr` from inside the canvas would be undone by the next render. R3F clamps the display's ratio into
      the range, so the canvas draws at `min(devicePixelRatio, step)` (and at least 1), and follows a change of display.
      The controller clamps its steps to the device ratio and drops duplicates: a laptop at 1.25 (the reference laptop) goes
      1.25 → 1.0, and a display at 1 has nothing to give up.
    - **Remembered for the page.** The step reached is kept in a module variable, not in storage: a switch to 2D and back
      unmounts the stage and would otherwise start again at 1.5 and degrade a second time. A reload tries 1.5 again.
    - **The HUD** has a seventh row, "Pixel ratio", read from `gl.getPixelRatio()`: the renderer's actual ratio, which is
      what the operator sees and is not the controller's step when the device is below it. Frame 00's six rows keep their
      order.
    - **For V2-19.7, not changed here:** the HUD's "Frame (p95)" is the same interval, so at 60 Hz it reads about 16.7 ms when
      nothing is wrong and the budget row "p95 ≤ 14 ms" cannot be met with that metric. Read it as FPS near 60 while moving
      and a p95 near or under 18 ms, or give the HUD a frame-cost row (`addEffect` / `addAfterEffect` around the loop);
      the tech lead decides before V2-19.7.
    - **Not done here and `unverified` until looked at in a browser:** that a healthy 60 Hz display never steps, that a
      throttled one steps down and stays, that the step survives a remount, that a cold load does not step. The
      video wall's `wall: true` pin exists in the controller; the wall's canvas passes it in (V2-21.6).
  - Settled in V2-19.4 (2026-10-20, confirmed 2026-10-21 with V2-19.8), without changing the
    decision: the draw-call and triangle budgets are held by estimate and guarded in development. Each question of the
    ticket's analysis was answered with its recommendation.
    - **The demo is under budget by estimate, so the ticket adds a guard and changes no scene.** Read from the code and from
      the two demo files in `ops/models`: the ground is at most 9 calls (one per layer), the shells and the boxes a handful
      each (their draw calls are groups: V2-15.8), the markers and the zone highlight at most 4, and the three modelled
      assets 24 (below). That is about 50 – 60 calls on the campus view, which is the "under 60" the task assumed, and about
      10 k triangles against 250,000. `unverified` until the three views (campus with Heat on; the Data Center in focus with
      every asset shown; an asset isolated) are read with the HUD: the tech lead records them in the PR.
    - **What a modelled asset costs, and where 150 is.** An instance is a clone of its class's template: the statics merged
      once per console material (one mesh each) plus every bound part as a mesh of its own, so a cooling tower is 7 calls
      (2 + 5) and the standby generator 10 (3 + 7), and calls grow with the number of modelled assets: with about 30 of base,
      150 is reached at about 12 – 17 modelled assets, fewer while outlines are shown (each visible outline is one more call
      per mesh). `InstancedMesh` for the merged statics would save 2 – 3 calls an asset and nothing on the bound parts, which
      cannot be instanced; going further is a change to the model contract (parts merged into fewer meshes), a decision of its
      own. Neither is done: the demo does not need it, and the guard shows the day a site does.
    - **The guard.** `budgetBreaches` (`lib/twinPerf.ts`) compares `gl.info.render.calls` and `.triangles` with the brief's 150
      and 250,000 (strictly above: "at most" is within budget; a figure that is not a number is never a breach).
      `createBudgetGuard` warns on the rising edge, per figure, and arms a figure again when it is back within budget, so a
      scene that stays over warns once and not twice a second. It runs in `HudProbe`'s tick, so **in a development build with
      `?debug=twin` only**; a probe for every development session is a few lines later. The HUD marks an over-budget value
      with `data-over` (a `--sev-critical` bar under the figure; the text keeps `--text-primary`; the pair is in
      `scripts/contrast.ts`). The text of the warning is in `lib/twinHud.ts`, which production drops, and never names the
      address that switches the HUD on. It judges the last frame's reading, twice a second: a budget about steady views, so
      a one-frame spike can be missed. It is not a CI check: that would need a headless render, which the V2 plan does not
      have.
    - **What the task listed and was not needed.** Statics are already merged per class (`buildTemplate`); materials are
      already pooled by name, face and severity (`createMaterialTable`; a material does not change the draw-call count in
      three.js anyway); outlines are hidden by default, so an idle model has none, and the boxes' edges are two merged
      line meshes; there is no drei `Html` in the twin (the zone labels are DOM elements placed by `LabelProjector`), so there
      is no label cost in `gl.info`.
    - **Not done here and `unverified`:** the three views' figures; that the warning fires on a real over-budget scene (the
      tests stub `gl.info.render`, as jsdom has no WebGL); that the `data-over` bar is visible and clear of the labels, the
      callout and the controls. V2-19.5 reduces triangles (LOD1 and culling); V2-19.7's scenes should read both figures in
      each view.
  - Settled in V2-19.5 (2026-10-20, confirmed 2026-10-21 with V2-19.8), without changing the
    decision: a lower level of detail below 5 % of the screen's height, and what frustum culling can and cannot do. Each
    question of the ticket's analysis was answered with its recommendation.
    - **The LOD.** `buildTemplate` merges the model's `<Root>_LOD1` sibling (the node named exactly so; its meshes at any
      depth, taken in the class root's frame) into one mesh per console material, as it does the statics, and keeps it as
      the template's `lod1` with its hidden outlines (the stale dash and the severity edge read at a distance too).
      `instantiate` returns a three.js `LOD` for a class that has one: level 0 a copy of the root, level 1 a copy of
      `lod1`, which starts hidden (three lowers a shown level's threshold by the hysteresis, so a LOD1 that began visible
      would be chosen 10 % early). A class with no LOD1 (the checker makes it optional), or one that cannot be merged, or
      with no sphere to measure, is the plain copy as before: LOD1 is an optimisation and never costs a model.
    - **Where it switches.** `lodDistance(radius, fov)` in `lib/twinCamera.ts`: a sphere's projected height is
      `r / (d · tan(fov / 2))` of the screen's, so 5 % is `d = r / (0.05 · tan(fov / 2))`, about 43 times the radius at the
      fixed lens (`HOME_FOV_DEG`). The sphere is the circumscribed sphere of the LOD0 root's bounding box (a little loose,
      which errs towards keeping the better level), measured once when the template is built. For the demo's seed
      footprints that is about 162 m for a cooling tower and about 154 m for the generator, inside the campus range of
      60 – 900 m, so the overview draws LOD1 and building level and below draw LOD0 (`unverified` until read with the HUD).
      three measures the distance to the instance's origin, not the sphere's centre: 1 – 2 % at these ranges, not
      corrected.
    - **The hysteresis is 10 %** (`LOD_HYSTERESIS`): LOD1 from `d`, LOD0 again below `0.9 d`, so a camera resting near the
      line does not toggle at each small move. `unverified`, tuned by eye; one constant.
    - **What is lost below the threshold, and what is kept.** The bound parts live in level 0 only, so their **motion and
      their state tint are not drawn**. The brief calls that sub-pixel; at the threshold a model is 5 % of the screen, about
      54 px on a 1080p display, so a fan of some twenty pixels freezes in view: small, not sub-pixel, and accepted. The
      asset-level look is **kept**: `useModelLooks` paints every mesh of the instance, so the silhouette takes stale, the
      severity tint and edge, hover and the ghost of a faded asset. A part-level look (a hovered or selected part) is
      level 0's. The stand-in models' LOD1 is one `Part` mesh, so the generator's see-through enclosure is opaque at a
      distance: content (V2-13.8, V2-13.9), not code.
    - **The picker is unchanged.** It registers every mesh under an instance, so level 1's are registered (an extra bounds
      tree each) and level 0's stay registered while it is not drawn, because three's raycast ignores `visible`. A hit on
      either names the asset; a part is only pickable in the asset and part scopes, where the camera is 4 – 40 m away,
      which is level 0. "What can be hit is what is drawn" (V2-15.3) therefore holds where it matters, and the two
      outlines differ by the simplification only.
    - **Culling: three's default, per object, and nothing turns it off for a model.** The merged static meshes have exact
      spheres (float positions), a bound part carries its sphere with its transform, and a quantised part's sphere is in
      its node's scale, which `matrixWorld` applies; tests state each, and a `Frustum` case shows an instance beside or
      behind the camera is culled copy by copy. **The shells (`Buildings`) and the boxes (`AssetBoxes`) are one merged
      mesh each, with groups for the looks (V2-15.8), so a building is never culled on its own**: their sphere is the
      campus's. Splitting them per building would add draw calls (just budgeted, V2-19.4) and undo V2-15.8 for a few
      thousand triangles in a scene estimated at about 10 k. So "looking away from the Data Center" removes the three
      modelled assets beside it (`CT-01`, `CT-02`, `GEN-01`: about 1,600 triangles at LOD0), not the building.
    - **Correction of V2-19.4's arithmetic.** The 7 and 10 draw calls of a cooling tower and a generator are LOD0's; at LOD1 a
      model is one call per console material (one, for the stand-ins), so the demo's three models are about 24 calls near
      and about 3 at the overview. The budget guard reads the frame as drawn, so it sees both.
    - **For V2-19.7.** A live spin asks for a frame on every frame (V2-19.2) even while LOD1 hides the fan, so a scene at the
      overview with a spinning model still draws continuously: read what it costs with LOD1 in place before capping or
      culling the spin.
    - **Not done here and `unverified`:** the thresholds and the hysteresis in a browser, that the swap shows no flicker and
      no pop beyond the simplification, that looking away lowers the HUD's triangles by the models', and how the far
      silhouettes look. Level 1 is `lod1`'s clone per instance: V2-19.6 frees it with the rest.
  - Settled in V2-19.6 (2026-10-20, confirmed 2026-10-21 with V2-19.8), without changing the
    decision: what releases the twin's GPU resources, how that is seen, and why there is no registry. Each question of the
    ticket's analysis was answered with its recommendation.
    - **The audit: every site that creates a resource already releases it, in its own effect cleanup.** The ground's layers
      (`Ground`), the shells (`Buildings`), the boxes (`AssetBoxes`), the marker quads (`Markers`: cameras, beacons, the
      report pin), the zone outline (`ZoneHighlight`) and the three atlas textures (`useMarkerAtlas`, `usePinTexture`,
      `useBeaconAtlas`, whose texture is replaced as the atlas grows: the previous one disposed when the new one is
      committed, a stale one when its growth is discarded, the last one with the stage) dispose what a memo built when it
      is replaced or unmounted; the stage's model cache, its material table and every template's merged geometry, outlines
      and `lod1` are disposed in `useClassModels`' cleanup. R3F disposes a removed element's children on idle but **never a
      geometry handed as a prop or a `<primitive>`**, which is why the first group is explicit.
    - **A change of level creates nothing.** V2-15.8's rule ("a change of focus rebuilds nothing") means focusing mounts or
      unmounts model instances as `<primitive>`s over geometry they share with the template, and the looks re-point at
      pooled materials; so campus → Data Center → `CT-01` → campus should leave the counts where they were. Nothing is
      per instance (the materials are pooled by name, face and severity), nothing is shared between owners (each texture
      has one), and there is **no pick proxy** (V2-15.3 raycasts the drawn meshes).
    - **The HUD shows it.** Two rows after "Pixel ratio", **Geometries** and **Textures**, read from `gl.info.memory` between
      frames. They count what the GPU holds: a resource enters the count the first time it is **drawn** and stays until it is
      disposed, so a view not yet visited has not added its own. A first round trip belongs before the baseline; after
      it a **steady** count over the next trips is the evidence, a rise by a fixed amount per trip is the leak.
    - **Three's `dispose()` releases the GPU copy, not the object.** A texture or geometry used again is uploaded again, so
      disposing a shared one early costs a stall and a re-upload, not a blank scene.
    - **The leak found: the KTX2 loader.** `loaders.ts` keeps one `KTX2Loader` per renderer in a `WeakMap`, which frees the
      object and not the worker pool, the transcoder binary or the blob URL that a loader holds once it has transcoded. Every
      switch to 2D and back makes a new renderer and so a new loader: with a model that has KTX2 textures each trip would
      have left those behind, and three would have warned about several active loaders. `releaseGltfLoaders(gl)` is now
      called in the stage's cleanup, after the cache and the table, and disposes the loader **only if it initialised**:
      `KTX2Loader.dispose()` decrements three's module-level count of active loaders, which only initialising increments, so
      disposing one that never started (every demo model: the stand-ins have no textures) would make the count wrong. Switching to 2D already
      frees the GPU side, because R3F unmounts the canvas (`gl.dispose()` and `forceContextLoss()`); this is the part the
      renderer's death does not free. `unverified` until a model with a texture exists (V2-13.8).
    - **There is no `lib/twinDispose.ts`.** The task asked for a registry that counts owners. The audit found no resource with
      two owners, no pick proxy, no per-instance materials, and a release at every site that creates one, written beside the
      creation and in the file that knows what the resource is. The alternatives were to migrate about ten browser-only,
      untested lifecycles to a registry for no change in behaviour, or to add one for the two that need an order (the
      beacon atlas, the stage's resources): a second mechanism beside the pattern the folder already follows. The tech lead
      chose to leave the working sites; a registry is the answer on the day a resource gets a second owner (a texture shared
      between layers, a second site). AC3's tests are of what was built: the HUD rows and the loader's release.
    - **A class's template is kept for the stage's life.** The task says "while any asset of the class exists"; assets and
      classes are reference data (`staleTime: Infinity`), so a class cannot lose its last asset in a session without a
      reload, which rebuilds everything. The models are released when `TwinStage` unmounts, and loaded again, from the
      browser's immutable cache, when it comes back.
    - **Not done here and `unverified`:** AC1 (20 round trips leave both counts where the warm-up ended) and AC2 (5 switches to
      2D and back leave the browser's GPU memory steady and the counts as a fresh start's), both read with the HUD in a
      browser; the KTX2 release (no model with a texture yet); and that the untested R3F sites really leave the counts
      alone, which the HUD will now show. V2-19.7's scenes should read both rows.
  - Settled in V2-14.6 (2026-10-19), without changing the decision: how an asset gets into the scene.
    - **Placed once, in the scene.** `useTwinScene` reads the catalogue with the zones and places every asset
      (`lib/twinPlacement.ts`): its placement by the V2-12.1 rule, its pose (`x` east, `y` the base's elevation, `z` =
      −north, turned by `π − heading`) and its box from the class's `footprint_m`. The canvas receives the placed
      assets as props, because a query hook has no client inside `<Canvas>`. The position drawn is the 2D map's own
      (`fanOutAssets`, run over all assets), so assets on one spot are spread the same way in both views; the
      placement itself uses the catalogue position.
    - **One merged mesh, not instances.** Every drawn box is merged into one triangle mesh and one list of edges
      (`lib/twinBoxes.ts`, wrapped by `twin/AssetBoxes.tsx`): two draw calls however many assets, with a range per asset
      for colouring by state and for picking. The neutral base is `--tw-neutral`, shaded by the scene's two lights.
    - **Campus level draws `outdoor` and `roof` assets.** `inside` assets are placed but not drawn until a building is
      in focus (V2-15.8). An asset whose zone is not in the list is `outdoor`, a building too small to have a footprint
      has nothing `inside`, and a missing height is the shell's `DEFAULT_BUILDING_HEIGHT_M`.
  - Settled in V2-14.7 (2026-10-19), without changing the decision: how the class models get into the scene.
    - **One request per class, nearest first.** The classes that have a `modelUrl` are listed once, nearest the middle
      of the campus first (`lib/twinLoadQueue.ts`), and the stage fetches their files two at a time in that order; two
      assets of one class, or two calls, cost one request. The models stream after the site plan, so the boxes of
      V2-14.6 are the placeholders and an asset's box is replaced by its model in the render in which its class
      becomes ready (`twin/Equipment.tsx`): never both, never neither.
    - **A model that fails stays a box.** A 404, a parse error or a decoder error is logged once for the class
      (`console.error`) and is never asked for again; the Assets tab and the inspector do not change. The loading card
      shows such a class as a finished row ("drawn as a box"), so a model that cannot load never holds the card up.
    - **The card has bytes.** The stage loads with its own loader (three's `GLTFLoader`, `twin/loadGltf.ts`), not drei's
      `useGLTF`, because only its progress events give a class's bytes ("0.6 / 1.4 MB"). The cache writes them,
      throttled, to a store of its own (`lib/twinModelStore.ts`) that the card, which is main-chunk code, reads.
    - **Bindings are built and kept, not applied.** Once a class's model has arrived and its points are known (the
      detail of one asset of the class, through the inspector's cache entry), its bindings are built from its `extras`
      and kept with the class; V2-14.8 mounts the telemetry feed and applies them. A bound part the catalogue cannot
      bind is logged once for the class, and the model loads without that binding.
  - Settled in V2-21.1 (2026-10-21, proposed: the tech lead confirms or amends each bullet), without changing the
    decision: how a window becomes a video wall, who it signs in as, what it shows and what moves its camera. Each bullet
    is the default the V2-21 tasks build to; it names the task it blocks and the open question (Q) of the phase's task
    list it answers. Read from the code at `e4d5c7c`, not from the frame alone.
    - **Where it lives (Q1; blocks V2-21.2).** A wall mode of the console, not `apps/video-wall` (OCC-19, not built):
      ADR-0001 forbids an app importing an app, and only `apps/console/src/twin/` may import `three` (lint-enforced), so a
      second app would have to copy the twin or move it into a package that holds `three`. UI-17's display modes
      (`useDisplayMode`, `--ui-scale`) are already in the console. OCC-19's choreography across screens and its rotating
      camera groups stay on the roadmap.
    - **How a window becomes a wall (Q2; V2-21.2).** `?wall=N`, `N` a positive integer, which is the number in "Wall N · view
      only"; any other value is ignored. It is **kept in `sessionStorage` for the tab** (in `try/catch`) and read before
      `startSession()`, because the sign-in redirect would lose it: the redirect URI is the origin root, and `signIn()` in
      `auth/session.ts` replaces the address with its path once the callback is done. One window per screen is one tab per
      screen. A route (`/wall/1`) would not survive the same redirect, and a role would make a person's viewer account a
      wall.
    - **Who it is (V2-21.2).** A `viewer` account (the brief names the video wall among the viewer's uses). The wall
      draws no action for any role, so an operator who opens `?wall=1` still gets a read-only picture, and nothing in wall
      mode calls a write route. The API stays the control (ADR-0011).
    - **What it shows (V2-21.3).** Frame 18 and nothing else: the header (the four severity counts, the two connection
      states, "Wall N · view only", the clock), the stage, the camera grid and the active list. No toast, no sound, no
      keyboard shortcut, no account menu, no sheet or form, no density or layer control.
    - **Scale (Q3; V2-21.3).** Wall mode sets its own `--ui-scale` from the window width against the frame's 1920 px,
      starting at the frame's own factor for the 3D labels (`ui: 1.35`): 1.35 at 1920 and 2.7 at 3840, not UI-17's 1.125
      and 1.75, which are for a console people still operate. Frame 18's sizes are absolutes at 1920 px (an 80 px header,
      20 px row titles) and are read against the laptop sizes the components use. `unverified` until it is looked at on a
      wall.
    - **Which incident, and when it goes back (Q7; V2-21.7).** A new `critical` incident takes the camera. A second one
      during the flight or the hold replaces it and restarts the 60 s. Acknowledging or resolving the focused incident, its
      removal, or 60 s returns to the fixed campus view; if another critical is still open, the wall does **not** fly to it
      (only a new one does). Reduced motion: the jump is instant and the countdown still shows. It never moves otherwise.
      Built in V2-21.7 as `lib/wallFocus.ts`, pure and with no clock of its own (the caller passes `now`, from a clock that
      does not go backwards). Its input is the **difference between two reads of the incident list the cache holds**
      (`wallFocusEvents`), not `useLiveIncidents`: that hook makes the toast and the sound, which a wall must not, and it
      sees live events only, while the cache is also what a refetch after a lost link writes, through the same version rule.
      The first list is a baseline, so what was already open when the wall started is not flown to. An update that does
      not carry a higher `version` than the machine's is ignored; a creation that arrives already acknowledged or resolved
      is not an emergency; a clock that goes backwards restarts the hold from `now`.
    - **The cameras (Q4, Q8; V2-21.4).** The grid's incident-first rule follows the focused incident while one is held,
      otherwise the most severe open incident's zone, otherwise the default order; six tiles at 1920 and at 4K
      (`wallStripSize`: a 4K wall is the 1920 wall twice as large, and the console's eight tiles at 4K would have left the
      active list one row, V2-21.5); a camera with no signal is a "No signal" tile with its code and the time since. Every screen shows the
      same content: `N` is a label, and rotating groups are OCC-19's.
    - **Telemetry (Q17; V2-21.8).** The wall watches only the focused asset's data, so its fan turns while it is the
      subject; an idle wall watches none. The watch limit (`TELEMETRY_WATCH_LIMIT`, 4) is not widened, as the "Settled in
      V2-14" block already says.
      Built in V2-21.8: `TelemetryWatchSet` reads `wallFocusId` in place of `selectedIncidentId` when `wall` is set, so the
      only slot is the incident the camera is on.
    - **The flight (V2-21.8).** `useWallFocus`, mounted by `WallApp` only, feeds `wallFocusEvents` into the rules of
      `lib/wallFocus.ts` on the clock `performance.now()`, runs one interval of a second **only while a focus is held**,
      and turns the result into `twinCommands.flyToIncident` / `home()` and the store's `wallFocusId`. It never writes
      `selectedIncidentId` (that opens the sheet): the beacon's ring (`useTwinBeacons`), the camera grid, the list's row and
      the telemetry watch follow `wallFocusId`. A locked `Rig` keeps a `flyToIncident` whose beacon has not reached the canvas
      yet (the incident and its beacon arrive through two readers of the same cache) for up to `PENDING_SHOW_MS`, and `home`
      cancels it; the console's rig still does nothing for an incident it has no beacon for. The banner
      (`WallFocusBanner`) shows the title, "code · zone · reading, limit · not acknowledged" (the first `reported` note read as
      the sheet reads it, plus the asset's point for the unit; the line shortens without them) and "Campus view in N s". The
      announcement is a hidden `role="status"` that is always mounted and holds the arrival from the list's data only (so the
      reading arriving later does not repeat it) and "Back to the campus view"; the drawn card and the countdown are in no
      live region. `WallLegend` is the strip bottom left. A critical created while the link was down and read after it is
      flown to as if new, however old: it is still open and unacknowledged, so the wall showing it is not wrong.
    - **If 3D cannot be drawn (Q9, Q18; V2-21.9).** The same shell with the 2D map in the stage and the focus banner kept
      (frame 18 has no such variant: a row in the brief's "Frames to revise"). The camera rules still apply, with the map
      fitting the incident. A wall at pixel ratio 1.0 is already on the controller's last step (`wall: true`), so the
      budget the task names ("cannot hold the frame budget") has no step left to give: a pure `shouldFallBack` in
      `lib/twinPerf.ts` marks the twin lost (`markTwinLost`, the path of a lost context) when the p95 interval stays above
      the budget for a long window (60 s proposed), and the wall shows the map. The tech lead may prefer the capability
      fallback alone; both numbers are `unverified` until the wall controller (V2-21.12).
    - **Built in V2-21.9: the fallback.** `WallStage` (in the stage cell) shows `LazyTwinStage wall` where `useTwinCapability`
      says 3D can be drawn and otherwise `CampusMap wall` with a non-dismissible `role="status"` tag, "2D map — " and the
      reason's title from `TWIN_UNAVAILABLE_COPY`, no button. **Only the capability decides**, not the store's `view`: a wall
      has no switch, and the 2D choice an operator stored in the same browser is not the wall's. `CampusMap wall` is
      MapLibre with `interactive: false` (no drag, wheel, touch or key; the canvas leaves the Tab order), no tooltip, legend or
      controls, and it follows `wallFocusId` instead of the selected incident: it eases to the incident at zoom 18 and back to
      the campus fit when the hold ends. The focus banner and the legend are over the stage cell, so they show on the map
      too. The frame-budget detector is shipped: `createFallbackDetector` (`lib/twinPerf.ts`) judges 2 s windows as the
      pixel-ratio controller does and trips, once, after a minute of back-to-back bad windows, a window being bad when it
      kept at least 30 frames and their p95 interval is above 33 ms (`FALLBACK_BUDGET_MS`; a window with fewer frames, a
      canvas that draws now and then, ends the run). `FrameGuard`, mounted in the wall's canvas only, marks the twin lost as
      the new fault `too-slow` (`markTwinLost(fault)`, default `context-lost`), the path of a lost context. A wall does not go
      back to 3D by itself and retries nothing on a timer; a reload does (V2-21.10). The 33 ms, the minute and the zoom are
      `unverified` until the wall controller (V2-21.12); the 2D map's markers are not scaled for a 4K screen yet.
    - **Staying signed in (Q5; V2-21.10).** The wall renews its token as the console does. Where the renewal fails it
      starts the sign-in redirect itself, rate-limited and with a back-off, instead of waiting for a click that nobody is
      there to make. Keycloak's defaults end a session after 10 h at most (ADR-0010), and a reload asks for no password
      only while that session lives, so the realm must allow a longer one for the wall: the default is that the wall
      account signs in with "Keep me signed in on this device" and the realm sets the remember-me lifetimes
      (`ssoSessionIdleTimeoutRememberMe`, `ssoSessionMaxLifespanRememberMe`, both properties of the 26.8 realm
      representation). A dedicated Keycloak client with its own session limits is the alternative, and a different
      auth model for walls a third; the numbers and the choice are **the operations lead's**, and every detail of the
      client-level setting is `unverified` against 26.8. Where Keycloak shows its sign-in page (no session left), the wall
      stays on it, themed (V2-20), until a person comes.
    - **Sound (Q6; V2-21.2).** None on the wall: a page that nobody touches cannot unlock audio, and the operators' consoles
      have the cue.
    - **The twin on the wall (V2-21.6).** The same lazy stage and the same single `import()` (`LazyTwinStage` in `StageView`),
      mounted with `wall`: the picture and nothing that takes input. The rig is locked (`CameraControls` disabled, no mouse,
      touch or Shift mapping), sets the home view for the stage's own shape and fits it again when that shape changes;
      nothing but a command (V2-21.8's flight) moves it, and there is no idle rotation. The canvas starts at the pixel
      ratio 1.0 (`WALL_DPR`) and `PixelRatio` is pinned there, whatever the display's ratio. No `PickLayer`, `Pointer`,
      `ReportPin`, compass, controls, legends, hints, building card, callout or tooltip is mounted, the view has no tab
      stop and takes no key, and the wrapper takes no pointer or touch (`data-still`). The camera markers and the beacons
      draw at the wall's scale (`markerScale.ts`, the same factor as `--ui-scale`), the heat overlay is off, and the
      Incidents and Cameras layers are the store's defaults, which a wall has nothing to change. If the stage cannot load
      or breaks, the wall shows a message with nothing to press; the 2D fallback is V2-21.9's.
    - **Not here.** Multi-screen choreography, rotating camera groups, and the wall controller's figures: the brief's
      budgets were to be recorded on it for V2-21, V2-19.7 was closed without them, and V2-21.12 carries them.
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
  - Settled in V2-14.4 (2026-10-19), without changing the decision: how the one buffer per frame is built.
    - **Layout.** The main thread sends `layout` (`layoutId`, `slots`: `{ assetCode, key, enumValues }`); slot _i_ is element _i_ of every
      buffer. `layoutId` rises with each layout, and the worker echoes it on every `targets` message, so the client drops a buffer built
      for an earlier layout and `getTargets()` is `null` until the new layout's first buffer.
    - **Buffer.** One `Float32Array` per post, transferred, `NaN` for a slot with no value yet (an absent asset or key, a word that is
      not one of the enum's values, a number that is not finite). It is built from `state.assets[code].values`, so a watched asset moves
      at frame rate and an unwatched one at the overview's 1 Hz, with no new socket traffic. It is posted only when a slot's number
      differs from the last post, so a quiet socket posts none and a layout whose slots have no value yet posts none; a new layout
      forgets the last post, so the current values are sent once under it.
    - **Rate.** A 17 ms throttle, leading, stands in for the frame (a worker has no `requestAnimationFrame` in every browser). A
      16 ms throttle can reach 63 posts a second under continuous change; 17 ms keeps to 58.8, within the 60 a second this path allows.
    - **Outside React.** Targets are read with `client.onTargets` and `getTargets`, never through `TelemetryView`, so no reading is
      React state. The snap after a reconnect (V2-14.1) is a flag for V2-14.5, not part of the buffer.
    - **Counts for the HUD.** The worker counts the socket messages it receives and the buffers it posts, and posts both as a `stats`
      message at most once a second and only when they changed; the client keeps the latest for `getStats()`. V2-19.1 turns them into
      messages per second and posts per frame.
  - Settled in V2-14.5 (2026-10-19), without changing the decision: what the render loop reads besides the numbers.
    - **A feed, not React.** `realtime/twinFeed.ts` holds the layout, the latest targets buffer and per-asset flags, and gives the render loop `read()`: the
      targets (the client's own buffer, read and never written), `slotOf(code, key)` and `flags(code)`. It reads the telemetry client, the query cache through
      getters it is given and a timer, makes no request and touches no store; it calls an injected `invalidate()` once when a buffer arrived or the layout or a
      flag changed, so a demand-mode canvas draws a frame, and never for a change that moved nothing.
    - **The layout is told by the loader.** The slots are the bound keys of every asset's class, from the bindings of the class's model (V2-14.2); whoever loads a
      model calls `setBindings(classCode, bindings)`, and the layout is empty until then. Headline and state points are not slots: nothing reads them from the
      buffer (tooltips and the list read React state), and an enum state point has no values in the asset list. They are added when a consumer exists.
    - **Flags.** `stale` is the console's own rule (3 × the asset's shortest headline interval, at least 5 s) on the server's clock rebuilt from the client's anchor
      and `performance.now()`, never `Date.now()`; an asset nothing was received about, or an unknown code, is `stale` and not `online`, as the list's "No data";
      no clock yet is not stale. `alarm` is the severity of the asset's open incident (an incident with an `assetId` is one a telemetry rule raised) and is not hidden
      by `stale`. `ruleKey` is the point in the evidence of the incident's cached detail (`evidenceOfTimeline`), and `null` when the detail is not in the cache: the
      feed fetches nothing, and the inspector's detail view already does.
    - **When it looks.** On each telemetry change, once a second (an age is a function of the clock), and on `refresh()`, which the stage's hook calls when the query
      cache changes for the assets, the incidents or an incident's detail. A stored flags object keeps its identity until a field changes. Disposing the feed sends an
      empty layout so the worker stops posting buffers nobody reads.
  - Settled in V2-14.8 (2026-10-19), without changing the decision: how the bound parts move.
    - **One loop, no React.** `twin/useBoundParts.ts` is one `useFrame` for every model instance. Per frame it reads the feed and, for each bound part, steps its
      eased value toward the reading in its slot (`stepBound` in `lib/twinMotion.ts`: `turn` and `slide` ease the encoded value, `spin` eases the visual speed and
      integrates the angle) and writes the pose onto the node. Nothing is allocated in the frame and no React state is set. The targets buffer already holds
      encoded numbers (the worker encodes against the layout's `enumValues`), so the loop does not encode.
    - **What moves, what rests.** A part's rotation is the rotation it was authored with followed by a rotation about its own axis; a slide runs along that axis. A
      part with no slot or whose reading is `NaN` (no value yet, which is every non-headline key of an asset nobody watches) stays at its authored pose and
      holds, and a spinning part with no data stops integrating rather than turning on. A stale or offline asset is skipped, so it freezes at its last pose and
      a spin stops (V2-14.1); a `tint` is not moved here.
    - **Asleep unless something moves.** The canvas is drawn on demand: the feed's `invalidate` wakes it when a reading, a layout or a flag changes, and the loop
      asks for the next frame only while a value has not settled or a part spins, so an idle scene draws nothing; a turning fan keeps the canvas drawing every
      frame for as long as it turns. The first value of a part, and the first after the telemetry socket comes back to `live`, snap instead of easing; the
      socket is watched on its store, so an outage while the canvas sleeps is not missed. A frame's `delta` is clamped to 0.1 s (`MAX_FRAME_DT_S`).
    - **Where the feed lives.** `TwinStage` mounts `useTwinFeed` (it reads the query cache, which does not reach the canvas's reconciler) and hands the feed down by
      prop; the canvas gives its `invalidate` back through `onCreated`, which the feed calls through a ref. Slots are looked up once per layout
      (`TwinFeedReader.layout`), because `slotOf` builds a string per call. `Equipment` tells the feed each ready class's bindings (`setBindings`).
  - Settled in V2-14.9 (2026-10-19), without changing the decision: how stale and alarm are drawn.
    - **One table decides the look.** `lookOf(flags, hovered, selected)` in `lib/twinMaterials.ts` gives an asset a face, an edge and whether it may move. Face:
      hovered or selected, then stale or offline, then alarm, then idle. Edge: the accent, then the severity (solid), then the stale dash, then the idle outline.
      So a stale fault is **grey with a solid severity edge**: "a fault is never hidden by a stale reading" is kept by the edge, not by a coloured face on data
      that is not live (this reverses the order the task text gave for the face). Offline looks stale. A stale material is one grey for every material.
    - **The alarm tint is computed.** `--tw-alarm-mix` (35 %, copied as `twinColors.alarmMix` and drift-checked) of the severity is mixed into each material's base
      with the same arithmetic as the tokens (`mixInto`, `tintFor`); the critical faces of the idle material are the tokens and the test that proves it. No colour
      appears other than a neutral material, a stale tone, the accent, a severity, or a fixed-weight mix of one into a neutral. The hover weight (30 %) has no
      token and is a constant checked against `twinColors.hover`.
    - **Painted from the flags, without React.** `twin/useAssetLooks.ts` reads `feed.read().flags(code)` in a `useFrame` and acts only for an asset whose flags object
      changed and whose look changed with it. Boxes (one merged mesh) get per-asset vertex colours and two edge layers, a solid and a dashed one, that share their
      vertices, colours and line distances and differ only in their index; models re-point each mesh at a pooled material per (name, face, severity) and show
      an outline built once per class (`EdgesGeometry`, hidden by default), so an idle model has no outline and costs no draw call. Hover and selection are
      not passed until V2-15.
    - **The part-level edge waits for the asset level.** The severity edge of the part bound to the rule's point, and the incident-detail fetch that gives its key,
      belong to V2-15, which introduces the asset level; until then the whole asset is tinted at every level (frame 04).
    - **The legend says it.** "No data — last known state, not live" is listed while any asset has no data, is offline or is stale (`hasDimmedAsset`, the scene's rule,
      not the Assets list's state word, which calls a stale fault a fault).
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
    - Settled in V2-14.10 (2026-10-19), without changing the decision: the console reads the parts list from the model.
      `fetchGlbJson` asks for the first 64 KiB of the file with a `Range` request (nginx answers `206`; the Vite dev
      server ignores `Range` and sends the whole file, which is read the same way) and a second request for exactly
      the JSON chunk when it is longer; a chunk above 2 MiB is refused. The tree is cached as reference data under
      the model's URL (`staleTime: Infinity`, one retry), so every asset of a class shares one request, and the 2D
      view and the WebGL-less fallback list parts without the 3D chunk. The rows are `partTree` joined with
      `bindingsFromNodes` (V2-14.2): every named node in document order, labelled by `extras.label` or the node name in
      sentence case. The V2-09.1 table (`lib/assetParts.ts`) is deleted.
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
    - Settled in V2-14.7 (2026-10-19), without changing the decision: what "merged at load" means.
      - **Once per class.** The static meshes (no `bind` on them or on an ancestor) are merged into one mesh per console
        material, with their transform relative to the class root baked in; every asset's copy shares that geometry, so
        an instance costs a transform and its bound parts. A bound part is moved under the new root keeping its world
        transform, and its own children, static or bound, stay under it and are not merged: they move with it.
      - **Materials by name are applied.** The eight names (`lib/twinMaterials.ts`) are the console's materials from
        `twinColors`; `Hub`, `Screen` and the `Xray` opacity are tokens (`--tw-hub`, `--tw-screen`, `--tw-xray-opacity`).
        The vendor's material is replaced whole: baked occlusion textures are not applied yet, and whether they will be
        is for the first delivery that has some (V2-13.8).
      - **LOD1 is ignored.** The `_LOD1` sibling is dropped when the model is built; level of detail is V2-19.5. A
        helper node whose name starts with `_` is not special at load.
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
  - Settled in V2-14.7 (2026-10-19), without changing the decision: the console loads a model with three's
    `GLTFLoader` and its own `MeshoptDecoder`, which embeds its WebAssembly and needs no file, and the Basis transcoder
    from `/decoders/basis/`; Draco is off. A class's file is fetched once per stage; the browser's HTTP cache answers
    when the stage is opened again, since the name is content-addressed.
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
