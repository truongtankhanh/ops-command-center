# Console icons

One glyph per domain value, drawn the same way everywhere in the console. The icon set was chosen in the
[design brief](brief.md#decisions) (UI-01) and wired in UI-04; the icon map is on frame 00 of the mockups.

## The set

**Lucide** through `lucide-react` (1.52.0, **ISC** licence). Chosen because it tree-shakes per glyph, draws every
glyph on one 24 px grid with a 2 px stroke, and covers every value below. Only the glyphs the console imports reach
the bundle.

The set stays swappable: `apps/console/src/ui/icons.ts` is the **only** file allowed to import `lucide-react` (ESLint
`no-restricted-imports` in `apps/console/eslint.config.mjs`). Everything else imports glyphs from there and uses the
local `Glyph` type, so replacing the set means rewriting that one file.

## Icon map

Every domain map is a `Record` over its union, so adding a value to `@occ/contracts` (or to the store's
`ConnectionState`) fails `typecheck` until it has a glyph.

**Unknown values (V2-03.2).** A newer API can send an incident type, category or zone kind that this console's
contract lacks (ADR-0021, rolling deploys). `incidentTypeIcon`, `categoryIcon` and `zoneKindIcon` then return
`unknownIcon` (`CircleQuestionMark`) instead of `undefined`, which `Icon` cannot draw. Next to the glyph, the label
shows the raw id (`typeLabel`). `unknownIcon` has one meaning, "a value this console does not know": it is never the
glyph of a known value, and nothing else uses it. It is the one deliberate exception to "one glyph per domain value".
`severityIcon`, `statusIcon`, `eventKindIcon` and `actorKindIcon` have no fallback, because no planned contract change
widens those unions.

| Accessor                         | Value                                                                                                    | Glyph                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `severityIcon`                   | `critical` / `high` / `medium` / `low`                                                                   | `OctagonAlert` / `TriangleAlert` / `CircleAlert` / `Info`                                                       |
| `incidentTypeIcon` (security)    | `intrusion` / `crowding` / `suspicious_object` / `theft` / `vandalism` / `suspicious_person` / `assault` | `DoorOpen` / `Users` / `Package` / `HandGrab` / `SprayCan` / `UserRoundSearch` / `HandFist`                     |
| `incidentTypeIcon` (fire_safety) | `fire_alarm` / `fire` / `gas_leak` / `hazmat_spill`                                                      | `Flame` / `FlameKindling` / `Cylinder` / `Biohazard`                                                            |
| `incidentTypeIcon` (medical)     | `medical` / `injury`                                                                                     | `HeartPulse` / `Cross`                                                                                          |
| `incidentTypeIcon` (facilities)  | `equipment_fault` / `power_outage` / `water_leak` / `lift_entrapment` / `hvac_fault` / `network_outage`  | `Wrench` / `Zap` / `Droplet` / `ArrowUpDown` / `Fan` / `ServerOff`                                              |
| `incidentTypeIcon` (environment) | `severe_weather` / `flooding` / `fallen_tree`                                                            | `Tornado` / `WavesArrowUp` / `TreeDeciduous`                                                                    |
| `incidentTypeIcon` (traffic)     | `traffic_accident` / `blocked_access`                                                                    | `CarFront` / `Ban`                                                                                              |
| `categoryIcon`                   | `security` / `fire_safety` / `medical` / `facilities` / `environment` / `traffic`                        | `ShieldUser` / `FireExtinguisher` / `Stethoscope` / `HardHat` / `CloudLightning` / `Car` (never a type's glyph) |
| `statusIcon`                     | `open` / `acknowledged` / `resolved`                                                                     | `CircleDot` / `UserCheck` / `CircleCheck`                                                                       |
| `eventKindIcon`                  | `reported` / `acknowledged` / `resolved`                                                                 | `Flag` / `UserCheck` / `CircleCheck` (same meaning as the status, same glyph)                                   |
| `zoneKindIcon`                   | `building` / `parking` / `gate` / `outdoor` / `sports` / `utility` / `water`                             | `Building2` / `SquareParking` / `Fence` / `Trees` / `Volleyball` / `UtilityPole` / `WavesHorizontal`            |
| `actorKindIcon`                  | `user` / `system`                                                                                        | `User` / `Cpu`                                                                                                  |
| `connectionIcon`                 | `live` / `connecting` / `reconnecting` / `offline`                                                       | `Radio` / `RefreshCw` / `RefreshCw` / `WifiOff` (`connecting` is the first connect only)                        |
| `cameraIcon`                     | `online: true` / `false`                                                                                 | `Video` / `VideoOff`                                                                                            |
| `unknownIcon`                    | fallback of `incidentTypeIcon` / `categoryIcon` / `zoneKindIcon` for a value outside the contract        | `CircleQuestionMark` (never a known value's glyph)                                                              |

Generic UI glyphs, re-exported by name from `icons.ts`: `Plus`, `X`, `Search`, `Eye`, `Lock`, `Clock`, `Volume2`,
`ChevronDown`, `LogOut`, for the map controls (frame 01) `Minus` (zoom out) and `Scan` (fit campus, the frame's
`#i-fit`), `Info` for hints (`Hint`, frames 02 / 03; the same glyph as severity `low`, always next to text) and for
the technician's out-of-scope footer on the incident sheet (frame 11, V2-03.7; the viewer's footer keeps `Eye`),
for the report form (frame 03, UI-12) `MapPin` (the "Pick on map" toggle and the pin hint), `Crosshair` (the map hint
while picking) and `Check` (the success toast; not `CircleCheck`, which means "resolved"), and for the camera
tiles and viewer (frame 01, UI-13) `Maximize2` (open a camera in the viewer, the frame's `#i-expand`), `Maximize` (the
viewer's Fullscreen button), `Pin` / `PinOff` (pin a camera to the strip / unpin it, and the pinned badge), and for
the loading, error and session states (frames 05, 07–11, UI-15) `CircleX` (anything that could not be loaded or
stopped working, and the failed sign-in), `Shield` (no access: the account has no role), `Lock` (insecure context, and
the session-expired banner) and `LoaderCircle` (the signing-in / signing-out spinner). Frame 09 draws the failed
sign-in with a circled "!", which is `CircleAlert`, the `medium` severity glyph; `CircleX` replaces it so that glyph
keeps one meaning. For the keyboard shortcuts (UI-16) `Keyboard` marks the single-key shortcuts switch in the account
menu; the menu's "Keyboard shortcuts" entry uses `Info`, so the two rows do not repeat a glyph. `Rows3` (UI-17) marks
the account menu's "Compact layout" switch (density).

For the digital twin (V2, [brief](v2/brief.md) § What changes; frames 00, 02–17), re-exported in V2-02.2 for the
twin tickets to wire: `Activity`, `Pause`, `Fan`, `Thermometer` and `Zap` for asset states and readings (Running,
Standby, Fan speed, the temperatures, Mains supply), `RotateCcw` / `RotateCw` and `House` for the 3D view's Rotate
left / Rotate right and Reset view, `MapIcon` for the 2D view (Lucide's alias of `Map`, so it does not shadow the
global `Map`), and `Box` for an asset drawn without a 3D model (frame 15). `Zap` and `Fan` are also the glyphs of
`power_outage` and `hvac_fault` ([below](#v2-values-frame-deviations-and-choices-v2-022)) with the same meaning —
electric supply, air handling — as `connecting` and `reconnecting` share theirs. The frames give `Activity` (Running,
Vibration, the Telemetry source), `Pause` (Standby, Telemetry paused) and `Box` (no model, isolated, see-through) more
than one meaning; that is settled when they are wired, not here.

`medium` and `low` share the circle and differ only by the inner mark. Severity always comes with its label (brief,
principle 2), so this is accepted. Rechecked in UI-16: still true everywhere in the DOM. The one place without a
label is the map's cluster badge (10 px, below), where `medium` / `low` are told apart by the inner mark and the
severity colour; the cluster's tooltip names the severity and the feed lists every incident.

### V2 values: frame deviations and choices (V2-02.2)

[ADR-0021](../adr/0021-incident-categories-zone-uses-and-technician-role.md) added 18 incident types, six categories
and three zone kinds. Their glyphs were decided in V2-02.2 and wired in V2-03.1, which added the values to
`@occ/contracts`, the `categoryIcon` accessor and the rows of the table above. The six V1 types and the four V1 zone
kinds kept their glyphs. This section keeps the reasons.

Where the frames differ (they are listed in the brief's
[Frames to revise after Phase 0](v2/brief.md#frames-to-revise-after-phase-0)):

- Frame 09 draws `network_outage` with `WifiOff`, the `offline` connection glyph; `ServerOff` replaces it so that a
  campus network incident never reads as "this console is offline".
- Frames 00, 09 and 11 draw the Security category with `Shield`, the "no access" glyph (UI-15); `ShieldUser` replaces
  it. Frame 11 is the screen where a technician may not act, where a plain shield would read as "no access".
- Frames 00 and 09 draw Fire & safety, Medical and Facilities with the glyphs of `fire_alarm`, `medical` and
  `equipment_fault` (`Flame`, `HeartPulse`, `Wrench`); `FireExtinguisher`, `Stethoscope` and `HardHat` replace them.
  The incident sheet shows the type chip next to the category chip (frame 11), so a shared glyph would show twice. A
  category glyph is never a type glyph.

No frame draws `theft`, `vandalism`, `suspicious_person`, `assault`, `fire`, `gas_leak`, `hazmat_spill`,
`severe_weather`, `flooding`, `fallen_tree`, `traffic_accident` or the zone kinds `sports`, `utility`, `water`; their
glyphs were chosen in V2-02.2 and signed off in its PR. Close neighbours kept apart on purpose: `fire` / `fire_alarm`
(`FlameKindling` / `Flame`); `severe_weather` / the Environment category (`Tornado` / `CloudLightning`); `flooding` /
zone kind `water` (`WavesArrowUp`, rising water / `WavesHorizontal`, a body of water); `fallen_tree` / zone kind
`outdoor` (`TreeDeciduous` / `Trees`); `traffic_accident` / the Traffic category (`CarFront` / `Car`);
`suspicious_person` / actor `user` (`UserRoundSearch` / `User`). `WavesHorizontal` is the name in `lucide-react`
1.52.0; `Waves` is only its old alias.

## Using `Icon`

```tsx
import { Icon } from '../ui/Icon';
import { severityIcon, X } from '../ui/icons';
```

Next to text, decorative:

```tsx
<span className={styles.badge} data-severity={incident.severity}>
  <Icon glyph={severityIcon(incident.severity)} size={16} />
  {severityLabel}
</span>
```

Standing alone, labelled:

```tsx
<button type="button" className={styles.close} onClick={close}>
  <Icon glyph={X} label="Close" />
</button>
```

- **Size:** `14 | 16 | 18 | 20 | 22`, default 18 — the sizes the mockups use, at laptop scale. They are component
  dimensions, so they stay numbers (see [tokens.md](tokens.md#what-may-stay-a-raw-value)); `Icon` passes the size as
  `data-size` and `Icon.module.css` draws it times `--ui-scale`, so icons grow with the text on a wall display
  (UI-17). Map glyphs are canvas images and do not scale (below).
- **Colour:** always `currentColor`. Set `color` in the parent's CSS Module with a token (`var(--sev)`,
  `var(--text-secondary)`, `var(--accent)` …). There is no colour prop, so no raw hex can enter through it.
- **Stroke:** fixed at 2, as in the mockups.
- **Accessibility contract:**
  - No `label` → decorative: Lucide sets `aria-hidden="true"`. Use this whenever the icon sits next to text that
    already says the same thing.
  - `label` → `role="img"` + `aria-label`. Use this when the icon stands alone. An empty `label` counts as no label.
  - There is no `title` prop on purpose: Lucide treats `title` as a label and would drop `aria-hidden`.
  - An icon-only **button** still needs its own accessible name; labelling the `Icon` inside it is enough, or put
    `aria-label` on the button and leave the icon decorative — not both.
- `Icon` sets `flex: none`, so a glyph keeps its size in a flex row.

## Adding a glyph

1. Import it from `lucide-react` in `apps/console/src/ui/icons.ts` (the only place the lint rule allows).
2. Either add it to the right domain map, or add it to the generic re-export line at the bottom.
3. Update the table above. If it maps a new domain value, the compiler already forced step 2.

## Map glyphs

MapLibre cannot render React components, and the offline map style has no sprite or `glyphs` URL, so map icons are
registered as images with `map.addImage()`. They use the **same `Glyph` components** — no second icon pipeline. Built
in UI-08: `apps/console/src/lib/mapImages.ts`, ids in `lib/mapFeatures.ts`, layers in `lib/mapLayers.ts`.

1. **One pre-composed image per marker form.** Disc (or camera square) and glyph are drawn together, so a single
   `symbol` layer orders overlapping markers with `symbol-sort-key`, and the glyph keeps its exact colour at 12–14 px.
   The SDF route planned here before UI-08 (a `circle` layer for the disc plus recoloured glyphs) was dropped: across
   two layers, a lower marker's glyph is drawn over a higher marker's disc where they overlap.
2. **Forms and ids.** `incident-{severity}-{open|acknowledged}-{type}` (192), `incident-resolved-{type}` (24), the same
   9 forms for a type outside the contract (`incident-{severity}-{open|acknowledged}-unknown`,
   `incident-resolved-unknown`, drawn with `unknownIcon`, V2-03.2), `camera-online` / `camera-offline`,
   `cluster-severity-{severity}` (4, UI-16) — 231 images. `incidentImageId` maps any type that is not in
   `INCIDENT_TYPES` to the `unknown` suffix (`markerType` in `lib/mapFeatures.ts`; a unit test keeps `unknown` out of
   the contract). The unknown-type forms are registered up front with all the others, not on `styleimagemissing`
   (item 6): that event needs the image added synchronously, and glyph images decode asynchronously (item 4). The
   cluster badge is a 16 px box: a severity disc (r 7, 1.5 px ground edge) with the severity glyph at 10 px in
   `--on-accent`, drawn on the cluster's ring at its top-right by its own `symbol` layer, so a cluster's highest
   severity is not told by the ring colour alone (WCAG 1.4.1). Geometry follows frames 01, 02 and 04 (`.mk-*`,
   `.pl-cam`): open = severity disc with an `--on-accent` glyph, acknowledged = ground disc in a severity ring with a
   severity glyph, resolved = the ring form in `--text-tertiary`; glyphs stroked at 2.6 (cameras 2.4).
3. **SVG markup from the component.** One `createRoot` on a detached element renders each glyph with `flushSync`
   and `createElement(glyph, { size, color, strokeWidth })`; its `innerHTML` is the markup, and the root is unmounted
   at the end. Done in the map's `load` handler, never during render or in a layout effect (`flushSync` warns there).
4. **Raster and register.** The composed SVG → data URL → `HTMLImageElement` at `Math.ceil(devicePixelRatio)`,
   awaited with `decode()`, then `addImage(id, image, { pixelRatio })`. All images are registered **before** the
   layers are added (an image that arrives after its layer is missing from tiles already laid out). The registration
   takes an `AbortSignal`, so nothing is added to a map removed while images decode.
5. **Colour.** Literal copies in `apps/console/src/styles/tokens.ts` (`mapColors`), because neither MapLibre nor an
   SVG data URL can read CSS custom properties; `scripts/contrast.ts --check` fails when a copy drifts from
   `tokens.css`, and checks `--on-accent` on each severity disc (3:1).
6. **Cluster counts** (`cluster-count-1` … `cluster-count-9+`) are drawn on a canvas on demand, from the map's
   `styleimagemissing` event, which needs the image added synchronously. Their font is loaded before the map is
   ready. It is a literal copy of `--weight-semibold`, `--type-s` and `--font-ui`, which the contrast script does not
   check.

Rejected routes:

- Lucide's per-icon data (`__iconData`): exists only in the package's internal modules, not in its public exports —
  private API that can change in any release.
- `react-dom/server` `renderToStaticMarkup`: would add the server renderer to the client bundle for a few strings.
- A second package (`lucide`, `lucide-static`): a second dependency, kept in version step by hand, for the same
  glyphs.
