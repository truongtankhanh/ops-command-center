# Console V3 — premium operations UI over a realistic twin: design brief

Status: **proposed** as a design until V3-20 (frames 00 – 25 accepted by the tech lead on 2026-10-22); its decisions are **accepted in ADR-0022** (2026-10-22), and the V3.5 data decisions in ADR-0023, ADR-0024 and ADR-0031. Every open question was answered by the tech lead on 2026-10-21 (Q1, Q3, Q4, Q6 and both
principle amendments first, then Q2, Q5, Q7 – Q11 by accepting the recommendations); ADR-0022 and the ADR-0020
amendment still have to record them (V3-00, V3-11). Mockups: [Ops Console V3 — Premium Digital Twin](https://claude.ai/artifact/BtgcJCPfsoqLp2fZJchGfy)
(design canvas, private until shared from its Share menu); source of every frame in [mockups/](mockups/) —
`Main.dc.html` is frame 00, the rest are numbered like the frames, `Scene`, `Map2D`, `Header`, `Sidebar`, `Strip` and
`StatusBar` are the shared components, `v3.css` holds the tokens. As in V1 and V2 they render on the canvas only (they load
its `support.js` runtime). Sources:

- [IoT_Digital_Twin_UI_Design_Direction.pdf](IoT_Digital_Twin_UI_Design_Direction.pdf): the direction (four pages:
  creative direction, palette, neon rules, dashboard composition, realistic twin, incident-first behaviour, inspector,
  type and components, do / don't).
- [../../images/image.png](../../images/image.png): the concept render the direction was drawn from. It is **art, not a
  spec**: where it shows data or behaviour the product does not have, [§ Concept render vs the product](#concept-render-vs-the-product)
  says so.

V3 is a **visual and interaction upgrade of the V2 console**. It keeps the journey (KPI bar, incident queue, 3D campus,
camera strip, inspector on demand) and changes hierarchy, surfaces, light and the way an incident is followed in the
scene. It builds on [V1](../brief.md) and [V2](../v2/brief.md); everything they decided still holds unless this
document says otherwise.

## The idea in one paragraph

A premium dark operations UI laid over a campus that looks like a working miniature smart city. Three layers: a
**realistic 3D campus** (architecture, roofs, glass, trees, roads, depth of light), a **premium operations UI**
(midnight surfaces, thin borders, clear type, room to breathe) and **electric neon signals** used on purpose (cyan,
blue and violet for interaction and data; red, orange and yellow for severity). Not cyberpunk: 3D feels real, the UI
feels premium, neon feels electric. Colour budget: about 70 % neutral dark, 20 % the model's own surfaces and light,
at most 10 % accent.

## Requirements and how V3 meets them

| #   | Requirement (PDF section)                                                            | Decision                                                                                                                                                             | Frame      |
| --- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| R1  | Midnight / panel / neon palette, 70 / 20 / 10 (02)                                   | The direction's palette as tokens; interaction in blue and violet, live data in `--signal` cyan, severity in red, orange and yellow ([Colour](#colour), Q1)          | 00         |
| R2  | Neon only where it means something (03, 09)                                          | A short list of neon uses, everything else flat ([Neon rules](#neon-rules))                                                                                          | 00         |
| R3  | Keep the dashboard structure, redesign the hierarchy (04)                            | Same five regions, new sizes: header 64–72, sidebar 320–360, camera strip 150–190 collapsible, inspector 320–360 overlay ([Layout](#layout))                         | 01         |
| R4  | A realistic campus: materials, light, depth, no red building for one bad sensor (05) | Environment kit and lighting on raised scene budgets, set by measurement in V3-11; severity stays on the marker and the zone ([Realistic twin](#realistic-twin), Q3) | 01, 06     |
| R5  | Zoom shows more or less: campus counts → building markers → single devices (05)      | Three distance tiers with clustering ([Semantic zoom](#semantic-zoom))                                                                                               | 06         |
| R6  | Incident-first flow: new, select, focus, inspect, act (06)                           | Selecting an incident flies the camera and spotlights its marker; opening never changes status ([Incident-first behaviour](#incident-first-behaviour), Q4)           | 02, 05     |
| R7  | Inspector with Details, Related, Telemetry, Timeline (07)                            | One tabbed inspector for incidents and assets ([Inspector](#inspector), Q5)                                                                                          | 02, 03, 04 |
| R8  | Inter or Geist, 36–40 px buttons, 8–12 px radius, 1 px borders (08)                  | One family swap and a re-cut scale ([Type and components](#type-and-components), Q6)                                                                                 | 00         |
| R9  | Never colour as the only signal (09)                                                 | Already V1 principle 2; carried to every new element                                                                                                                 | all        |

## What changes, what stays

| Area                          | V3                                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roles, permissions, view-only | **Unchanged.** Every new action follows V2's "Viewer in V2" rule: a hidden action never leaves a hole; the API's `403` stays the real control.                                              |
| Data, API, contracts          | **Unchanged** for the visual work. Three data tracks (device classes, assignment, light theme) are separate: only the device classes (V3-A) are scheduled (Q7 – Q9).                        |
| Tokens                        | New palette and elevation set. Severity keeps red, orange and yellow; Low loses cyan and becomes neutral (Q1). The token files, the drift check and the contrast script stay the mechanism. |
| Header                        | Re-cut: brand and site name, KPI tiles by severity, `Live` and `Telemetry` pills, clock, Report incident, account. 64–72 px.                                                                |
| Incident sidebar              | Same two tabs (Incidents, Assets); richer row; search, All / Open / Resolved with counts.                                                                                                   |
| Stage                         | 3D by default as in V2. Chrome regrouped: one top bar (view switch + layers), a camera tool rail, scale and compass; nothing over the centre.                                               |
| Camera strip                  | Gets a header row (title, count, All / Live / Offline, View all) and **collapses** so the stage can grow.                                                                                   |
| Inspector                     | Overlay on the right, 360 px, four tabs. The V2 incident sheet and asset inspector become two contents of one frame.                                                                        |
| Status bar                    | **New**, 32 px at the foot: system health in words and connection states ([Status bar](#status-bar), Q8).                                                                                   |
| 3D scene                      | Realistic environment kit, cool lighting with shadow and baked depth, holographic markers, incident spotlight, semantic zoom. V2's R5 (no shadows) and its scene budgets are amended.       |
| Sign-in, video wall, 2D map   | Re-skinned from the same tokens (V3-19); the sign-in backdrop is re-rendered from the new scene. No behaviour change.                                                                       |

## Principles

V1's seven and V2's five still apply, with two amendments (**decided 2026-10-21**, tech lead):

1. **Principle V1-1, "severity is the only loud colour", becomes "severity is the only loud _meaning_".** Interaction
   and live data may glow, thinly and on purpose (Neon rules), but a glow never stands for severity and severity never
   borrows the accent. The 3D model's own materials are allowed to be realistic: they are the 20 % and stay cool and
   desaturated.
2. **Principle V2-4, "the view never moves on its own", becomes "the view moves only because the operator asked".**
   Asking is: selecting an incident or asset, `F`, `Home`, a toast's "Fly to". A new incident arriving never moves the
   camera (the video wall's exception stays as V2 wrote it).

And three new ones:

3. **Neon is edge and signal, not fill.** A 1 px lit edge on the active tab, the selected button, the open panel, the
   connection line to the selected marker; a halo on a marker. Never a glow on every card or border.
4. **The model leads, the UI supports.** Panels never cover the centre of the stage; chrome is compact and sits at the
   edges. If the model and a panel compete for the same pixels, the panel yields.
5. **Realism has a measured budget.** V3 raises V2's scene budgets (Realistic twin) to what the look needs; V3-11
   sets the new numbers by measuring. A machine that cannot hold the frame time at the full look runs a lower tier
   (Quality tiers), never a stuttering one.

## Colour

### Palette from the direction

| Role            | Direction  | Token                        | Use                                                                           |
| --------------- | ---------- | ---------------------------- | ----------------------------------------------------------------------------- |
| Midnight        | `#07111F`  | `--surface-0`                | Ground, stage, inputs                                                         |
| Panel           | `#0D1C2D`  | `--surface-1`                | Header, sidebar, inspector, status bar                                        |
| (derived)       | to compute | `--surface-2`, `--surface-3` | Cards, selected row; menu, toast. Same lightness steps as today's four levels |
| Electric blue   | `#3185FF`  | `--accent`                   | Primary button, focus, selection (replaces periwinkle `#8c9bff`)              |
| Electric violet | `#8B7CFF`  | `--accent-2`                 | Secondary data series, hover tint                                             |
| Neon cyan       | `#35E7FF`  | `--signal`                   | Live data: telemetry lines, healthy device marker, Live pill                  |
| Critical red    | `#FF426D`  | `--sev-critical`             | Critical only                                                                 |
| Warning amber   | `#FFAD42`  | `--sev-high`                 | High only (the direction calls it warning)                                    |
| Yellow          | `#f2d04b`  | `--sev-medium`               | Medium only; the direction names yellow but no value, today's stays           |
| Neutral steel   | to compute | `--sev-low`                  | Low only: no hue, icon and text carry it (see below)                          |
| Healthy green   | `#35E0A1`  | `--success`                  | System feedback, never an incident                                            |
| Primary text    | `#E7F2FF`  | `--text-primary`             | —                                                                             |

**Decided 2026-10-21 (Q1): the palette follows the direction.** The direction gives cyan, blue and violet to
interaction and data and gives severity red, orange and yellow only. So V1's reason for periwinkle (cyan was
`--sev-low`) is gone by construction: **Low stops being cyan** and becomes a neutral steel tone with its icon and text
(V1 principle 2 already forbids colour alone), which also fits "Low is the quietest". The concept render draws Low in
blue; the direction's text governs, because blue is now the interaction accent.

V3-02 computes every pair with `scripts/contrast.ts` and **adjusts a value (not the rule) where a pair fails**: dark
text on the blue button, today's `--sev-critical` that is icon-only on `surface-3`. Two checks it must make: the new
`--sev-high` amber and the existing `--warning` (`#f0b85e`, system feedback) are nearly the same hue, so `--warning`
moves or the two are told apart by shape; and the favicon follows the new accent (`theme-color` is a copy of `--surface-1`, not of the accent, so it follows the
new surface).

**What a colour change touches (checked against the code on 2026-10-22).** `pnpm lint` runs `scripts/contrast.ts --check`, which
compares the copies of the accent and the severity colours, so changing `tokens.css` alone fails lint until every copy moves in
the same change: `styles/tokens.ts` (`mapColors.accent` and a favicon string), `public/favicon.svg` (its accent dot),
the Keycloak theme (`ops/keycloak/themes/occ/login/resources/css/occ.css`, three tokens, and the mark in `template.ftl`) and the
drift tables of `docs/design/tokens.md`. The theme's token copies are therefore part of V3-02; its picture and layout stay in V3-19.
V3-02 must also check:

- **`--sev-low` readers.** `ui/SeverityBadge.module.css`, `styles/base.css` (`[data-severity='low']`, read by the KPI tile, the feed
  rows, the map markers and the report form), `components/incidents/IncidentRow.module.css`, `components/assets/AssetRow.module.css`,
  `styles/tokens.ts` (`severity.low`) and `scripts/contrast.ts`; the map legend and markers take it through `mapColors`.
- **`--warning` against the new `--sev-high`** (hue 37° against 34°) and **`--danger` against the new `--sev-critical`** (355°
  against 346°): V1's rule "system feedback never on an incident" now rests on a few degrees of hue, so they move, or shape tells
  them apart.
- **A neutral Low against the neutral status tokens** (`--status-open` is `--text-primary`, `--status-acknowledged` is
  `--text-secondary`).
- **The accent as text on the lighter surfaces:** `#3185FF` is 5.35 on `#07111F` and 4.86 on `#0D1C2D`, white on it is 3.54, so the
  primary button's label stays dark and accent text uses `--accent-ink`.
- **The heat ramp is indigo today** (`--heat-0 … --heat-5`, `#1f2a4d` to `#b3bdff`); it follows the blue accent, and V2's rule
  (never red, orange, yellow or cyan) stays.

### V3 values (settled in V3-02.1)

**Settled 2026-10-26** (proposal for the tech lead's sign-off; nothing is written to `tokens.css` yet, that is V3-02.2).
Every ratio below was computed with the WCAG 2.x formula of `scripts/contrast.ts`, and the whole set was run through a
copy of that script with these values in a scratch `tokens.css`: no pair failed except the ones the split below changes
on purpose. All nine hexes of the direction are kept as they are; only the tokens the direction does not name are chosen
here. Columns are the ratio on `--surface-0` / `-1` / `-2` / `-3`.

| Token                       | Value                     | 0     | 1     | 2     | 3     | Rule                                                                                |
| --------------------------- | ------------------------- | ----- | ----- | ----- | ----- | ----------------------------------------------------------------------------------- |
| `--surface-0`               | `#07111F`                 |       |       |       |       | Direction. Ground, stage, inputs                                                    |
| `--surface-1`               | `#0D1C2D`                 |       |       |       |       | Direction. Header, sidebar, inspector, status bar                                   |
| `--surface-2`               | `#12263B`                 |       |       |       |       | Cards, selected row. Steps 1.10 / 1.12 / 1.18 (V2: 1.11 / 1.14 / 1.17)              |
| `--surface-3`               | `#1A3250`                 |       |       |       |       | Menu, toast, banner                                                                 |
| `--text-primary`            | `#E7F2FF`                 | 16.72 | 15.19 | 13.05 | 11.03 | Direction                                                                           |
| `--text-secondary`          | `#a6b8c5` (unchanged)     | 9.27  | 8.42  | 7.53  | 6.36  |                                                                                     |
| `--text-tertiary`           | `#91a5b4` (unchanged)     | 7.43  | 6.75  | 6.04  | 5.10  |                                                                                     |
| `--accent`                  | `#3185FF`                 | 5.35  | 4.86  | 4.34  | 3.67  | **Fill, graphics and the focus ring (3:1), never text**                             |
| `--accent-ink` (new)        | `#5E9FFF`                 | 7.10  | 6.45  | 5.77  | 4.88  | **Accent as text or a glyph that must read as text** (4.5:1 on all four)            |
| `--accent-hover`            | `#4F96FF`                 | 6.44  | 5.85  | 5.23  | 4.42  | Hover fill only                                                                     |
| `--accent-tint`             | `rgb(49 133 255 / 0.14)`  |       |       |       |       | `--text-primary` on it 12.64, `--accent-ink` 5.37 (on `-1`) and 4.78 (on `-2`)      |
| `--on-accent`               | `#07111F`                 |       |       |       |       | 5.35 on `--accent`, 6.44 on hover; white would be 3.54, so the label stays dark     |
| `--accent-2`                | `#8B7CFF`                 | 5.79  | 5.26  | 4.70  | 3.98  | **Graphics only** (series, hover tint, 3:1); never text, it falls under 4.5 on `-3` |
| `--signal`                  | `#35E7FF`                 | 12.65 | 11.49 | 10.27 | 8.68  | Direction. Text-capable                                                             |
| `--sev-critical`            | `#FF426D`                 | 5.64  | 5.12  | 4.58  | 3.87  | Direction. Icon only on `-3`, as today                                              |
| `--sev-high`                | `#FFAD42`                 | 10.20 | 9.26  | 8.28  | 7.00  | Direction                                                                           |
| `--sev-medium`              | `#f2d04b` (unchanged)     | 12.53 | 11.38 | 10.17 | 8.60  |                                                                                     |
| `--sev-low` (neutral steel) | `#87A2C4`                 | 7.21  | 6.55  | 5.85  | 4.95  | See "Low" below                                                                     |
| `--success`                 | `#35E0A1`                 | 11.12 | 10.10 | 9.02  | 7.63  | Direction. System feedback                                                          |
| `--warning`                 | `#E2BE7A` (was `#f0b85e`) | 10.71 | 9.73  | 8.70  | 7.35  | System feedback. See "Warning and danger"                                           |
| `--danger`                  | `#FF8A7A` (was `#ff7f8a`) | 8.27  | 7.51  | 6.71  | 5.67  | System feedback. See "Warning and danger"                                           |
| `--status-resolved`         | `#86bba0` (unchanged)     | 8.68  | 7.89  | 7.05  | 5.96  |                                                                                     |
| `--border-strong`           | `#5a7488` (unchanged)     | 3.87  | 3.51  |       |       | Input boundary, 3:1 on `-0` and `-1` only (the rule in `tokens.md`)                 |
| `--border-subtle`           | `#1E3550`                 | 1.52  | 1.38  | 1.23  | 1.04  | Decorative hairline; carries no meaning                                             |
| `--camera-ground`           | `#050D18`                 |       |       |       |       | A little darker than the ground (V2: `#070f15`)                                     |
| `--camera-off-a` / `-b`     | `#08121D` / `#0A1624`     |       |       |       |       | Stripes of a camera frame with no picture                                           |

The `--sev-*-bg` (15 %), `-border` (45 %) and `--sev-critical-hot-*` (18 % on `--surface-1`) derivations keep their
rule and are recomputed from the new hues. Measured over `--surface-1`: `--text-primary` on the Low tint 11.84,
`--sev-low` on it 5.10, `--warning` on the Low, Medium, High and Critical tints 7.59 / 6.93 / 7.30 / 8.41.

**Accent: fill and ink (open question 2, decided here).** `#3185FF` is the direction's colour, so it stays the fill, the
graphic and the focus ring (3:1 holds on all four surfaces, lowest 3.67). Anything that reads as text uses `--accent-ink`.
This changes one rule of `scripts/contrast.ts`: `--accent` is today checked at 4.5:1 as text on all four surfaces and
fails on `-2` (4.34) and `-3` (3.67). V3-02.2 moves that pair to `--accent-ink` (4.5:1) and checks `--accent` at 3:1.
V3-02.4 finds the places that use `--accent` as text (52 lines in 23 files at `0133d6d`).

**Low.** `#87A2C4` is 213° / 31 % saturation. `--text-tertiary` is 206° / 19 % at about the same lightness, so **hue does
not tell Low from a quiet label, and is not asked to**: a Low item carries the info glyph, the word "Low" and its place
in the severity order; its tile has a 15 % tint and a 45 % border, which a status chip (no tint, no severity glyph) has
not. `--status-open` (`--text-primary`) and `--status-acknowledged` (`--text-secondary`) stay neutral as they are.

**Warning and danger (resolved in writing).** Hue cannot separate them from the severities: `--warning` is 39° against
`--sev-high` 34° and `--sev-medium` 48°, and no amber is both clear of High and clear of Medium. So `--warning` is
desaturated (46 % against High's 74 %), and the V1 rule is enforced by place and glyph: system feedback sits on chrome
(banner, pill, hint, form error) with the triangle glyph and never on the same element as a severity. `--danger` does
move: 7° (a warm coral) against `--sev-critical` 346° and `--sev-high` 34°, a gap of 21° and 27° (it was 9° from
the new critical). Not measurable here: whether an operator tells the new `--warning` from High at 1–2 m. The operations lead
looks at frame 00 before V3-02.2 merges (`unverified`).
**Found while checking:** `scripts/contrast.ts` already pairs `--warning` with every `--sev-*-bg` ("a late age" on a
feed row), so today a warning-coloured age sits on an incident row, against V1's rule. V3-02.4 should change that age to
`--text-secondary` with a clock glyph (recommendation; the tech lead decides).

**Heat ramp (open question 1, decided here): retuned to the accent's hue, V2's rule stays.**

| `--heat-0` | `--heat-1` | `--heat-2` | `--heat-3` | `--heat-4` | `--heat-5` |
| ---------- | ---------- | ---------- | ---------- | ---------- | ---------- |
| `#132B50`  | `#1C3D6F`  | `#22539C`  | `#266CD5`  | `#5292F2`  | `#9BC3FF`  |

Hue 216° (the accent's), 29° from `--signal` cyan and 31° from `--accent-2` violet, never red, orange, yellow or cyan.
The luminance of each stop is V2's, so the steps are 1.31 / 1.43 / 1.50 / 1.61 / 1.72 (V2: 1.30 to 1.73). **Open
check for V3-12 / V3-16:** a selection edge in `--accent` against the mid stops is only 1.1 to 2.1:1 (`--heat-2` 2.13,
`--heat-3` 1.42, `--heat-4` 1.14), so a selected part under the overlay needs a second keyline (`--surface-0`) or it
vanishes; V2's ramp had the same weakness and no rule for it.

**Elevation (names are proposals, no component uses them in V3-02.2).**

| Token         | Value                                                                          | Check                                                                 |
| ------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `--shadow-1`  | `0 1px 2px rgb(0 0 0 / 0.45)`                                                  | Deeper than V2's 0.35: the ground is darker                           |
| `--shadow-2`  | `0 8px 20px rgb(0 0 0 / 0.5)`                                                  |                                                                       |
| `--shadow-3`  | `0 20px 48px rgb(0 0 0 / 0.6)`                                                 |                                                                       |
| `--glow-edge` | `0 0 0 1px var(--accent), 0 0 12px rgb(49 133 255 / 0.45)`                     | The 1 px edge is 3:1 on all four surfaces (3.67 at the lowest)        |
| `--glass-bg`  | `color-mix(in srgb, var(--surface-1) 90%, transparent)`                        | Over a white backdrop: `--text-primary` 11.40, `--text-tertiary` 5.07 |
| `--vignette`  | `radial-gradient(ellipse at center, transparent 58%, rgb(7 17 31 / 0.6) 100%)` | Never over a control or label (Neon rules)                            |

The glass figure shows the 90 % panel is legible even over a white pixel, so blur is a look and not a legibility fix,
which is what Q2 decided.

**One scene token moves.** `--tw-top` goes from `#2a4658` to `#274152` (and its copy in `twinColors`). With the V2 value,
`--sev-critical` on it is 2.96:1 and `--accent` 2.80:1, under the 3:1 that a hovered, selected or alarmed part's edge is
held to on an idle neighbour; at `#274152` they are 3.18 and 3.02. The other `--tw-*` values keep their V2 value until
Phase 3. `--tw-hover-*` and `--tw-alarm-*` are mixes and follow.

**Hand-off to V3-02.2.** Pairs to change in `scripts/contrast.ts`: `--accent-ink` on all four surfaces at 4.5 and on
`--accent-tint` over `-1` and `-2` at 4.5; `--accent` and `--accent-2` on all four at 3; `--signal` on all four at 4.5;
the existing `--accent` text pair is removed. Add `--signal` and `--accent-2` to `MATRIX_ROWS`. The copies that must
move in the same change are the ones named above; the sign-in theme is in `docker/keycloak/themes/occ/login/` (the task
files still say `ops/keycloak/…`, which does not exist). `docs/design/tokens.md` is regenerated by the script.

**How this was checked, and what is not.** Measured: every ratio in the table and the three quoted tints, by the WCAG
formula; the full pair set of `scripts/contrast.ts` run on a scratch copy with these values (the copied-token drift
reports were the only other output). **`unverified`:** how any colour looks on a real panel or at 1–2 m (no one has seen
these values rendered), frame 00 still draws `#142940` / `#1C3552` for surfaces 2 and 3 (which put
`--sev-critical` at 4.40:1 on `-2`, under the 4.5 the text pair needs), and V3-01.8 redraws frame 00 with the table above.

### Neon rules

| Element            | Treatment                                                                                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Neon edge lighting | A thin lit edge on the active tab, the selected button, the connection line and the open panel. Not on every card.                                                                     |
| Holographic marker | Icon core, thin ring, soft halo flat on the ground plane. Healthy: small `--signal` ring, drawn only on hover, selection and at Near. Selected: neon outline. Incident: severity halo. |
| Incident spotlight | The selected incident gets a short pulse ring and a floating label; the rest of the scene drops slightly in contrast (not hidden).                                                     |
| Glass-like panels  | Panel surface at ~90 % opacity with a hairline border and a deep shadow. Blur only on small floating overlays (Q2).                                                                    |
| Telemetry glow     | Charts in `--signal` and `--accent-2`; only an abnormal point brightens, and in the severity hue of the rule it broke.                                                                 |
| Cinematic depth    | A soft vignette over the stage edge (CSS, not post-processing) leads the eye in and never covers a control or a label.                                                                 |

### Calm view

**Added 2026-10-21 after a survey of other monitoring consoles** (ISA-101 high-performance HMIs keep the screen grey
and give colour, motion and glow to the abnormal). Two rules follow, both for a 12-hour shift:

1. **Healthy devices are quiet.** A ring on every device is noise: at Medium zoom a healthy device is not drawn until
   it is hovered, selected or its building is in focus, and at Far it is not drawn at all. At Near it is always drawn.
   A device that is in fault or stale is **always** drawn, because both are abnormal. The Assets tab still lists
   every device (V2 principle 1), so nothing is only discoverable by hovering the scene.
2. **Calm view, a per-person setting.** In the account menu, next to Follow selection: "Calm view — mute the campus
   colours so alerts stand out". It desaturates the environment only (lawns, field, lake, roads, parking, trees, cars,
   building faces and lit windows, to about 18 % saturation at the same lightness). Severity rings, halos, glyphs,
   labels, the selection outline, the accent, the live cyan, stale and fault markers, the heat ramp and every panel
   are never touched, so no contrast ratio changes. Default **off**; remembered per browser; shown only where 3D is
   available; every role may use it; the wall has no menu and stays in full colour. Frame 15.

## Layout

Same regions as V2 frame 01; sizes follow the direction.

| Region           | Size                                  | Content                                                                                                                                                                           |
| ---------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header           | 64–72 px                              | Brand and site name (a label: the API serves one site plan, so there is nothing to select, see Q10), KPI tiles by severity, `Live` / `Telemetry`, clock, Report incident, account |
| Incident sidebar | 320–360 px (today `--feed-width` 360) | Incidents / Assets tabs, search with filter, All / Open / Resolved with counts, severity order Critical → High → Medium → Low                                                     |
| Stage            | flexible                              | 3D campus; top bar (3D / 2D, layers), left tool rail (reset view, pan, rotate, focus), scale bar and compass bottom-left, legend; none over the centre                            |
| Camera strip     | 150–190 px, collapsible               | Header row (title, count, All / Live / Offline, View all), live thumbnails with camera code, place, time                                                                          |
| Inspector        | 360 px overlay (today 440)            | Opens on selecting an incident or device; overlays the stage, so the stage never resizes (V1 principle 6)                                                                         |
| Status bar       | 32 px                                 | System health, connection states, settings entry                                                                                                                                  |

Vertical budget on a 1080 px screen: 72 + 32 + strip 190 leaves about 780 px for the stage; collapsing the strip
returns about 150 px. Compact density (account menu) still applies and shrinks header and strip first.

## Realistic twin

What the direction asks for, against what V2's budgets set (ADR-0020 and the [Performance](../v2/brief.md#performance)
table):

| Direction                                                      | V2 limit                                          | V3 approach                                                                                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buildings with distinct volumes and materials                  | Buildings are extruded shells, no building models | Procedural facades on the extruded shell: window atlas, roof detail, per-`use` material. Authored building models are possible on the raised budget (Q3, Q11) |
| Roads, parking, lawn, trees, paths with own materials          | ≤ 250,000 triangles on screen, ≤ 150 draw calls   | **Raised.** Ground from the site-plan features with a material per kind; trees as an `InstancedMesh`; one draw call per kind. New numbers set in V3-11        |
| Shadow, ambient occlusion, depth                               | No shadow maps; baked AO; one blob decal (R5)     | **R5 amended.** One shadow-casting directional light (High tier), baked AO in ground and facade textures, contact decals, cool hemisphere light, height fog   |
| Little reflection, no heavy bloom                              | —                                                 | Restraint, not absence: no reflective floors, glass is a flat emissive-blue material; at most a subtle bloom on marker halos in the High tier, tuned in V3-12 |
| Healthy / selected / critical / high / medium markers          | Markers exist (beacons, camera markers)           | One marker family: core, ring, halo; state changes ring and halo, never the building                                                                          |
| Zoom far / mid / near                                          | Four levels by click, not by distance             | Distance tiers on top of the levels ([Semantic zoom](#semantic-zoom))                                                                                         |
| Camera: orbit, pan, zoom, reset, 2D / 3D, short move on select | V2 limits and fly-to (600 ms)                     | Unchanged; select now flies ([Incident-first behaviour](#incident-first-behaviour))                                                                           |

**Budgets raised (decided 2026-10-21, Q3).** V3 does not squeeze the look into V2's numbers: triangles on screen, draw
calls, the 3D chunk's gzip budget (375 KB today, ADR-0020 as amended in V2-17.3), the texture budget and the shadow
rule are all raised to what the look needs. **This brief does not invent the new numbers.** V3-11 builds a slice of the
scene, measures it, writes the numbers into an ADR-0020 amendment, and V3-12 – V3-16 build to them. Two things stay
fixed: textures are fetched after the chunk, not inside it, so the chunk budget is spent on code; and the frame-time
target (p95 ≤ 14 ms) is still judged on the reference machines. What gives when a machine misses it is the **tier**, not
the target: the reference laptop (an integrated Iris Xe) may well run Standard, and the tech lead lowers the floor
explicitly if that is not acceptable.

### The mockup scene follows the real site plan

The first mockup scene was an invented campus. It was redrawn on 2026-10-21 from the data the console draws today:
the boundary, the three roads and the sports-field markings of `SITE`, and the 20 zones of `ZONES` with their centres,
sizes and heights, in metres from the campus centre (`apps/api/src/database/seed/campus.ts`, ADR-0017). North is up
on the plan and the 3D camera looks from the south-west, as in the V2 console. Two things in the mockup are **not**
the build's: building heights are drawn 1.4 times taller than `heightM` so the facades read at campus zoom (unverified
for the build; V3-11 decides), and the tree positions and the grass are the mockup's own.

**Grass.** Mown stripes everywhere read as artificial. The ground is a multi-scale noise texture (broad patches, a
mid-scale mottling and a fine speckle in three dark greens) over the whole site; mown stripes appear only where grass
is actually mown (the sports pitch, faintly on the central lawn); trees are lumpy two-tone crowns with a soft contact
shadow, in clusters and along the roads. In the build this is the ground material of V3-13 (a generated texture,
never an image from outside), and Calm view mutes it with everything else in the environment.

### Facades, roofs and equipment in the frames

Added 2026-10-22 after the first frames read as plain boxes. The shared scene (`mockups/Scene.dc.html`, `v3.css`) now
draws what an operator would recognise on site. This is the mockup's reading of V3-13 and V3-14, not a spec of the
build's textures.

- **Facades by use, not by one pattern.** Glass curtain wall with mullions and a sky streak (Innovation Hub, Science
  Lab, Lecture Hall A); brick with punched windows and a string course (Library, Student Center, both dormitories);
  ribbon windows between piers (Admin Building, Health Clinic, Security office); a windowless louvred block with a
  roll-up door (the data hall); blank panels with a clerestory band (Sports Hall). Every building has a lit entrance with
  a canopy, a dark ground floor, a darker foot where it meets the ground, and, at night, an irregular scatter of lit windows. Lit
  windows are never a lattice and never a vertical stripe.
- **Roofs.** A parapet, a membrane inside it, and plant that stands on the roof with its own sides: air handlers,
  condenser fans that turn (and stop under reduced motion), skylights, a stair core, solar arrays on Lecture Hall A, a
  rooftop water tank on Dormitory A, a mast with a beacon on the Innovation Hub.
- **Equipment as objects.** Cooling towers CT-01 and CT-02 on the data hall's roof, the generator GEN-01 beside it (at its
  level L1), the air handler AHU-H1 on the Hub, the fume-hood stack on the Science Lab; in the utility yard two
  transformers with bushings, the switchgear with its cabinet doors and two chillers with fans. These are the devices
  the Near tier names, now with a body under the marker.
- **Street furniture.** Lamp posts along the roads, a pole under each camera marker, a barrier arm at the main gate,
  paved pads under the buildings.
- **Trees never compete with devices.** Trees were crowding the view the operator watches the devices through: the
  frames now keep about a third of them (82 became 26), with smaller crowns, kept to the site's edge belt and around the
  lake and the sports field. No tree stands within about 18 px of a building, 6 px of a road, or 22 px of any marker,
  camera or device, so nothing a person has to read is behind a crown. In the build this is a placement rule
  (clearance around buildings, roads, cameras and assets, then a low density) and the tiers thin trees further.
- **Light follows the clock.** **Lamps and windows are lit only at night.** By day the lamp post stays and its light,
  its pool on the ground and its glow go; the windows are plain glass with a little more sky in them and the entrance is
  unlit (the scene's `night` switch in the mockup). The build reads the site's own local time: night is from sunset to
  sunrise, computed from the site's coordinates by a small pure function (no dependency, no setting), and the console
  looks again every minute and redraws only when it changes. This is not a Night mode (Q9, dark only): the scene stays
  the dark theme either way, and only the lamps and the windows follow the clock. The rooftop mast's beacon is a safety
  light and stays. Calm view mutes the glow with the rest of the environment. The beacons, markers and severity colours
  never follow the clock.
- **Scene modes still hold.** Spotlight and Calm filter the flat faces only; the heat overlay paints the shells in its
  ramp and hides windows, plant, masts and lamps; building level fades everything but the focused building and keeps
  the data hall's own equipment (`b-dc`).

Not decided here, and `unverified` until V3-11 measures: how much of this the build draws at Medium, which parts are
generated geometry and which are the V2 stand-in models, and the cost of the lamp glow and the fans. The build never
draws more detail than its tier's budget allows; at Far the scene stays boxes and markers.

### Quality tiers

| Tier     | When                                                        | Differences                                                                              |
| -------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| High     | Frames hold the budget                                      | Full environment kit, shadow, facade windows, halos, panel blur                          |
| Standard | p95 over budget for 2 s (the V2 pixel-ratio rule, one step) | Pixel ratio steps down first, then shadow off, trees thin out, halos become flat rings   |
| Low      | Still over after Standard, or no WebGL 2 for the kit        | V2 look: neutral extruded shells, flat markers. This is today's console and the fallback |

The wall controller stays at pixel ratio 1.0 and is judged on its own hardware (V2 brief, Reference hardware).

## Semantic zoom

Distance tiers on the campus level; they never change the level (Campus › Building › Asset › Part) the operator chose.

| Tier   | Camera distance (`unverified`, tuned in V3-16) | Shows                                                                                                                            |
| ------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Far    | > about 450 m                                  | Campus, a chip per zone with its open-incident count and worst severity; no individual device                                    |
| Medium | about 150–450 m                                | Building labels, incident beacons, asset markers clustered per building with a count; healthy devices only on hover or selection |
| Near   | < about 150 m                                  | Individual device markers with labels; at building level the equipment as V2 frame 12                                            |

Rules: clusters are by building, never by pixel distance (so they do not reshuffle while orbiting); every count is
also in the Assets tab (V2 principle 1, the twin is a view, not a second source of truth); one label is drawn per
zone, collision-hidden by severity then distance.

## Incident-first behaviour

| Step    | V3                                                                                                                                                                                                                                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New     | The row appears in severity, then time order, with the V1 arrival highlight; toast per V1 / V2 rules. **The camera does not move.**                                                                                                                                                 |
| Select  | The row takes the accent tint and its severity icon; the inspector opens.                                                                                                                                                                                                           |
| Focus   | The camera flies to the incident's marker (600 ms ease-out; instant under reduced motion); the marker gets the pulse ring and a label; other zones drop slightly in contrast. A setting, **Follow selection** (account menu, on by default), turns the flight off; `F` still flies. |
| Inspect | Inspector: status and connection, device information, live readings, related cameras.                                                                                                                                                                                               |
| Act     | Acknowledge / Resolve (and Assign only if Q8 lands) are explicit buttons. **Opening an incident never changes its status.**                                                                                                                                                         |

Selecting from the 3D scene (clicking a marker) does not fly: the operator is already looking at it.

## Inspector

One 360 px overlay, one header, four tabs. Header: type icon tile, title, code, close, severity chip (icon + text),
age, status. The selected object is the only neon in the panel (a lit edge on the active tab and the primary action).

| Tab       | Incident                                                                                               | Asset (device)                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Details   | Lifecycle, device information card, live data tiles, evidence ("why it was raised"), cameras, actions  | Device information card, headline readings, parts list, linked incident, actions |
| Related   | Other incidents in the zone, the device, cameras covering it (count badge on the tab)                  | Incidents on the asset, cameras covering it, other assets in the zone            |
| Telemetry | Sparklines of the points the rule watches (15-minute ring buffer); only when the incident has an asset | All points with sparklines                                                       |
| Timeline  | The audited timeline (V1) with the system actor for telemetry (V2)                                     | Incident history of the asset (read from incidents)                              |

- **Live data tiles** show the reading, its unit and a delta. The delta is "change over the last 15 minutes" from the
  ring buffer the console already keeps (V2 Real-time data), so it needs no new API; it reads "—" with no history.
- **Sparklines** use `--signal` and `--accent-2`; the point that broke a rule is drawn in the rule's severity hue with
  an end marker, and the stale gap rule of V2 frame 05 still applies.
- Same view-only footer for a viewer and for a technician outside their categories (V2 frames 11, 17).
- Width: **360 px**. Frame 02 shows the lifecycle stepper and the action bar fitting, and the tech lead accepted it on
  2026-10-22 (Q5), so the 400 px fallback is not used.

## Place views (V3.5, frame 25)

Added 2026-10-22. Buildings and areas do not look alike, and devices are not only outside: a smoke detector is in a
lab, a temperature sensor in an aisle between racks, a leak sensor in a laundry. A footprint with dots (frame 20b)
cannot say which room, and every building would read the same. A **place view** gives each building level and each
open area its own plan.

- **What it is.** A stylised plan, not a CAD floor plan: outer walls, interior walls, named rooms, the few fixed props
  that make a place recognisable (rack rows, lab benches, beds, transformers, chillers), and every device standing in
  its room. Walls are drawn low so a device is never behind one; markers and labels are drawn above the geometry.
  Decided by the tech lead on 2026-10-22: **a stylised plan per place** (not just a floor outline).
- **Three kinds of place.** A **building with levels** (a plan per level, the level selector of frame 20), an **area**
  (one plan, no selector: the utility yard, parking, the field, the gate), and a **place without a plan yet** (the
  footprint with dots and the words "No plan drawn yet"; nothing is invented).
- **Ways in and out.** In: double-click a building, Open plan in its summary, Show in plan in an asset or incident
  inspector. Out: Esc, the breadcrumb, double-click on empty ground. **The view moves only because the operator asked:**
  a new alarm never opens a plan, and selecting an incident in the feed still flies to its building as before.
- **Plan or Shell.** Plan is the cut-away; Shell is the closed building of frame 08 with the level highlighted and the
  heat overlay. Plant on the roof belongs to the building's Roof level.
- **Rooms panel.** The rooms of the level with their device counts and worst open incident; selecting a row flies to the
  room. An alarm tints its room in the severity colour and pulses on the floor.
- **Data it needs (additive, on top of ADR-0023).** Rooms per level (code, name, kind, outline in metres) with a short
  list of props, and an optional `plan_x`, `plan_y` on an asset inside its level. Without them a device keeps its
  footprint dot, so an older console and an older API still work. This is a **new ADR** (**ADR-0031, accepted 2026-10-22**; the
  number keeps clear of V4's reserved 0025 – 0030) and it **extends ADR-0023's "not decided here: floor plans"**; it
  does not contradict it. The demo's five places are authored in the repo as seed data. A real site needs an editor or an
  import, which is not designed and not in V3.5.
- **Rules.** Every role sees every plan; a viewer cannot act and a technician's actions follow their categories
  (frames 11 and 17). Moving the camera is not an action on the site. Plans load with the level, cached; while loading
  or on failure the footprint shows. Reduced motion cuts instead of flying. An unattended wall never opens a plan.
- **Unverified until V3-11 and the build.** The cost of a plan (walls, props, room labels) against the Near tier's
  budget, the plan's camera angle and the wall height. The frames draw it with CSS; the build uses three.js.

## Status bar

A 32 px bar at the foot of the console: overall health ("System healthy" or what is wrong, in words and icon), the
3D engine state, the WebSocket and telemetry connection, and an entry to settings (the account menu's items).

- It **adds no new source of truth**: it reads the same states as the header pills and banners (`Live`, `Telemetry`,
  session, 3D fallback) and links to them.
- The concept shows a live FPS number. Not shipped: V2 keeps FPS in the developer HUD (`?debug=twin`) and a number in
  front of operators invites questions it cannot answer. The 3D engine segment reads the **tier** ("3D · High",
  "3D · Standard", "3D unavailable"), which is what an operator can act on.
- The concept's "Night mode" toggle implies a light theme. See Q9.

## Type and components

**Decided 2026-10-21 (Q6): follow the direction.**

| Item          | Direction           | Today (tokens.css)                         | V3                                                                             |
| ------------- | ------------------- | ------------------------------------------ | ------------------------------------------------------------------------------ |
| Family        | Inter or Geist Sans | Barlow Semi Condensed (UI) + Barlow (body) | **Inter** (variable, tabular numerals), one family for UI and body             |
| Page title    | 20–24 px / semibold | `--type-xl` 20, `--type-2xl` 24            | Same sizes                                                                     |
| KPI value     | 24–30 px, tabular   | 24 / 32 scale steps                        | 28 px, tabular                                                                 |
| Section title | 14–16 px / semibold | 14 / 16                                    | Same                                                                           |
| Body          | 13–14 px            | 15 body, 14, 13                            | 14 body; 13 for dense rows                                                     |
| Metadata      | 11–12 px            | 12 (`--type-xs`)                           | 11–12 px: new `--type-2xs` 11 for secondary metadata only (timestamps, codes)  |
| Button        | 36–40 px            | `--control-m` 40, `--control-s` 32         | 40 default, 36 in dense bars; 32 stays for in-row actions (24 px target floor) |
| Input         | 38–42 px            | 40                                         | 40                                                                             |
| Radius        | 8–12 px             | 4 / 6 / 10                                 | 4 (chips) / 8 (controls) / 12 (cards, inspector, floating panels)              |
| Border        | 1 px, low contrast  | `--border-subtle`                          | Same; `--border-strong` only for input boundaries (V1 rule)                    |

Inter, not Geist, because it is the direction's first name and it ships as `@fontsource-variable/inter` like today's
fonts. The 11 px step carries the V1 floor in a different way: it never holds anything an operator must act on, its
contrast must still pass on every surface it sits on, and V1's "readable from 1–2 m" rule stays for everything else.
The font swap still touches every width-dependent layout (feed truncation, KPI tiles), so it stays its own ticket
(V3-03).

Icons stay Lucide. The direction asks for camera, smoke detector, access control, temperature sensor and network
gateway to be visually distinct; of those only the camera and the indoor climate sensor exist in the product today
(see Q7), so the glyph work covers the existing classes first.

## Concept render vs the product

The render shows things the product does not have. They are **not** requirements until a decision says so.

| In the render                                          | In the product                                             | Treatment                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| Fifth severity "Info" (a badge on one row)             | `INCIDENT_SEVERITIES` = low, medium, high, critical        | **Not added.** The row is a Low. A new severity is a contract change  |
| "Assign" button, "Assigned to: Building Team"          | Lifecycle is open → acknowledged → resolved, no assignee   | Q8: out of V3.0 unless chosen; the button is not drawn without it     |
| Smoke detector `SD-0043`, battery 92 %, humidity       | No smoke detector, access control or network gateway class | Q7: demo data track, classes are data (ADR-0018), boxes need no model |
| Site selector "Langbiang Tech Campus ▾"                | One site plan from the API; no site switch                 | A label, a menu only if a second site ever exists (Q10)               |
| "Night mode" toggle                                    | Dark only (`color-scheme: dark`)                           | Q9                                                                    |
| "3D Engine · 60 FPS"                                   | FPS in the developer HUD only                              | Tier word instead (Status bar)                                        |
| Zone name chips on every building, parking "P" markers | Zone labels exist in 3D                                    | Kept, by Semantic zoom tier                                           |
| Photoreal facades, lit windows, dense trees            | Extruded shells, no shadows (V2 R5, amended)               | The environment kit on the raised budgets (Realistic twin)            |

## Operations aids

**Added 2026-10-21 after a survey of other monitoring consoles** (ThingsBoard, Genetec, Siemens Desigo CC, Milestone
XProtect, Willow, ISA-18.2 / EEMUA 191 alarm management, ISA-101 high-performance HMI, shift-handover practice). Scope
accepted by the tech lead the same day. Everything in this section changes **no domain**: it is derived from data the
console already holds, and ships inside V3. The values are starting points, kept as named constants in the code in
the manner of V1's attention thresholds, not magic numbers.

### Alarm load (frame 16)

A running measure of how much the operator is being asked to handle, from ISA-18.2 / EEMUA 191.

- **Rate.** Incidents raised (any source) in the last 10 minutes, shown in the status bar as "Alarms 3 / 10 min".
- **Flood.** Starts above 10 raised in 10 minutes, ends below 5 in 10 minutes (the standards' figures for process
  plants; **`unverified` for a campus**, so constants in `lib/alarmLoad.ts`). While it lasts the stage and the feed
  show one banner, "Alarm flood: 14 raised in 10 min", with a switch **Group by zone**: the feed collapses to one row
  per zone with its count and worst severity (UI only; real incident grouping is V4).
- **Standing.** Open (unacknowledged) incidents past their attention threshold (V1: critical 2 min, high 5, medium 15,
  low 30).
- **Noisy devices.** The five assets that raised the most incidents in the last 24 hours, so a flapping sensor is seen
  rather than endured. Needs 24 hours of incidents. Checked in the code: `GET /api/incidents` takes only `status`,
  `severity` and `limit` (at most 500) and the console loads 200, so V3 reads the cached incidents and says "Based on
  the 200 most recent incidents" when the cache is full. A `from` filter on that route (additive, also needed by V4
  replay) is the safe follow-up, not part of V3.
- **Where.** The status bar segment opens a popover **Alarm load** with the four measures and a small bar chart of
  raised per 10 minutes over 3 hours. Neutral by default; warning style (icon and word, never colour alone) only
  during a flood.
- It is a **view of existing incidents**, identical on every console, and it raises nothing: no notification, no
  server state. All roles read it.

### Attention countdown (frame 17)

V1 turns an open incident's age into a warning once it passes its attention threshold. V3 shows the time left
**before** that, because operators act on a countdown, not on a colour change.

- A small ring with `m:ss` under the age in the feed row; the same chip in the inspector header. Open incidents only;
  acknowledging clears it (V1).
- States, each with icon and words: normal (more than 25 % left, neutral), soon (25 % or less left, warning style and
  a clock), overdue (`+2:10 over`, clock and danger text). The critical KPI tile's hot state is unchanged.
- It is **display only** and called an attention threshold, never an SLA: nothing is enforced server-side (V1).
  OCC-26 later replaces the constants with the server's SLA; the component takes a deadline, so it does not change.

### Reading range (frame 18)

The inspector's Telemetry tab (and the asset inspector) gets a range switch **15 min | 1 h | Around the alarm**.

- 15 min is today's seed from the ring buffer. 1 h and Around the alarm read
  `GET /api/assets/:code/telemetry`, which already serves up to one hour per request (720 buckets of 5 s): no API
  change. Around the alarm is the incident's raised time minus 10 minutes to plus 5 minutes, so an operator can read
  an alarm back, which is what the route was documented for.
- States: loading skeleton, error with Retry, "No readings in this range", the V2 stale gap rule. A fetched range is
  cached for 30 s per asset and range; the switch never refetches on every render (the route is rate-limited).
- A longer history, or a campus-wide one, needs a new endpoint and is V4 (replay).

### Table mode (frame 19)

A **List | Table** switch in the incident sidebar head. The list stays the default: it is the scan view for a quiet
shift; the table is for a supervisor with dozens of incidents or a flood.

- The table opens over the stage (the sidebar stays) and has the columns Severity, Incident, Place, Status, Source
  (operator or telemetry), Raised, Attention (the countdown), Code. Columns sort (`aria-sort`); search and the
  All / Open / Resolved chips are the same state as the list; a row opens the inspector exactly as a list row does,
  including the camera flight.
- **Export CSV** of the rows currently shown, built in the browser (no route). It exports only what the user can
  already see, so every role may use it.
- **No bulk acknowledge in V3.** Acting on many incidents at once needs a batch route, per-incident audit and a
  permission decision; it belongs to V4 with incident grouping.
- `T` toggles the table, behind the single-key shortcuts switch (WCAG 2.1.4). Sort and mode are remembered per browser.

### Pan tool and the 8-direction pad (frame 24)

**Added 2026-10-21 at the tech lead's request.** In the V2 console a drag only orbits; panning exists but is hidden
(Shift + drag, right-drag, two fingers on touch, Shift + arrows while the stage has focus), so operators who know only
the left button find that the map "zooms and turns but cannot be dragged". V3 keeps V2's convention (a drag orbits)
and makes panning visible, in two ways. Decided 2026-10-21 (tech lead).

- **Pan tool.** The camera rail gets an **Orbit | Pan** pair: Orbit is the default. With Pan on, a left-button drag
  (or one finger) moves the view along the ground, in any direction, and the cursor is a hand (`grab`, `grabbing` while
  dragging). The existing ways stay: right-drag, Shift + drag, two fingers, Shift + arrows. While Pan is on, **Shift +
  drag orbits** (the inversion), so the modifier keeps one meaning, "the other tool". `P` toggles the tool, behind the
  single-key shortcuts switch (WCAG 2.1.4) like `V` and `F`. The tool is a session choice, not remembered, and the
  stage's own focus rules (V2) are unchanged.
- **8-direction pad.** A round pad over the stage, bottom-left above the scale bar, with eight arrows (N, NE, E, SE, S,
  SW, W, NW) and a centre button. Directions are **screen directions along the ground**, the same as Shift + arrows, so
  "up" is away from the viewer whatever the camera's azimuth. A click or Space / Enter moves one step (about 15 % of the
  visible ground width); holding it moves continuously at a speed that scales with the camera distance, so it feels the
  same zoomed in and out. The centre button centres the view on the selection (the same target as `F`, without
  changing the distance) and is disabled when nothing is selected.
- **Limits.** Everything obeys the V2 camera limits: the target stays inside the site boundary plus 40 m, the roof
  height cap holds, damping 0.12. Reaching a limit stops the movement; it does not bounce.
- **Reduced motion.** A step jumps without easing; holding still moves continuously (it is the operator's own
  action), but the damping tail is dropped.
- **Hint and help.** The drag hint reads "Drag to rotate · Pan tool or Shift + drag to pan"; the `?` help lists the
  tool, `P` and the pad.
- **Roles and wall.** Every role may pan; it changes only the camera. The video wall has no input at all (V2), so no
  rail, pad or hint. The 2D map already pans by dragging; it has no pad.
- **Scope.** Console only: no contract, route or data. It extends V2's `Rig` mouse mapping and adds one rail control
  and one overlay; ADR-0020's description of the mouse mapping gets an "amended by" line when it ships.

## V3.5 — operations that need small data

Same visual language, a little data each. Built after V3, in this order of value: floors, handover, trend, saved
views. Each addition is additive (a nullable column or a new table), so an older console meets a newer API and the
reverse without a coordinated deploy; the data changes are recorded in ADR-0023 (floors) and ADR-0024 (handover).

### Floors (frame 20)

Concept and demo already say "level 2"; the data only has `elevation_m`.

- **Data.** Buildings get an ordered list of levels (`code`, `label`, `elevation_m`: `L1`, `L2`, `L3`, `ROOF`);
  `asset` and incident location get a nullable `level_code`. Seed fills the demo buildings. Text such as "level 2"
  in a title stays text; the structured field is what filters and places.
- **UI.** At building level a vertical **level selector** (Roof, L3, L2, L1, All); the Assets tab and the
  inspector location read "Science Lab · Level 2"; the report form picks a level after the zone; selecting a level
  highlights that slab and shows only that level's devices. No floor plans: the site plan has footprints, not rooms,
  so a level shows the footprint with its devices, never invented rooms.

### Shift handover (frame 21)

For a 12-hour night shift that ends with open work. Practice in control rooms: write the handover for the incoming
operator, carry open items forward automatically, require the incoming operator to accept it.

- **Data.** (The console polls for the latest handover about once a minute, so the banner can lag by about that
  long: handover does not travel through the incident outbox.) A `shift_handover` record: outgoing user, optional incoming user, free-text notes, a snapshot of the open
  and acknowledged-unresolved incident ids at creation, `created_at`, `accepted_at`. Routes to create, accept and read
  the latest. Operators and supervisors write; technicians write for their categories **and may accept any operator's handover** (decided 2026-10-21); viewers read nothing.
- **UI.** A **Handover** entry in the account menu opens a sheet: open incidents, acknowledged but unresolved, the
  alarm load of the shift, notes. The incoming operator sees a banner until they accept ("Handover from Demo
  Operator, 19:02 — Review"). Accepting is explicit and audited; nothing changes any incident's state.

### Trend warnings (frame 22)

An early word before a rule breaks.

- **Computed in the browser**, from the 15-minute ring buffer for an asset being watched, otherwise from the last
  10 minutes read through the history route. **What the console knows, checked in the code:** a rule's limit comes
  only with the single-asset route, the asset list has none; the ring buffer exists only for the (at most four)
  watched assets; the campus overview carries the current headline values only. So a campus-wide Watch list is
  possible for rules whose key is a headline point, by filtering for nearness to the limit on the overview value and
  then reading 10 minutes of history for the few that pass. Other points trend only while their asset is inspected.
  The method: a least-squares line over the last 10 minutes for a
  point that has a limit; if it reaches the limit within 30 minutes and fits well enough, the tile shows
  **Trend: ~20 min to limit** and the asset is listed under a **Watch** filter in the Assets tab. The fit threshold
  and horizon are constants, `unverified` until read on real data.
- It is labelled an estimate, never raises an incident (incidents come from the server's rules only, ADR-0018), is
  off for stale points, and is drawn dashed so it cannot be taken for a reading.

### Saved views (frame 23)

Named camera positions (target, distance, azimuth, tilt, and level once floors exist): Campus, Main Gate, Data
Center roof. A **Views** button on the camera rail lists the built-in Campus view and the user's own; "Save current
view" asks for a name. Stored per browser first (storage wrapped in `try/catch`); server sync is later. Flying to a
view is a camera move the operator asked for, so principle 4 holds; instant under reduced motion. 3D only.

## V4 — direction, each needing an ADR

Not scheduled and not broken into tasks; [../v4/brief.md](../v4/brief.md) records the direction, the data each needs
and the ADR it waits for: guided response (SOP checklists), incident grouping, alarm shelving, campus replay, external
notifications, and bulk acknowledge (which the table mode defers).

## Frame index

Frames 00 – 25 are drawn on the [design canvas](https://claude.ai/artifact/BtgcJCPfsoqLp2fZJchGfy) (one board each, plus
the shared components Header, StatusBar, Sidebar, Strip, Scene and Map2D) and were accepted by the tech lead on
2026-10-22. Source of every frame: `mockups/`. Numbering restarts at 00; "V2 frame n" always names the V2 one.

| Frame                               | Shows                                                                                                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 00 Foundations V3                   | Palette and contrast table, surfaces, neon rules (do / don't), type scale, buttons, tabs, chips, panel, marker family and states, severity badges                                       |
| 01 Overview — nothing selected      | Header, sidebar, 3D campus at medium tier, camera strip, status bar, no inspector                                                                                                       |
| 02 Incident selected                | Focus flight done, spotlight, pulse ring and label, inspector on Details at 360 px, selected row                                                                                        |
| 03 Inspector tabs                   | Related, Telemetry, Timeline of frame 02                                                                                                                                                |
| 04 Asset inspector                  | A device: information card, live tiles with deltas, sparkline with an abnormal point, parts, actions; stale variant                                                                     |
| 05 Critical arrives                 | Toast, hot KPI tile, new row, beacon; the camera has not moved                                                                                                                          |
| 06 Semantic zoom                    | Far, medium and near of the same campus; clusters and count chips                                                                                                                       |
| 07 Telemetry paused, offline        | Pills, banner, status bar in a degraded state, stale markers                                                                                                                            |
| 08 Building level and heat overlay  | V2 frames 12 and 13 in the new look                                                                                                                                                     |
| 09 2D view                          | V2 frame 14 in the new look (map style from tokens)                                                                                                                                     |
| 10 Loading, no WebGL, Standard tier | V2 frames 06 and 07, plus the tier change notice                                                                                                                                        |
| 11 Roles                            | Viewer and technician on frames 02 and 04 (view-only footer, hidden actions)                                                                                                            |
| 12 Report incident                  | V2 frame 09 in the new look                                                                                                                                                             |
| 13 Camera strip                     | Collapsed, expanded, filtered to Offline; camera viewer                                                                                                                                 |
| 14 Video wall, sign-in              | V2 frames 18 and 19 on the new tokens                                                                                                                                                   |
| 15 Calm view and settings           | The same incident scene in full colour and in Calm view, the account menu with its switches, what Calm mutes and never mutes                                                            |
| 16 Alarm load and flood             | Status bar segment, the Alarm load popover (rate, flood, standing, noisy devices), the flood banner with Group by zone                                                                  |
| 17 Attention countdown              | Feed rows and inspector chip in the normal, soon and overdue states; acknowledged clears it                                                                                             |
| 18 Reading range                    | Telemetry tab with 15 min, 1 h and Around the alarm: loaded, loading, error and empty                                                                                                   |
| 19 Table mode                       | The List / Table switch, the table over the stage with sortable columns, filters, Export CSV, a row open in the inspector                                                               |
| 20 Floors (V3.5)                    | Level selector at building level, a level's footprint with its devices, Assets filtered by level, "Level 2" in the inspector                                                            |
| 21 Shift handover (V3.5)            | The handover sheet for the outgoing operator and the banner and acceptance for the incoming one                                                                                         |
| 22 Trend warnings (V3.5)            | Trend tag on a tile, dashed projection on the chart, the Watch filter in the Assets tab                                                                                                 |
| 23 Saved views (V3.5)               | The Views popover on the camera rail: Campus, saved views, Save current view                                                                                                            |
| 24 Pan tool and 8-direction pad     | The rail with the Orbit / Pan pair, the pad with its eight arrows and centre button, cursors, held and disabled states, the new hint                                                    |
| 25 Place views (V3.5)               | A building level or an area as its own plan: rooms named, walls low, devices where they stand, the rooms panel, Plan / Shell; Data Center, Science Lab, Dormitory B, Utility Plant yard |

### Frames to revise

Where a drawn frame and the text above differ, the column says which wins. None is a change of decision.

| Frame              | Difference                                                                                                                | Wins                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 02, 04             | The inspector is 360 px, not the 320 – 360 range or V2's 440                                                              | The frame and the Layout table (Q5, 2026-10-22)                                   |
| 01, 02, 06         | The scene follows the real site plan (`campus.ts`, north-up, camera from the south-west) with natural grass               | The frames; the brief's "The mockup scene follows the real site plan" section     |
| 00                 | Foundations lists the Low tint as neutral steel and the text accent as `--accent-ink`                                     | The brief's token tables; V3-02.1 aligns the numbers                              |
| 01, 02, 06, 08, 20 | Buildings carry facades by use, roof plant, equipment bodies and lamps (see "Facades, roofs and equipment in the frames") | The frames; V3-14.1 turns it into facade rules and V3-11 sets what the tiers draw |
| 24                 | The pad sits above the legends column, bottom-left, and hides under 720 px                                                | The frame and V3-29; the brief's pad section gives the behaviour                  |

Implementation tickets, order and dependencies: [implementation-order.md](implementation-order.md).

## Architecture impact

(Added with the operations aids: the V3 additions need no ADR. V3.5 needs **ADR-0023 — building levels**, **ADR-0031 — place plans** (rooms and positions, added with place views) and
**ADR-0024 — shift handover**, both additive. V4's ADRs are named in [../v4/brief.md](../v4/brief.md).)

Visual work needs no API change. The decisions that need a record before building:

1. **ADR-0022 — console visual language (proposed).** Amends V1's accent decision and principle 1, V2's principle 4,
   the type family, and the token set. Records why Low stopped being cyan (Q1) and the type decision (Q6).
2. **ADR-0020 amendment — scene realism.** The raised budgets with their numbers, R5 (shadows) amended, the
   environment kit, quality tiers, textures fetched after the chunk. Written in V3-11, from its measurements.
3. **Only if chosen:** assignment (contracts, migration, API, event) and a light theme are each their own ADR and their
   own track; they are not part of the visual tickets.

## Open questions for review

1. ~~**Accent and the cyan collision.** V1 chose periwinkle because cyan was `--sev-low`; the direction wants blue /
   violet for interaction and neon cyan for live data.~~
   **Decided 2026-10-21: the direction's palette** (tech lead). Accent `#3185FF`, violet `#8B7CFF`, `--signal`
   `#35E7FF`; Low becomes neutral steel, so nothing collides ([Colour](#colour)). Operators relearn one colour: Low is
   no longer cyan, and its icon and text are unchanged.
2. ~~**Glass panels.** `backdrop-filter` over a live WebGL canvas costs fill rate on the reference laptop.~~
   **Decided 2026-10-21: the recommendation** (tech lead): ~90 % opaque panels, blur only on small floating overlays,
   off under `prefers-reduced-transparency` and in the Standard and Low tiers; measured in V3-18.
3. **Realism: budgets and source.** The budgets part is **decided 2026-10-21: raised to fit V3** (tech lead), numbers
   set by measurement in V3-11 ([Realistic twin](#realistic-twin)). Still open: the source of building detail,
   procedural facades and instanced trees (no vendor) or authored models from V2's 3D vendor, or both.
   **Decided 2026-10-21: procedural first** (tech lead); vendor models only where V3-11 shows the budget has room.
   See also Q11.
4. ~~**Select flies the camera.** The direction's step 3.~~
   **Decided 2026-10-21: yes** (tech lead), with the account-menu setting **Follow selection**, on by default; arrival
   never moves the camera.
5. ~~**Inspector width 360 vs 440.**~~
   **Decided 2026-10-21: 360 if frame 02 fits the lifecycle stepper and the action bar, else 400** (tech lead); one
   width for incident, asset and report (V1 decision: one sheet at every width). V3-01 draws the test; V3-09 builds it.
   **Confirmed 2026-10-22 (tech lead): frame 02 at 360 px is accepted, so the inspector is 360 px** for incident, asset and report.
6. ~~**Font and sizes.** Inter or Geist; the direction's 11–12 px metadata against V1's floor.~~
   **Decided 2026-10-21: follow the direction** (tech lead): Inter, 11–12 px metadata, 36–40 px buttons, 8–12 px radius
   ([Type and components](#type-and-components)).
7. **Device classes in the demo.** Smoke detector, access control, temperature sensor, network gateway. Classes are
   data, so this is seed, rules and glyphs, not code (ADR-0018). **Decided 2026-10-21: add them as a separate data
   ticket, V3-A** (tech lead), so the concept's flows have something to show; not blocking the visual tickets.
8. **Assign.** Needs an assignee in the incident model, an event, a permission and a timeline entry.
   **Decided 2026-10-21: not in V3.0** (tech lead); V3-B stays a named, unscheduled track with its own ADR. The
   inspector's action row is Acknowledge / Resolve until then.
9. **Night mode (light theme).** Doubles the token set, the contrast table, the twin colours, the map style and every
   frame. V1's viewing conditions are a dark room. **Decided 2026-10-21: out of V3** (tech lead); the status bar has no
   toggle; V3-C stays a named, unscheduled track.
10. **Site selector.** The API serves one site plan. **Decided 2026-10-21: the site name as a label in the header**
    (tech lead); build a menu when a second site exists.
11. **Who authors the art.** Environment textures and the tree model: in-house, vendor, or generated and cleaned up.
    **Decided 2026-10-21: in-repo and generated** (tech lead, follows Q3 "procedural first"): textures and the tree
    model are produced by scripts kept in the repo, in the manner of `models:standins` and `ops/sign-in-backdrop`, so
    the art is reproducible and has no vendor lead time. The model contract (V2) applies to the `.glb`. A vendor can
    replace any piece later without a code change.
    **Amended 2026-10-22 (tech lead): free sources are welcome as inputs.** The script may start from **CC0** assets instead of
    generated noise: textures from ambientCG or Poly Haven, the tree (and any prop) from Quaternius's Stylized Nature MegaKit or a
    Kenney kit, each checked against its own page on the day it is downloaded. Nothing that is not CC0 goes in without the tech lead.
    The script still does the work (resize, tile check, WebP, simplification to the model contract), the output is still hashed and
    reproducible, and every input is recorded in `ops/environment/SOURCES.md` (source, address, asset, licence, date, what was changed).

## Settled while breaking the work into tasks

Five points raised by the task lists, accepted by the tech lead on 2026-10-21 as the defaults the lists proposed:

1. **Which selections fly the camera.** Only a click or Enter on a feed row, and a pick from the search, fly. A click
   on a marker or beacon in the scene, the toast's "Open incident", a 2D marker and an arriving incident only select
   (or notify). This replaces the "selecting an incident does not fly" rule of ADR-0020 (V2-16.1) for the feed only;
   the ADR-0020 amendment (V3-11.7) and ADR-0022 record it.
2. **Accent as text.** `#3185FF` fails 4.5:1 as text on the lighter surfaces, so V3-02.1 splits the token: `--accent`
   stays the fill (primary button, focus, selection edge, dark text on it) and `--accent-ink` is the text and icon
   colour, tuned to pass.
3. **Telemetry rules and fire.** ADR-0021 is **not** amended in V3: telemetry still raises only Facilities and
   Environment incidents, so the new smoke detector and access controller classes carry fault and battery rules, not a
   fire or forced-door rule. A fire alarm from a detector is a later ADR.
4. **The concept render.** The link to [../../images/image.png](../../images/image.png) stays. The author commits the
   image together with this folder; V3-20 re-checks the link when the docs go "as built".
5. **The `Live` pill** uses `--signal` (the direction's cyan), not V2's green; `--success` stays for system feedback.

## Open questions for the operations aids

Defaults are proposed; each is settled in the ticket named.

12. **Alarm-load thresholds.** 10 raised in 10 minutes starts a flood, below 5 ends it (ISA-18.2 figures for process
    plants). Confirm with operations after a week of real incidents. Settled in V3-21.
13. **Noisy devices need 24 hours of incidents.** Whether the console already holds them or the incidents list needs a
    `from` filter is checked in V3-21; a filter is an additive API change.
14. **CSV export and privacy.** Export is of what the user can see. Confirm no role should be refused. Settled in V3-24.
15. **Level model.** Levels per building as an ordered list on the zone, `level_code` on asset and incident location.
    **Decided 2026-10-21 (tech lead): a `building_level` table keyed by building and code**, with a composite foreign key from asset and incident so the database refuses another building's level. The demo levels are confirmed in ADR-0023. Settled in V3-25.
16. **Handover approval.** Whether a supervisor must approve a handover, or the incoming operator's acceptance is
    enough. Default: acceptance only. Settled in ADR-0024.
    **Decided 2026-10-22 (tech lead): acceptance by the incoming operator is enough**; ADR-0024 records it, and a technician may accept any operator's handover.
17. **Trend fit.** Horizon 30 minutes, window 10 minutes, a minimum fit quality. All constants, `unverified`.
    Settled in V3-27.
18. **Rooms and device positions in a plan.** Whether a place's rooms and a device's position in its level are stored
    (a `room` table and optional `plan_x`, `plan_y`), and how a real site would author them. **Decided 2026-10-22 (tech
    lead): a stylised plan per place**; the storage and the authoring are ADR-0031's, accepted 2026-10-22.

## Notes

- All names, readings and counts in the concept render and the future frames are illustrative sample data.
- When the UI is revised later, update the frames and this brief first, then the implementation order if a ticket's
  scope moves (the V2 rule).
