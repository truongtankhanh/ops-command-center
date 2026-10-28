# Console design tokens

The console's visual vocabulary: colour, type, spacing, radii, shadows, motion, focus and layers. Approved in the
[design brief](brief.md) (UI-01), implemented in UI-03.
V3 ([ADR-0022](../adr/0022-console-visual-language.md), [V3 brief](v3/brief.md)) replaced the palette, the shadows and
the radii; the chosen values and their reasons are in the brief's
[V3 values](v3/brief.md#v3-values-settled-in-v3-021), the measured ratios are in the generated tables below. The type
family is Inter (V3-03.1) and the type scale is the V3 one (V3-03.2, [Type scale](#type-scale)).

## Where they live

| File                                     | Holds                                                                                                                                                                                                                                                                                              |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/console/src/styles/tokens.css`     | Every token as a CSS custom property on `:root`. Modules read them with `var()` (ADR-0016 §2).                                                                                                                                                                                                     |
| `apps/console/src/styles/tokens.ts`      | The literal copies for code that cannot read CSS: `mapColors` and `mapMotion` (MapLibre), `twinColors` (WebGL), `canvasFont` (canvas text), `faviconMark`, and the `breakpoints` (UI-17).                                                                                                          |
| `apps/console/index.html`, `favicon.svg` | Literal copies of `--surface-1` (`theme-color`) and of three colours in the favicon.                                                                                                                                                                                                               |
| `docker/keycloak/themes/occ/login/`      | The sign-in theme: its own `:root` in `resources/css/occ.css` (colours, `--shadow-3`, `--radius-m` / `-l`, fonts, focus ring), two `rgb()` literals for the card and the shade, and the mark's colours in `template.ftl`. It loads before any console CSS, so it cannot `var()` into `tokens.css`. |

A copy outside `tokens.css` is checked against it on every lint (below), so it cannot drift silently: a token change and
its copies land in one change, and a new token with no pair in `scripts/contrast.ts` is unproven. The elevation tokens
(`--shadow-1…3`, `--glow-edge`, `--glass-bg`, `--vignette`) and `--panel-blur` are CSS only, so they have no copy in
`tokens.ts`; the theme copies `--shadow-3` alone. The two canvas fonts (`canvasFont`: the map's cluster count and the 3D beacon's tag) have
their family list checked against `--font-ui`; their weight and size copy `--weight-semibold`, `--type-s` and
`--type-2xs` and are not compared (see [icons.md](icons.md#map-glyphs)).

## Display modes and density (UI-17)

- **One scale.** `--ui-scale` (`1` on `:root`) multiplies every size token: `--type-*`, `--leading-*`, `--space-*`,
  `--radius-*`, `--sheet-width`, `--feed-width`, `--toast-width`, `--control-m` / `--control-s` / `--control-dense`, `--header-height`, `--kpi-height`.
  Each is written as `calc(<laptop px> * var(--ui-scale))`, so at scale 1 every value is the one in the mockups
  (frames at 1440 px). Colours, shadows, motion, the focus ring and z-index do not scale.
- **Modes by width**, named in `breakpoints` (`tokens.ts`): phone ≤ 720 px (a fallback: the map stacks above the
  feed, the sheet covers the screen), tablet ≤ 1100 px (narrower feed, KPI tiles on their own row, a 2 × 2 camera
  strip), laptop (the reference), **wall ≥ 1920 px** (`--ui-scale: 1.125`, 6 camera tiles) and **4K wall
  ≥ 3200 px** (`--ui-scale: 1.75`, 8 tiles). Only `--ui-scale` changes in the wall media queries at the end of
  `tokens.css`; `lint` checks that their widths match `breakpoints.wall` / `wall4k`. Script reads the mode with
  `useDisplayMode()` (`lib/shell/useDisplayMode.ts`) — today only the camera strip, for its tile count.
- **Shape.** `--radius-s` / `-m` / `-l` are 4 / 8 / 12 px: chips and badges / controls (buttons, fields, menus) / cards,
  the inspector and floating panels. `--control-m` is 40 px (buttons and fields), `--control-dense` 36 px (dense bars),
  `--control-s` 32 px (an action inside a row; the 24 px target floor holds). All of them scale with `--ui-scale`.
- **Density.** Comfortable (default) or compact, chosen in the account menu and remembered per browser
  (`occ.console.density`). Compact sets `data-density="compact"` on `<html>` (so portalled dialogs follow) and
  overrides the density tokens: `--row-pad-y`, `--list-gap`, `--header-pad-y`, `--header-height` (64 px, 56 px compact: the
  header's minimum height), `--kpi-height`, `--strip-height` (170 px, 150 px compact: the camera strip's height
  budget, which the strip sizes its tiles to fit rather than a fixed height), `--strip-pad`, `--strip-gap`,
  `--section-pad-y`. Type sizes never change with density (12 px is the floor for text read from a distance, 11 px only for
  non-actionable metadata, [Type scale](#type-scale)); on a
  touch screen (`pointer: coarse`) KPI tiles, feed rows and camera tile actions stay ≥ 44 px.
- **The sheet's width in script.** `--sheet-inset` is registered with `@property` (`<length>`), so the map reads the
  stage's computed value in px (`CampusMap` `sheetInset()`) instead of a copy: it follows the mode and is 0 where the
  sheet covers the whole screen.
- **Not scaled** (DN-6 of UI-17): what the map draws on its canvas — marker and cluster images, zone labels, layer
  widths — and the tooltip's placement distances in `MapTooltip.tsx` stay laptop-sized on a wall. The map's
  controls, legend and tooltip box do scale.

## Type scale

Written `calc(<px> * var(--ui-scale))` like every size token, so the wall modes scale it. The leading is the matching
`--leading-*`; `body` sets the unitless `1.45` (≈ `--leading-body` at 14 px) for text that sets only a size.

| Token         | Size | Leading | Use                                                                      |
| ------------- | ---- | ------- | ------------------------------------------------------------------------ |
| `--type-2xs`  | 11   | 16      | Secondary metadata only: timestamps, codes. No selector uses it yet      |
| `--type-xs`   | 12   | 16      | The floor for text read from a distance: tags, key caps, zone labels     |
| `--type-s`    | 13   | 18      | Dense rows and labels                                                    |
| `--type-m`    | 14   | 20      | In-row text                                                              |
| `--type-body` | 14   | 20      | Body text and control labels (`body` itself)                             |
| `--type-l`    | 16   | 22      | Section titles                                                           |
| `--type-xl`   | 20   | 26      | Dialog title, brand, header clock, large readings                        |
| `--type-2xl`  | 24   | 28      | Panel titles: inspector, incident detail, report form, wall focus banner |
| `--type-kpi`  | 28   | 28      | The count in a KPI tile (tabular figures; the tile is `--kpi-height`)    |
| `--type-3xl`  | 32   | 36      | The twin callout's figure                                                |

- **11 px is for metadata only** (ADR-0022 §5): timestamps and codes, never something an operator acts on. It adds no
  contrast pair: the three text tokens already pass 4.5:1 on all four surfaces, so a selector that adopts it only needs
  to name one of them. The first selectors arrive with V3-04.
- **12 px is the floor for everything else** that is read from a distance. The V1 line "13 px is the smallest text" is
  superseded ([V1 brief](brief.md#viewing-conditions)).
- **The KPI count has its own step** because its size is not a heading: `--type-kpi` 28 px on a 28 px line keeps the
  tile's content at 44 px, as the 24 px step did.

## Which surface, which token

From the brief's surface rules:

- `--surface-0`: ground, map, inputs. `--surface-1`: header, feed, sheet. `--surface-2`: hovered row, cards, action
  bar (the selected feed row is `--row-selected-bg`, its tint). `--surface-3`: raised small parts (chip and segment fills, tooltips). The menu, toast, dialog and banner are
  floating `Panel`s on `--glass-bg` (see the `Panel` bullet below). Camera tiles sit on `--camera-ground`; a frame with
  no picture (offline, stream unavailable, player pending) is striped `--camera-off-a` / `--camera-off-b`.
- Text tokens pass 4.5:1 on every surface. Critical text never sits on `--surface-3` or on a floating panel's glass
  (3.84:1 over the worst-case pixel, below 4.5:1): use the icon there and keep the label in `--text-primary`.
- `--border-strong` marks input and control boundaries on `--surface-0` / `--surface-1` only (≥ 3:1).
  `--border-subtle` is decorative: structure comes from surfaces. So a `secondary` `Button` (its boundary is
  `--border-strong`) sits only on `--surface-0` / `--surface-1`. On `--surface-2` / `--surface-3` (action bar) and on a
  floating `Panel` (toast, menu, dialog, banner; `--border-strong` is 2.64:1 on its glass) use `primary` or `ghost`, or add
  a checked pair first.
- A severity badge (`SeverityBadge`, and the checked option of a severity `SegmentedControl`) keeps its label in
  `--text-primary` on the `--sev-*-bg` tint. The hue is only on the icon, the tint and the border. The icon is held
  to 3:1 as a graphic, which is why critical (4.43:1 on its tint) passes.
- The escalated critical KPI tile (frame 04) uses the same rule on `--sev-critical-hot-bg`, an opaque 18 % mix into
  `--surface-1` (the header): count and label in `--text-primary`, the hue on the icon, the border and the
  `--sev-critical-hot-ring` glow.
- The selected feed row (V3-07.2) sits on `--row-selected-bg`, an opaque 14 % mix of `--accent` into `--surface-2`, with
  an accent edge and a 3 px accent bar and no glow. Its text, the accent edge and the compact severity chip on it
  (the chip's tint over this surface, and over a hovered row's `--surface-2`) are checked pairs. A fresh row's tint under
  the chip's own tint is translucent over translucent and cannot be named; the label stays `--text-primary`.
- The other KPI tiles (V3-05.2) take the severity badge's tint and border over `--surface-1`: the count is `--text-primary`
  and the label `--text-secondary`, both pairs above, and the hue is on the icon (3:1 as a graphic). The border is
  decorative, as the badge's is. A tile with nothing to count has no tint, and its count and icon are `--text-tertiary` on
  `--surface-1` (also a pair above); a Critical tile is therefore either hot or untinted. A pressed tile's edge is its own
  1 px border in `--accent`, the one neon element of the header.
- **One meaning per hue.** Severity is the only loud _meaning_ (ADR-0022): neon, the accent and live-data colour may
  glow, thinly and on purpose, but never stand for severity, and severity never borrows them. Status (`--status-*`) is
  neutral-based and never uses a severity hue.
- **The accent has two tones.** `--accent` (`#3185ff`) is the fill, the graphic and the focus ring, held to 3:1 on every
  surface and never used as text. `--accent-ink` is the same hue lightened for anything that reads as text or a glyph
  standing in for text (4.5:1 on every surface). `--on-accent` stays dark: white on `--accent` is 3.54:1.
  `--accent-hover` is a hover fill only.
- **`--signal` is live data**: telemetry lines, the healthy device marker, the Live pill (`--signal` text on
  `--signal-tint`, a checked pair). Text-capable (4.5:1). It is never a severity, never interaction. `--accent-2` is a
  second data series and a hover tint: graphics only (3:1), never text, because it falls under 4.5:1 on `--surface-3`.
  `ui/Sparkline` draws a series in `--signal` by default and in `--accent-2` as its second tone (`tone="secondary"`), both
  held to 3:1 as graphics on the surfaces it sits on (`--surface-1`, `--surface-2`); a series over its limit is `--sev` and
  a stale one is dashed `--text-tertiary`, and either wins over the tone.
- **`Pill` has three tones** (`ui/Pill`): `neutral` (a link being made, not yet good or bad news), `signal` (live data:
  the Live pill, and the telemetry pill while readings arrive) and `warning` (events or readings not arriving; text on
  `--warning-tint` is a checked pair). The tone never carries the state alone: the word and the glyph do, and the caller
  puts `role="status"` on the word it wants announced.
- **Low is neutral.** `--sev-low` is a steel (`#87a2c4`) and hue does not tell it from a quiet label. A Low item is
  found by its `Info` glyph, the word "Low", its place in the severity order and its 15 % tint with a 45 % border, which
  a status chip does not have. On the map and in 3D a resolved marker is drawn smaller than an acknowledged one, because
  both are neutral rings.
- **`--warning` and `--danger` are feedback only.** They sit close to `--sev-high` and `--sev-critical` in hue, so the
  rule is by place and shape: feedback goes on chrome (banner, pill, hint, form error) with its own glyph and never on
  the same element as a severity. The one exception is the late age on a feed row, which stays in `--warning` and is
  told apart by its clock glyph, weight and hidden text.
- **Elevation and neon.** `--shadow-1…3` are the only drop shadows. `--glow-edge` (a 1 px `--accent` ring plus a soft
  halo) is the lit edge of the active tab, the selected button and the open panel, never every card. `--glass-bg` is a
  panel at 90 %, legible without blur; blur is for small floating overlays. `--vignette` darkens the stage edge and
  never sits over a control or a label. `ui/Panel` uses `--glass-bg` and `--shadow-3`. `--glow-edge` is drawn by
  `ui/Button` while `aria-pressed` or `aria-expanded` is true, by the selected `Tabs` tab (a 2 px bar on the list's
  hairline, because the token is a ring plus a halo and would box the tab) and by a checked `SegmentedControl` option
  without a severity; a severity option keeps its own hue, since a glow never stands for severity. The 1 px ring is 3:1
  on every surface and the halo is in no contrast pair. No component uses `--vignette` yet.
- **`Panel` is the one place a translucent surface is drawn** (`ui/Panel`, ADR-0022 §4). `flat` (the default) is
  `--surface-1` with a hairline `--border-subtle` and `--radius-l`; `floating` is `--glass-bg` (90 % `--surface-1`) with
  the same hairline and `--shadow-3`, for a small overlay over the stage. Neither carries a glow. Text on a `Panel` is
  held to the `--surface-1` pairs and, because the glass lets the backdrop through, to the same six text tokens on
  `--glass-bg` over a white pixel (the worst case: a bright camera picture), which `contrast.ts` checks below. The
  real backdrop is darker, so those ratios can only rise.
- **The overlays are floating `Panel`s** (V3-04.5): the `Popover` panel (the user menu), the `Toast`, the `Dialog` and the
  `Banner` draw their surface through `Panel variant="floating"` and keep only their placement and z-index. Two keep a
  tone of their own on it: a severity `Toast` has a `--sev` border and a flat 3 px `--sev` ring (not `--glow-edge`), and
  the `Banner` has a `--warning` border. What they draw on the glass besides text (the severity, `--warning` and
  `--accent` graphics: borders, ring, icon tile, focus ring) is held to 3:1 over the same worst-case pixel, checked in
  `contrast.ts` below. `Sheet` is not a `Panel`: it stays a flat `--surface-1` drawer at the sheet width, with the large
  radius on its free (left) edge only and none when it fills the screen.
- **The blur and the `data-twin-tier` contract.** A floating `Panel` blurs what is behind it (`--panel-blur`,
  `blur(10px)`, not scaled by `--ui-scale`) only when **all** of these hold: the browser supports `backdrop-filter`, the
  person has not asked for less transparency (`prefers-reduced-transparency: reduce`; a browser that does not know the
  preference draws no blur), and the 3D quality tier is High. The tier is the attribute `data-twin-tier` on `<html>`,
  with the values `high` | `standard` | `low`: V3-18 sets it while the 3D view is mounted and removes it when it is not.
  `--panel-blur` is defined only under `:root[data-twin-tier='high']`, so a missing attribute, `standard` and `low` draw
  no blur. Nothing sets the attribute in Phase 1, so no panel is blurred yet; script never reads it.
- System feedback (`--success`, `--warning`, `--danger`) appears only in banners, toasts, form errors and the connection
  pills' lost-link tone (`--warning`; a live link is `--signal`), never on an incident.
- Layers, bottom to top: `--z-sheet`, `--z-banner`, `--z-popover`, `--z-toast`, `--z-dialog` (a modal confirmation,
  over `--scrim`), `--z-session`. The session-expired banner stays above a dialog, so signing in again is always
  reachable.

## Digital twin (V2)

The 3D scene's tokens, from the V2 brief's [New tokens](v2/brief.md#new-tokens) and frame 00 (`v2/mockups/twin.css`).
Added in V2-02.1, before any component uses them. WebGL cannot read custom properties either: the scene's copy is
`twinColors` in `tokens.ts` (V2-12.6, with the ground, the first consumer), checked for drift like `mapColors`.

| Token                                          | Value                                                        | Use                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `--tw-top` / `-south` / `-east`                | `#274152` / `#1f3748` / `#172b3a`                            | Part material, idle: three faces under one key light from the west-south-west |
| `--tw-edge`, `--tw-blade`                      | `#3e5a6e`, `#4d6a80`                                         | Part outline; fan blades                                                      |
| `--tw-ground`, `--tw-grid`, `--tw-road`        | `#0f1d27`, `#14242f`, `#182a36`                              | Campus ground, its grid, roads                                                |
| `--tw-steel-top` / `-south` / `-east`          | `#435766` / `#334553` / `#273745`                            | Motors, pumps, pipes, valves, cabinets                                        |
| `--tw-concrete-top` / `-south` / `-east`       | `#363c41` / `#2b3034` / `#22262a`                            | Basins, plinths, skids                                                        |
| `--tw-rail`                                    | `#8199aa`                                                    | Handrails, ladders, fan guard mesh                                            |
| `--tw-neutral`                                 | `#4b5d6b`                                                    | An asset with no model: its neutral box (frame 15)                            |
| `--tw-hub`, `--tw-screen`                      | `#5a7488`, `#2b3f66`                                         | Model materials `Hub` and `Screen`                                            |
| `--tw-xray-opacity`                            | `0.14`                                                       | Model material `Xray`: the idle material, see-through                         |
| `--tw-hover-top` / `-south` / `-east`          | 30 % `--accent` into the material                            | Hover and selection; the edge is `--accent`                                   |
| `--tw-alarm-mix`, `--tw-alarm-top` / … `-east` | 35 %; `--tw-alarm-mix` of `--sev-critical` into the material | A part with an open incident it raised; edge in severity                      |
| `--tw-stale-top` / `-south` / `-east`          | `#2b3338` / `#22292e` / `#1b2125`                            | No recent data: desaturated faces                                             |
| `--tw-stale-edge`                              | `#4a555c`, dashed                                            | No recent data: the edge                                                      |
| `--tw-ghost-opacity`                           | `0.18`                                                       | The rest of the campus while one asset is isolated                            |
| `--heat-0` … `--heat-5`                        | `#132b50` → `#9bc3ff`                                        | Telemetry overlay: sequential, the accent's hue (216°)                        |

- **`--tw-top` was lightened in V3** (from `#2a4658`) so a hovered, selected or alarmed edge keeps 3:1 against an idle
  neighbour with the V3 accent and critical. The other scene materials keep their V2 values until the realistic scene
  (Phase 3), so the 3D view is V2's look on a darker ground.
- **Alarm per severity.** Only the critical faces are tokens (frame 00's reference). The scene mixes
  `--tw-alarm-mix` of the incident's severity into the material itself, rather than 12 more tokens here.
- **Edges.** A hovered, selected or alarmed part's edge is held to 3:1 on `--tw-top` (an idle neighbour) and on
  `--tw-ground`. On the part's own hover or alarm face it falls below 3:1 (it only draws the shape there), so those
  pairs are reported only.
- **The idle outline is decorative.** `--tw-edge` on `--tw-ground` is 2.36:1 and on `--tw-top` 1.37:1: it draws the
  shape of a part or building and carries no state, so the pair is reported only (the face tones carry the shape).
- **Stale is dim on purpose.** `--tw-stale-edge` stays below 3:1: stale is carried by the dash, the stopped motion and
  the age on every value (V2 brief § Principles 3), not by a brighter outline that would outshine live parts.
- **Heat ramp.** Lightness carries the value; the legend and the Assets tab carry the number (V2 brief § Principles
  1 and 2). Its ends on the ground are reported only.
- **Zone fills for the V2 zone kinds** landed with the kinds (V2-03.1) in `mapColors.zoneFill`
  (`src/styles/tokens.ts`), checked against `--accent` below: `utility` `#1a282e` and `water` `#112833` as twin.css
  draws them, `sports` `#24361e` chosen in V2-03.1 (no frame draws a sports zone; an olive no other fill uses, in the
  same lightness band).
- **Not tokens yet.** twin.css's other literals (details, louvres, ribs, seams, the blade hover) land with the scene.

## What may stay a raw value

Component CSS and TSX use tokens for colour, `font-size` / `line-height` / `font-weight`, spacing (padding, margin,
gap, offsets used as spacing), `border-radius`, `box-shadow`, `z-index`, animation durations and easing, and the
focus ring. These may stay raw:

- `@media` breakpoints: custom properties are not allowed in media queries. The widths are named in `breakpoints`
  (`tokens.ts`); the two wall queries in `tokens.css` are checked against it.
- 1–3 px border, outline and stroke widths, inset `box-shadow` lines of the same widths (selected feed row, checked
  severity option), and `outline-offset`. Drop shadows always use `--shadow-*`.
- Component dimensions: `width`, `height`, `min-*`, `max-width`, `grid-template-columns`, `aspect-ratio`, `ch` and
  `vh` lengths, and the geometry of drawn graphics (lifecycle stepper dot and rail, legend samples). Since UI-17 they
  are written as the laptop value times the scale, `calc(34px * var(--ui-scale))`, so they grow with the text on a
  wall; percentages, `ch` / `vh` and `999px` pill radii stay as they are. Shared sizes are tokens: `--sheet-width`
  (440 px, frame 02, until V3-09 resizes it; full-screen `100%` at ≤ 720 px), `--feed-width` (360 px), `--toast-width` (392 px),
  `--control-m` / `--control-s` / `--control-dense` (40 / 32 / 36 px, buttons, fields, the account menu's switches), `--header-height`, `--kpi-height`. Icon
  sizes (14 / 16 / 18 / 20 / 22 px, the `Icon` `size` prop) are laptop values the same way: `Icon.module.css`
  multiplies them by the scale — see [icons.md](icons.md).
- MapLibre numbers in `CampusMap.tsx`, `lib/map/map*.ts`, `lib/map/geo.ts` and `lib/map/sitePlan.ts`: `line-width` and
  `line-dasharray`, circle radii and stroke widths, `fitBounds` padding, `easeTo` duration, zoom levels, cluster
  radius, marker offsets, the pulse frame rate and scale, the marker image geometry in `lib/map/mapImages.ts` (image boxes,
  disc radii, glyph sizes and strokes), and the site plan geometry in metres (boundary, roads, field markings, inset
  and row spacing). The site plan colours are map-only values in `tokens.ts` (`mapColors.site`), not tokens.
- The map tooltip's placement distances (flip below the anchor near the top, horizontal clamp) and the zone label
  halo (a 3 px `--surface-0` text stroke, frame 01).
- The simulated camera image drawn on the `CameraFeed` canvas (strip, sheet and viewer): it is picture
  content, not UI, and real players replace it (OCC-16).
- `body` `line-height: 1.45`, unitless on purpose: it scales for every element that sets only a `font-size`. A px
  value would be inherited as is.

## How the contrast is checked

`apps/console/scripts/contrast.ts` reads `tokens.css` and `tokens.ts`, computes WCAG 2.x contrast ratios, and checks
the pairs that occur in the UI (minimum 4.5:1 for text, 3:1 for meaningful boundaries) and the copied values (map
colours, the pulse duration and the wall breakpoints in `tokens.ts`, `theme-color`, the favicon).

- `pnpm --filter @occ/console lint` runs it with `--check` and fails on a pair below its minimum or a drifted copy.
- `pnpm --filter @occ/console tokens:contrast` regenerates the tables below. Run it after changing a token and commit
  the result.

A pair marked "reported only" is published but not enforced yet, with the reason.

## Contrast

<!-- contrast:start -->

<!-- Generated by `pnpm --filter @occ/console tokens:contrast` — do not edit between the markers. -->

### Every colour token on every surface

| Token               | Value   | `--surface-0` #07111f | `--surface-1` #0d1c2d | `--surface-2` #12263b | `--surface-3` #1a3250 |
| ------------------- | ------- | --------------------- | --------------------- | --------------------- | --------------------- |
| `--text-primary`    | #e7f2ff | 16.72                 | 15.19                 | 13.57                 | 11.47                 |
| `--text-secondary`  | #a6b8c5 | 9.27                  | 8.42                  | 7.53                  | 6.36                  |
| `--text-tertiary`   | #91a5b4 | 7.43                  | 6.75                  | 6.04                  | 5.10                  |
| `--accent`          | #3185ff | 5.35                  | 4.86                  | 4.34                  | 3.67                  |
| `--accent-ink`      | #5e9fff | 7.10                  | 6.45                  | 5.77                  | 4.88                  |
| `--accent-2`        | #8b7cff | 5.79                  | 5.26                  | 4.70                  | 3.98                  |
| `--signal`          | #35e7ff | 12.65                 | 11.49                 | 10.27                 | 8.68                  |
| `--sev-critical`    | #ff426d | 5.64                  | 5.12                  | 4.58                  | 3.87                  |
| `--sev-high`        | #ffad42 | 10.20                 | 9.26                  | 8.28                  | 7.00                  |
| `--sev-medium`      | #f2d04b | 12.53                 | 11.38                 | 10.17                 | 8.60                  |
| `--sev-low`         | #87a2c4 | 7.21                  | 6.55                  | 5.85                  | 4.95                  |
| `--status-resolved` | #86bba0 | 8.68                  | 7.89                  | 7.05                  | 5.96                  |
| `--success`         | #35e0a1 | 11.12                 | 10.10                 | 9.02                  | 7.63                  |
| `--warning`         | #e2be7a | 10.71                 | 9.73                  | 8.70                  | 7.35                  |
| `--danger`          | #ff8a7a | 8.27                  | 7.51                  | 6.71                  | 5.67                  |
| `--border-strong`   | #5a7488 | 3.87                  | 3.51                  | 3.14                  | 2.65                  |
| `--border-subtle`   | #1e3550 | 1.52                  | 1.38                  | 1.23                  | 1.04                  |

Informational: a token is only held to a minimum on the surfaces listed below.

### Checked pairs

| Foreground          | Background                                     | Ratio | Minimum | Result                                                                                     |
| ------------------- | ---------------------------------------------- | ----- | ------- | ------------------------------------------------------------------------------------------ |
| `--text-primary`    | `--surface-0`                                  | 16.72 | 4.5     | pass                                                                                       |
| `--text-primary`    | `--surface-1`                                  | 15.19 | 4.5     | pass                                                                                       |
| `--text-primary`    | `--surface-2`                                  | 13.57 | 4.5     | pass                                                                                       |
| `--text-primary`    | `--surface-3`                                  | 11.47 | 4.5     | pass                                                                                       |
| `--text-secondary`  | `--surface-0`                                  | 9.27  | 4.5     | pass                                                                                       |
| `--text-secondary`  | `--surface-1`                                  | 8.42  | 4.5     | pass                                                                                       |
| `--text-secondary`  | `--surface-2`                                  | 7.53  | 4.5     | pass                                                                                       |
| `--text-secondary`  | `--surface-3`                                  | 6.36  | 4.5     | pass                                                                                       |
| `--text-tertiary`   | `--surface-0`                                  | 7.43  | 4.5     | pass                                                                                       |
| `--text-tertiary`   | `--surface-1`                                  | 6.75  | 4.5     | pass                                                                                       |
| `--text-tertiary`   | `--surface-2`                                  | 6.04  | 4.5     | pass                                                                                       |
| `--text-tertiary`   | `--surface-3`                                  | 5.10  | 4.5     | pass                                                                                       |
| `--status-resolved` | `--surface-0`                                  | 8.68  | 4.5     | pass                                                                                       |
| `--status-resolved` | `--surface-1`                                  | 7.89  | 4.5     | pass                                                                                       |
| `--status-resolved` | `--surface-2`                                  | 7.05  | 4.5     | pass                                                                                       |
| `--status-resolved` | `--surface-3`                                  | 5.96  | 4.5     | pass                                                                                       |
| `--accent-ink`      | `--surface-0`                                  | 7.10  | 4.5     | pass                                                                                       |
| `--accent-ink`      | `--surface-1`                                  | 6.45  | 4.5     | pass                                                                                       |
| `--accent-ink`      | `--surface-2`                                  | 5.77  | 4.5     | pass                                                                                       |
| `--accent-ink`      | `--surface-3`                                  | 4.88  | 4.5     | pass                                                                                       |
| `--signal`          | `--surface-0`                                  | 12.65 | 4.5     | pass                                                                                       |
| `--signal`          | `--surface-1`                                  | 11.49 | 4.5     | pass                                                                                       |
| `--signal`          | `--surface-2`                                  | 10.27 | 4.5     | pass                                                                                       |
| `--signal`          | `--surface-3`                                  | 8.68  | 4.5     | pass                                                                                       |
| `--text-primary`    | `--glass-bg` over `glass backdrop, worst case` | 11.40 | 4.5     | pass                                                                                       |
| `--text-secondary`  | `--glass-bg` over `glass backdrop, worst case` | 6.32  | 4.5     | pass                                                                                       |
| `--text-tertiary`   | `--glass-bg` over `glass backdrop, worst case` | 5.07  | 4.5     | pass                                                                                       |
| `--status-resolved` | `--glass-bg` over `glass backdrop, worst case` | 5.92  | 4.5     | pass                                                                                       |
| `--accent-ink`      | `--glass-bg` over `glass backdrop, worst case` | 4.84  | 4.5     | pass                                                                                       |
| `--signal`          | `--glass-bg` over `glass backdrop, worst case` | 8.62  | 4.5     | pass                                                                                       |
| `--sev-critical`    | `--glass-bg` over `glass backdrop, worst case` | 3.84  | 3       | pass                                                                                       |
| `--sev-high`        | `--glass-bg` over `glass backdrop, worst case` | 6.95  | 3       | pass                                                                                       |
| `--sev-medium`      | `--glass-bg` over `glass backdrop, worst case` | 8.55  | 3       | pass                                                                                       |
| `--sev-low`         | `--glass-bg` over `glass backdrop, worst case` | 4.92  | 3       | pass                                                                                       |
| `--warning`         | `--glass-bg` over `glass backdrop, worst case` | 7.30  | 3       | pass                                                                                       |
| `--accent`          | `--glass-bg` over `glass backdrop, worst case` | 3.65  | 3       | pass                                                                                       |
| `--accent`          | `--surface-0`                                  | 5.35  | 3       | pass                                                                                       |
| `--accent`          | `--surface-1`                                  | 4.86  | 3       | pass                                                                                       |
| `--accent`          | `--surface-2`                                  | 4.34  | 3       | pass                                                                                       |
| `--accent`          | `--surface-3`                                  | 3.67  | 3       | pass                                                                                       |
| `--accent-2`        | `--surface-0`                                  | 5.79  | 3       | pass                                                                                       |
| `--accent-2`        | `--surface-1`                                  | 5.26  | 3       | pass                                                                                       |
| `--accent-2`        | `--surface-2`                                  | 4.70  | 3       | pass                                                                                       |
| `--accent-2`        | `--surface-3`                                  | 3.98  | 3       | pass                                                                                       |
| `--on-accent`       | `--accent`                                     | 5.35  | 4.5     | pass                                                                                       |
| `--on-accent`       | `--accent-hover`                               | 6.44  | 4.5     | pass                                                                                       |
| `--sev-critical`    | `--surface-0`                                  | 5.64  | 4.5     | pass                                                                                       |
| `--sev-critical`    | `--surface-1`                                  | 5.12  | 4.5     | pass                                                                                       |
| `--sev-critical`    | `--surface-2`                                  | 4.58  | 4.5     | pass                                                                                       |
| `--sev-high`        | `--surface-0`                                  | 10.20 | 4.5     | pass                                                                                       |
| `--sev-high`        | `--surface-1`                                  | 9.26  | 4.5     | pass                                                                                       |
| `--sev-high`        | `--surface-2`                                  | 8.28  | 4.5     | pass                                                                                       |
| `--sev-medium`      | `--surface-0`                                  | 12.53 | 4.5     | pass                                                                                       |
| `--sev-medium`      | `--surface-1`                                  | 11.38 | 4.5     | pass                                                                                       |
| `--sev-medium`      | `--surface-2`                                  | 10.17 | 4.5     | pass                                                                                       |
| `--sev-low`         | `--surface-0`                                  | 7.21  | 4.5     | pass                                                                                       |
| `--sev-low`         | `--surface-1`                                  | 6.55  | 4.5     | pass                                                                                       |
| `--sev-low`         | `--surface-2`                                  | 5.85  | 4.5     | pass                                                                                       |
| `--sev-critical`    | `--surface-3`                                  | 3.87  | 4.5     | reported only: icon only on surface-3                                                      |
| `--success`         | `--surface-1`                                  | 10.10 | 4.5     | pass                                                                                       |
| `--success`         | `--surface-2`                                  | 9.02  | 4.5     | pass                                                                                       |
| `--success`         | `--surface-3`                                  | 7.63  | 4.5     | pass                                                                                       |
| `--warning`         | `--surface-1`                                  | 9.73  | 4.5     | pass                                                                                       |
| `--warning`         | `--surface-2`                                  | 8.70  | 4.5     | pass                                                                                       |
| `--warning`         | `--surface-3`                                  | 7.35  | 4.5     | pass                                                                                       |
| `--danger`          | `--surface-1`                                  | 7.51  | 4.5     | pass                                                                                       |
| `--danger`          | `--surface-2`                                  | 6.71  | 4.5     | pass                                                                                       |
| `--danger`          | `--surface-3`                                  | 5.67  | 4.5     | pass                                                                                       |
| `--border-strong`   | `--surface-0`                                  | 3.87  | 3       | pass                                                                                       |
| `--border-strong`   | `--surface-1`                                  | 3.51  | 3       | pass                                                                                       |
| `--text-primary`    | `--camera-ground`                              | 17.21 | 4.5     | pass                                                                                       |
| `--text-secondary`  | `--camera-ground`                              | 9.55  | 4.5     | pass                                                                                       |
| `--signal`          | `--camera-ground`                              | 13.02 | 3       | pass                                                                                       |
| `--sev-critical`    | `--camera-ground`                              | 5.80  | 3       | pass                                                                                       |
| `--text-primary`    | `--camera-off-a`                               | 16.64 | 4.5     | pass                                                                                       |
| `--text-primary`    | `--camera-off-b`                               | 16.08 | 4.5     | pass                                                                                       |
| `--text-secondary`  | `--camera-off-a`                               | 9.23  | 4.5     | pass                                                                                       |
| `--text-secondary`  | `--camera-off-b`                               | 8.92  | 4.5     | pass                                                                                       |
| `map zone outline`  | `map ground`                                   | 3.76  | 3       | pass                                                                                       |
| `--text-secondary`  | `map ground`                                   | 9.27  | 4.5     | pass                                                                                       |
| `map zone outline`  | `map boundary`                                 | 3.40  | 3       | pass                                                                                       |
| `--text-secondary`  | `map boundary`                                 | 8.39  | 4.5     | pass                                                                                       |
| `--accent`          | `map boundary`                                 | 4.84  | 3       | pass                                                                                       |
| `--accent`          | `map zone building`                            | 3.60  | 3       | pass                                                                                       |
| `--accent`          | `map zone parking`                             | 4.01  | 3       | pass                                                                                       |
| `--accent`          | `map zone gate`                                | 3.45  | 3       | pass                                                                                       |
| `--accent`          | `map zone outdoor`                             | 3.98  | 3       | pass                                                                                       |
| `--accent`          | `map zone sports`                              | 3.66  | 3       | pass                                                                                       |
| `--accent`          | `map zone utility`                             | 4.28  | 3       | pass                                                                                       |
| `--accent`          | `map zone water`                               | 4.31  | 3       | pass                                                                                       |
| `--sev-critical`    | `--surface-3`                                  | 3.87  | 3       | pass                                                                                       |
| `--sev-high`        | `--surface-3`                                  | 7.00  | 3       | pass                                                                                       |
| `--sev-medium`      | `--surface-3`                                  | 8.60  | 3       | pass                                                                                       |
| `--sev-low`         | `--surface-3`                                  | 4.95  | 3       | pass                                                                                       |
| `--text-primary`    | `--sev-critical-bg` over `--surface-1`         | 13.13 | 4.5     | pass                                                                                       |
| `--text-primary`    | `--sev-high-bg` over `--surface-1`             | 11.40 | 4.5     | pass                                                                                       |
| `--text-primary`    | `--sev-medium-bg` over `--surface-1`           | 10.82 | 4.5     | pass                                                                                       |
| `--text-primary`    | `--sev-low-bg` over `--surface-1`              | 11.84 | 4.5     | pass                                                                                       |
| `--sev-critical`    | `--sev-critical-bg` over `--surface-1`         | 4.43  | 3       | pass                                                                                       |
| `--sev-high`        | `--sev-high-bg` over `--surface-1`             | 6.95  | 3       | pass                                                                                       |
| `--sev-medium`      | `--sev-medium-bg` over `--surface-1`           | 8.11  | 3       | pass                                                                                       |
| `--sev-low`         | `--sev-low-bg` over `--surface-1`              | 5.10  | 3       | pass                                                                                       |
| `--status-resolved` | `--status-resolved-bg` over `--surface-1`      | 6.08  | 4.5     | pass                                                                                       |
| `--text-primary`    | `--sev-critical-hot-bg`                        | 12.63 | 4.5     | pass                                                                                       |
| `--sev-critical`    | `--sev-critical-hot-bg`                        | 4.26  | 3       | pass                                                                                       |
| `--text-secondary`  | `--sev-critical-bg` over `--surface-1`         | 7.28  | 4.5     | pass                                                                                       |
| `--warning`         | `--sev-critical-bg` over `--surface-1`         | 8.41  | 4.5     | pass                                                                                       |
| `--status-resolved` | `--sev-critical-bg` over `--surface-1`         | 6.82  | 4.5     | pass                                                                                       |
| `--text-secondary`  | `--sev-high-bg` over `--surface-1`             | 6.32  | 4.5     | pass                                                                                       |
| `--warning`         | `--sev-high-bg` over `--surface-1`             | 7.30  | 4.5     | pass                                                                                       |
| `--status-resolved` | `--sev-high-bg` over `--surface-1`             | 5.92  | 4.5     | pass                                                                                       |
| `--text-secondary`  | `--sev-medium-bg` over `--surface-1`           | 6.00  | 4.5     | pass                                                                                       |
| `--warning`         | `--sev-medium-bg` over `--surface-1`           | 6.93  | 4.5     | pass                                                                                       |
| `--status-resolved` | `--sev-medium-bg` over `--surface-1`           | 5.62  | 4.5     | pass                                                                                       |
| `--text-secondary`  | `--sev-low-bg` over `--surface-1`              | 6.57  | 4.5     | pass                                                                                       |
| `--warning`         | `--sev-low-bg` over `--surface-1`              | 7.59  | 4.5     | pass                                                                                       |
| `--status-resolved` | `--sev-low-bg` over `--surface-1`              | 6.15  | 4.5     | pass                                                                                       |
| `--text-primary`    | `--accent-tint` over `--surface-1`             | 12.64 | 4.5     | pass                                                                                       |
| `--accent-ink`      | `--accent-tint` over `--surface-1`             | 5.37  | 4.5     | pass                                                                                       |
| `--accent-ink`      | `--accent-tint` over `--surface-2`             | 4.78  | 4.5     | pass                                                                                       |
| `--text-primary`    | `--row-selected-bg`                            | 11.24 | 4.5     | pass                                                                                       |
| `--text-secondary`  | `--row-selected-bg`                            | 6.23  | 4.5     | pass                                                                                       |
| `--warning`         | `--row-selected-bg`                            | 7.20  | 4.5     | pass                                                                                       |
| `--status-resolved` | `--row-selected-bg`                            | 5.84  | 4.5     | pass                                                                                       |
| `--accent`          | `--row-selected-bg`                            | 3.59  | 3       | pass                                                                                       |
| `--text-primary`    | `--sev-critical-bg` over `--row-selected-bg`   | 10.07 | 4.5     | pass                                                                                       |
| `--sev-critical`    | `--sev-critical-bg` over `--row-selected-bg`   | 3.40  | 3       | pass                                                                                       |
| `--text-primary`    | `--sev-high-bg` over `--row-selected-bg`       | 8.56  | 4.5     | pass                                                                                       |
| `--sev-high`        | `--sev-high-bg` over `--row-selected-bg`       | 5.22  | 3       | pass                                                                                       |
| `--text-primary`    | `--sev-medium-bg` over `--row-selected-bg`     | 8.08  | 4.5     | pass                                                                                       |
| `--sev-medium`      | `--sev-medium-bg` over `--row-selected-bg`     | 6.05  | 3       | pass                                                                                       |
| `--text-primary`    | `--sev-low-bg` over `--row-selected-bg`        | 8.80  | 4.5     | pass                                                                                       |
| `--sev-low`         | `--sev-low-bg` over `--row-selected-bg`        | 3.79  | 3       | pass                                                                                       |
| `--text-primary`    | `--sev-critical-bg` over `--surface-2`         | 11.82 | 4.5     | pass                                                                                       |
| `--sev-critical`    | `--sev-critical-bg` over `--surface-2`         | 3.99  | 3       | pass                                                                                       |
| `--text-primary`    | `--sev-high-bg` over `--surface-2`             | 10.13 | 4.5     | pass                                                                                       |
| `--sev-high`        | `--sev-high-bg` over `--surface-2`             | 6.18  | 3       | pass                                                                                       |
| `--text-primary`    | `--sev-medium-bg` over `--surface-2`           | 9.59  | 4.5     | pass                                                                                       |
| `--sev-medium`      | `--sev-medium-bg` over `--surface-2`           | 7.19  | 3       | pass                                                                                       |
| `--text-primary`    | `--sev-low-bg` over `--surface-2`              | 10.50 | 4.5     | pass                                                                                       |
| `--sev-low`         | `--sev-low-bg` over `--surface-2`              | 4.53  | 3       | pass                                                                                       |
| `--accent`          | `--accent-tint` over `--surface-1`             | 4.04  | 3       | pass                                                                                       |
| `--on-accent`       | `--sev-critical`                               | 5.64  | 3       | pass                                                                                       |
| `--on-accent`       | `--sev-high`                                   | 10.20 | 3       | pass                                                                                       |
| `--on-accent`       | `--sev-medium`                                 | 12.53 | 3       | pass                                                                                       |
| `--on-accent`       | `--sev-low`                                    | 7.21  | 3       | pass                                                                                       |
| `--warning`         | `--warning-tint` over `--surface-1`            | 7.65  | 4.5     | pass                                                                                       |
| `--signal`          | `--signal-tint` over `--surface-1`             | 8.70  | 4.5     | pass                                                                                       |
| `--danger`          | `--danger-tint` over `--surface-1`             | 6.23  | 3       | pass                                                                                       |
| `--accent`          | `--tw-top`                                     | 3.02  | 3       | pass                                                                                       |
| `--accent`          | `--tw-ground`                                  | 4.84  | 3       | pass                                                                                       |
| `--sev-critical`    | `--tw-top`                                     | 3.18  | 3       | pass                                                                                       |
| `--sev-critical`    | `--tw-ground`                                  | 5.10  | 3       | pass                                                                                       |
| `--sev-high`        | `--tw-top`                                     | 5.76  | 3       | pass                                                                                       |
| `--sev-high`        | `--tw-ground`                                  | 9.23  | 3       | pass                                                                                       |
| `--sev-medium`      | `--tw-top`                                     | 7.08  | 3       | pass                                                                                       |
| `--sev-medium`      | `--tw-ground`                                  | 11.34 | 3       | pass                                                                                       |
| `--sev-low`         | `--tw-top`                                     | 4.07  | 3       | pass                                                                                       |
| `--sev-low`         | `--tw-ground`                                  | 6.52  | 3       | pass                                                                                       |
| `--accent`          | `--tw-hover-top`                               | 2.15  | 3       | reported only: between the part’s own faces; held on the ground and idle neighbours        |
| `--sev-critical`    | `--tw-alarm-top`                               | 2.37  | 3       | reported only: between the part’s own faces; held on the ground and idle neighbours        |
| `--sev-high`        | `--tw-alarm-top`                               | 4.28  | 3       | reported only: between the part’s own faces; held on the ground and idle neighbours        |
| `--sev-medium`      | `--tw-alarm-top`                               | 5.26  | 3       | reported only: between the part’s own faces; held on the ground and idle neighbours        |
| `--sev-low`         | `--tw-alarm-top`                               | 3.03  | 3       | reported only: between the part’s own faces; held on the ground and idle neighbours        |
| `--tw-stale-edge`   | `--tw-stale-top`                               | 1.68  | 3       | reported only: dim on purpose; the dash, stopped motion and value ages carry stale         |
| `--tw-stale-edge`   | `map ground`                                   | 2.48  | 3       | reported only: dim on purpose; the dash carries no data, and the Assets tab says it too    |
| `--tw-stale-edge`   | `--surface-1`                                  | 2.25  | 3       | reported only: dim on purpose; the dash and the words carry no data                        |
| `--text-secondary`  | `--tw-ground`                                  | 8.39  | 4.5     | pass                                                                                       |
| `--text-secondary`  | `--tw-top`                                     | 5.24  | 4.5     | pass                                                                                       |
| `--tw-edge`         | `--tw-ground`                                  | 2.36  | 3       | reported only: decorative outline; the face tones carry the shape                          |
| `--heat-0`          | `--tw-ground`                                  | 1.22  | 3       | reported only: lightness carries the value; the legend and the Assets tab carry the number |
| `--heat-5`          | `--tw-ground`                                  | 9.50  | 3       | reported only: lightness carries the value; the legend and the Assets tab carry the number |
| `--text-primary`    | `--danger-tint` over `--surface-1`             | 12.59 | 4.5     | pass                                                                                       |
| `--text-primary`    | `sign-in backdrop, brightest`                  | 9.77  | 4.5     | pass                                                                                       |
| `--text-secondary`  | `sign-in backdrop, brightest`                  | 5.42  | 4.5     | pass                                                                                       |
| `--text-tertiary`   | `sign-in backdrop, foot band`                  | 5.40  | 4.5     | pass                                                                                       |

### Values copied out of tokens.css

| Copy                                                       | Value                                   | Must equal                              | Result |
| ---------------------------------------------------------- | --------------------------------------- | --------------------------------------- | ------ |
| `mapColors.ground` (src/styles/tokens.ts)                  | #07111f                                 | #07111f                                 | match  |
| `mapColors.severity.critical` (src/styles/tokens.ts)       | #ff426d                                 | #ff426d                                 | match  |
| `mapColors.severity.high` (src/styles/tokens.ts)           | #ffad42                                 | #ffad42                                 | match  |
| `mapColors.severity.medium` (src/styles/tokens.ts)         | #f2d04b                                 | #f2d04b                                 | match  |
| `mapColors.severity.low` (src/styles/tokens.ts)            | #87a2c4                                 | #87a2c4                                 | match  |
| `mapColors.surface1` (src/styles/tokens.ts)                | #0d1c2d                                 | #0d1c2d                                 | match  |
| `mapColors.surface2` (src/styles/tokens.ts)                | #12263b                                 | #12263b                                 | match  |
| `mapColors.surface3` (src/styles/tokens.ts)                | #1a3250                                 | #1a3250                                 | match  |
| `mapColors.accent` (src/styles/tokens.ts)                  | #3185ff                                 | #3185ff                                 | match  |
| `mapColors.onAccent` (src/styles/tokens.ts)                | #07111f                                 | #07111f                                 | match  |
| `mapColors.textPrimary` (src/styles/tokens.ts)             | #e7f2ff                                 | #e7f2ff                                 | match  |
| `mapColors.textSecondary` (src/styles/tokens.ts)           | #a6b8c5                                 | #a6b8c5                                 | match  |
| `mapColors.textTertiary` (src/styles/tokens.ts)            | #91a5b4                                 | #91a5b4                                 | match  |
| `mapColors.staleEdge` (src/styles/tokens.ts)               | #4a555c                                 | #4a555c                                 | match  |
| `twinColors.ground` (src/styles/tokens.ts)                 | #0f1d27                                 | #0f1d27                                 | match  |
| `twinColors.grid` (src/styles/tokens.ts)                   | #14242f                                 | #14242f                                 | match  |
| `twinColors.road` (src/styles/tokens.ts)                   | #182a36                                 | #182a36                                 | match  |
| `twinColors.edge` (src/styles/tokens.ts)                   | #3e5a6e                                 | #3e5a6e                                 | match  |
| `twinColors.rail` (src/styles/tokens.ts)                   | #8199aa                                 | #8199aa                                 | match  |
| `twinColors.neutral` (src/styles/tokens.ts)                | #4b5d6b                                 | #4b5d6b                                 | match  |
| `twinColors.blade` (src/styles/tokens.ts)                  | #4d6a80                                 | #4d6a80                                 | match  |
| `twinColors.hub` (src/styles/tokens.ts)                    | #5a7488                                 | #5a7488                                 | match  |
| `twinColors.screen` (src/styles/tokens.ts)                 | #2b3f66                                 | #2b3f66                                 | match  |
| `twinColors.idle.top` (src/styles/tokens.ts)               | #274152                                 | #274152                                 | match  |
| `twinColors.idle.south` (src/styles/tokens.ts)             | #1f3748                                 | #1f3748                                 | match  |
| `twinColors.idle.east` (src/styles/tokens.ts)              | #172b3a                                 | #172b3a                                 | match  |
| `twinColors.steel.top` (src/styles/tokens.ts)              | #435766                                 | #435766                                 | match  |
| `twinColors.steel.south` (src/styles/tokens.ts)            | #334553                                 | #334553                                 | match  |
| `twinColors.steel.east` (src/styles/tokens.ts)             | #273745                                 | #273745                                 | match  |
| `twinColors.concrete.top` (src/styles/tokens.ts)           | #363c41                                 | #363c41                                 | match  |
| `twinColors.concrete.south` (src/styles/tokens.ts)         | #2b3034                                 | #2b3034                                 | match  |
| `twinColors.concrete.east` (src/styles/tokens.ts)          | #22262a                                 | #22262a                                 | match  |
| `twinColors.hover.top` (src/styles/tokens.ts)              | #2a5586                                 | #2a5586                                 | match  |
| `twinColors.hover.south` (src/styles/tokens.ts)            | #244e7f                                 | #244e7f                                 | match  |
| `twinColors.hover.east` (src/styles/tokens.ts)             | #1f4675                                 | #1f4675                                 | match  |
| `twinColors.alarm.top` (src/styles/tokens.ts)              | #73415b                                 | #73415b                                 | match  |
| `twinColors.alarm.south` (src/styles/tokens.ts)            | #6d3b55                                 | #6d3b55                                 | match  |
| `twinColors.alarm.east` (src/styles/tokens.ts)             | #68334c                                 | #68334c                                 | match  |
| `twinColors.stale.top` (src/styles/tokens.ts)              | #2b3338                                 | #2b3338                                 | match  |
| `twinColors.stale.south` (src/styles/tokens.ts)            | #22292e                                 | #22292e                                 | match  |
| `twinColors.stale.east` (src/styles/tokens.ts)             | #1b2125                                 | #1b2125                                 | match  |
| `twinColors.staleEdge` (src/styles/tokens.ts)              | #4a555c                                 | #4a555c                                 | match  |
| `twinColors.heat[0]` (src/styles/tokens.ts)                | #132b50                                 | #132b50                                 | match  |
| `twinColors.heat[1]` (src/styles/tokens.ts)                | #1c3d6f                                 | #1c3d6f                                 | match  |
| `twinColors.heat[2]` (src/styles/tokens.ts)                | #22539c                                 | #22539c                                 | match  |
| `twinColors.heat[3]` (src/styles/tokens.ts)                | #266cd5                                 | #266cd5                                 | match  |
| `twinColors.heat[4]` (src/styles/tokens.ts)                | #5292f2                                 | #5292f2                                 | match  |
| `twinColors.heat[5]` (src/styles/tokens.ts)                | #9bc3ff                                 | #9bc3ff                                 | match  |
| `twinColors.ghostOpacity` (src/styles/tokens.ts)           | 0.18                                    | 0.18                                    | match  |
| `twinColors.alarmMix` (src/styles/tokens.ts)               | 35%                                     | 35%                                     | match  |
| `twinColors.xrayOpacity` (src/styles/tokens.ts)            | 0.14                                    | 0.14                                    | match  |
| `mapMotion.pulseMs` (src/styles/tokens.ts)                 | 1800ms                                  | 1800ms                                  | match  |
| `canvasFont.clusterCount` family (src/styles/tokens.ts)    | Inter Variable, system-ui, sans-serif   | Inter Variable, system-ui, sans-serif   | match  |
| `canvasFont.beaconTag` family (src/styles/tokens.ts)       | Inter Variable, system-ui, sans-serif   | Inter Variable, system-ui, sans-serif   | match  |
| `breakpoints.wall` (src/styles/tokens.ts)                  | 1920px                                  | 1920px                                  | match  |
| `breakpoints.wall4k` (src/styles/tokens.ts)                | 3200px                                  | 3200px                                  | match  |
| `theme-color` (index.html)                                 | #0d1c2d                                 | #0d1c2d                                 | match  |
| `faviconMark` (src/styles/tokens.ts)                       | public/favicon.svg                      | public/favicon.svg                      | match  |
| colours in public/favicon.svg                              | #07111f, #3185ff, #e7f2ff               | #07111f, #3185ff, #e7f2ff               | match  |
| `--surface-0` (occ.css `:root`)                            | #07111f                                 | #07111f                                 | match  |
| `--surface-1` (occ.css `:root`)                            | #0d1c2d                                 | #0d1c2d                                 | match  |
| `--border-subtle` (occ.css `:root`)                        | #1e3550                                 | #1e3550                                 | match  |
| `--border-strong` (occ.css `:root`)                        | #5a7488                                 | #5a7488                                 | match  |
| `--text-primary` (occ.css `:root`)                         | #e7f2ff                                 | #e7f2ff                                 | match  |
| `--text-secondary` (occ.css `:root`)                       | #a6b8c5                                 | #a6b8c5                                 | match  |
| `--text-tertiary` (occ.css `:root`)                        | #91a5b4                                 | #91a5b4                                 | match  |
| `--accent` (occ.css `:root`)                               | #3185ff                                 | #3185ff                                 | match  |
| `--accent-hover` (occ.css `:root`)                         | #4f96ff                                 | #4f96ff                                 | match  |
| `--accent-tint` (occ.css `:root`)                          | rgb(49 133 255 / 0.14)                  | rgb(49 133 255 / 0.14)                  | match  |
| `--on-accent` (occ.css `:root`)                            | #07111f                                 | #07111f                                 | match  |
| `--danger` (occ.css `:root`)                               | #ff8a7a                                 | #ff8a7a                                 | match  |
| `--warning` (occ.css `:root`)                              | #e2be7a                                 | #e2be7a                                 | match  |
| `--success` (occ.css `:root`)                              | #35e0a1                                 | #35e0a1                                 | match  |
| `--shadow-3` (occ.css `:root`)                             | 0 20px 48px rgb(0 0 0 / 0.6)            | 0 20px 48px rgb(0 0 0 / 0.6)            | match  |
| `--radius-m` (occ.css `:root`)                             | 8px                                     | 8px                                     | match  |
| `--radius-l` (occ.css `:root`)                             | 12px                                    | 12px                                    | match  |
| `--font-ui` (occ.css `:root`)                              | 'Inter Variable', system-ui, sans-serif | 'Inter Variable', system-ui, sans-serif | match  |
| `--font-body` (occ.css `:root`)                            | 'Inter Variable', system-ui, sans-serif | 'Inter Variable', system-ui, sans-serif | match  |
| `--focus-ring` (occ.css `:root`)                           | 2px solid var(--accent)                 | 2px solid var(--accent)                 | match  |
| `--focus-offset` (occ.css `:root`)                         | 2px                                     | 2px                                     | match  |
| the card, `--surface-1` at 96 % (occ.css)                  | rgb(13 28 45 / 0.96)                    | rgb(13 28 45 / 0.96)                    | match  |
| the shade, `--surface-0` at 55 % (occ.css)                 | rgb(7 17 31 / 0.55)                     | rgb(7 17 31 / 0.55)                     | match  |
| colours of the mark in template.ftl                        | #1a3250, #3185ff, #e7f2ff               | #1a3250, #3185ff, #e7f2ff               | match  |
| `public/sign-in-backdrop.webp` (sha-256)                   | 628e3acbfdac                            | 628e3acbfdac                            | match  |
| the poster the backdrop colours were measured on (sha-256) | 628e3acbfdac                            | 628e3acbfdac                            | match  |
| the loop the backdrop colours were measured on (sha-256)   | a972581496aa                            | a972581496aa                            | match  |

<!-- contrast:end -->
