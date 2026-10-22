# ADR-0022: The console's colour carries one meaning per hue, neon marks selection and live data only, and the camera moves when the operator asks

- **Status:** Accepted 2026-10-22
- **Date:** 2026-10-21
- **Context documents:** [Console V3 design brief](../design/v3/brief.md),
  [the V3 design direction](../design/v3/IoT_Digital_Twin_UI_Design_Direction.pdf),
  [Console V1 design brief](../design/brief.md), [Console V2 design brief](../design/v2/brief.md),
  [ADR-0016](0016-console-css-modules.md), [ADR-0020](0020-digital-twin-rendering-and-model-pipeline.md)
- **Amends:** the V1 brief's accent and type decisions and its Principle 1; the V2 brief's Principle 2 (the heat ramp's
  hue) and Principle 4 (the camera); [ADR-0020](0020-digital-twin-rendering-and-model-pipeline.md)'s statements that
  selecting an incident from the feed or search does not fly; [ADR-0010](0010-oidc-authentication.md)'s "fonts stay on
  the host" line (the rule stands, the families change). The "amended by" links in those documents are written when
  this ADR is accepted.

## Context

V3 is a visual and interaction upgrade of the V2 console, drawn from a design direction and a concept render
(brief V3). It keeps the journey and changes hierarchy, light and how an incident is followed in the scene. Most of
it is design and lives in the brief and `docs/design/tokens.md`. A few things bind code and later tickets and are
expensive to reverse, because they contradict a decision that is written down:

- **V1 chose its accent to stay clear of severity.** Periwinkle `#8c9bff` was picked because `--sev-low` was cyan
  (V1 brief, "Accent"), and V1's Principle 1 reads "severity is the only loud colour". The direction gives cyan, blue
  and violet to interaction and data, and gives severity red, orange and yellow only. Taken literally, cyan Low and a
  cyan "live" signal are two meanings for one hue.
- **V1 kept Barlow** on the argument that replacing it "would cost bundle and visual churn for no gain in
  legibility". The direction asks for Inter or Geist, 11–12 px metadata, 36–40 px controls and 8–12 px radii.
- **V2 fixed the camera.** Principle 4: "the view never moves on its own", and ADR-0020 (V2-16) says that opening an
  incident from the feed, search, toast or beacon selects it and **does not fly**; the camera moves for "Fly to", `F`
  and "Show in 3D". The direction's incident flow moves the camera when an incident is selected.
- **The concept render shows things the product does not have:** a fifth severity ("Info"), an Assign action, a Night
  mode toggle, a frame rate in the status bar and a site selector.
- **A colour change is a multi-file change.** `pnpm lint` runs `scripts/contrast.ts --check`, which compares copies of
  the accent and the severity colours in `tokens.css`, `styles/tokens.ts`, `public/favicon.svg`, the Keycloak theme
  (`ops/keycloak/themes/occ/…`) and `docs/design/tokens.md`; changing one without the others fails lint.
- **Who uses it:** operators on 12-hour shifts in a dark room, reading from 1–2 m, whose attention is split between the
  console, the radio and the phone (V1 brief, "Viewing conditions"). A survey of other monitoring consoles found the
  same posture in ISA-101 high-performance displays: a calm grey normal, colour and motion for the abnormal.

Constraints: dark-only (`color-scheme: dark`); WCAG contrast, and never colour alone (V1 Principle 2); no contract,
data or API change (this ADR is console-only); CSS Modules with global tokens stay as ADR-0016 decided.

## Options

**Colour**

1. **Keep periwinkle and add the direction's blue as a second accent.** Two interaction colours for one meaning, and a
   bigger palette than the 10 % accent budget allows. Rejected: it keeps the V1 constraint and ignores the direction.
2. **Adopt the palette and keep Low cyan.** Cyan then means both "Low incident" and "live data", the exact collision V1
   avoided. Rejected: a hue must not stand for two meanings.
3. **Adopt the palette and recolour Low blue, as the render does.** Blue is now the interaction accent, so a Low badge
   and a selected row would share a hue. Rejected for the same reason.
4. **Adopt the palette with Low neutral (chosen).** Severity keeps red, orange, yellow; Low is a steel tone no status
   uses, told apart by its icon and word, which V1 Principle 2 already requires everywhere.

**Camera**

5. **Keep V2's rule: nothing flies unless asked with `F`, "Fly to" or "Show in 3D".** Rejected: the direction's incident
   flow (select, focus, inspect) loses its focus step and every selection needs a second action.
6. **Fly on every selection and every arrival.** Rejected: an arriving incident moving the camera takes the view from an
   operator who is looking at something else (V2 Principle 4's reason).
7. **Fly when the operator selects from the list (chosen), never on arrival, with a setting to turn it off.**

**Type**

8. **Keep Barlow with the new sizes.** Rejected: the direction asks for a different family and the sizes are what make
   Barlow Semi Condensed's density work; mixing would leave a half-change.
9. **Geist instead of Inter.** Both are named by the direction. Inter was chosen: it is the direction's first name,
   it ships as `@fontsource-variable/inter` like today's fonts, and it has tabular figures.

**Glass**

10. **Fully glass panels (blur everywhere).** Rejected: a backdrop blur over a live WebGL canvas costs fill rate on the
    reference laptop, and the panels hold text that must stay legible.
11. **Fully opaque panels.** Rejected: it drops the depth the direction asks for.
12. **About 90 % opaque panels, blur only on small floating overlays (chosen).**

## Decision

**1. Colour carries one meaning per hue.**

| Role                | Token                                          | Meaning                                                          |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| Interaction         | `--accent` (blue)                              | Fill of a primary button, focus, selection edge; dark text on it |
| Interaction as text | `--accent-ink`                                 | Accent text and icons, tuned to pass contrast on every surface   |
| Secondary data      | `--accent-2` (violet)                          | Second chart series, hover tint                                  |
| Live data           | `--signal` (cyan)                              | Telemetry lines, a healthy device, the Live pill                 |
| Severity            | `--sev-critical`, `--sev-high`, `--sev-medium` | Red, orange, yellow, each only for that severity                 |
| Low severity        | `--sev-low` (neutral steel)                    | Low only, told apart by icon and word                            |
| System feedback     | `--success`, `--warning`, `--danger`           | Pills, banners, toasts, form errors; never on an incident        |

The values, the surface levels and the contrast table are in `docs/design/tokens.md`, produced in V3-02 and held by
`scripts/contrast.ts`; they are not decided here. Where a pair fails, the value moves, not the rule. `--warning` and
`--danger` sit close in hue to the new `--sev-high` and `--sev-critical`: V3-02 moves them or tells them apart by shape,
so "system feedback never on an incident" keeps holding. The primary button's label stays dark (`--accent` takes
neither white nor the primary text). Operators relearn one colour: Low stops being cyan, and the change is announced in
the release notes and on the map legend.

**2. V1 Principle 1 becomes "severity is the only loud _meaning_".** Interaction and live data may glow, thinly and on
purpose; a glow never stands for severity and severity never borrows the accent. Neon is an edge and a signal, not a
fill: a 1 px lit edge on the active tab, the selected control, the selected row and the open panel, and a halo on a
marker; never a glow on every card or border. Two rules follow from the survey:

- **Healthy devices are quiet.** At Medium zoom a healthy device is drawn only on hover, on selection and in the
  focused building; at Far not at all; at Near always. A device in fault or stale is always drawn. The Assets tab
  lists every device, so nothing is discoverable only by hovering.
- **Calm view.** A per-browser account-menu setting, default off, that desaturates the 3D environment (lawns, water,
  roads, trees, building faces) and nothing else: severity, labels, selection, accent, live cyan, stale and fault
  markers and every panel are untouched.

**3. V2 Principle 4 becomes "the view moves only because the operator asked".** Asking is: opening an incident from the
feed or from its search, "Fly to", `F`, `Home`, a saved view. A click on a marker in the scene, a toast's "Open
incident" and a marker on the 2D map select and do not fly. An arriving incident never moves the camera. The video
wall's exception and the sign-in backdrop's slow turn stay as V2 wrote them. The setting **Follow selection** (account
menu, on by default, per browser) turns the list's flight off; `F` still flies. This replaces, for the feed and its
search only, ADR-0020's statement that opening an incident does not fly.

**4. Glass.** Panels are about 90 % opaque with a hairline border and a deep shadow. A backdrop blur is allowed only
on small floating overlays (layers, callout, tooltip, popovers), never in the Standard and Low quality tiers and never
under `prefers-reduced-transparency`.

**5. Type and components.** One family, Inter (variable, tabular figures), for UI and body. 11 px is allowed for
secondary metadata only (timestamps, codes), never for something an operator acts on, and 12 px stays the floor for
everything else that is read from a distance. Control heights 36–40 px (32 px inside rows, never under a 24 px target),
radii 4 (chips), 8 (controls), 12 (cards, panels). Borders 1 px, low contrast; the strong border marks input
boundaries only (V1's rule).

**6. What V3 does not take from the render.** No fifth severity "Info" (the contract has four). No Assign (it needs an
assignee, an event and a permission: its own ADR, not scheduled). No Night mode (a second token set; V3 stays
dark-only). No frame rate in the status bar (a tier word instead; the number stays in the developer HUD). No site
selector (the API serves one site plan; the name is a label until a second site exists).

## Consequences

- **Operators relearn Low.** It is no longer cyan; its icon and word are unchanged. The release notes and the map legend
  say so, and whoever runs the control room is told before the change ships.
- **A token change is a multi-file change.** The accent, the severity colours and the surfaces have copies in the
  map's colours, the favicon and `theme-color` (a copy of `--surface-1`), the Keycloak theme and `tokens.md`; lint
  fails until all move together. The sign-in theme's token copies are therefore part of V3-02, its picture and layout
  stay in V3-19.
- **The heat ramp follows the accent.** V2's ramp is indigo; with a blue accent it moves, and V2's rule stands (heat
  never uses red, orange, yellow or cyan).
- **Every V1 and V2 frame and screenshot is stale** (the README's pictures are retaken in V3-20).
- **The font swap touches every width-dependent layout** (feed truncation, KPI tiles, the header): it is its own ticket
  (V3-03) so it can be reverted.
- **Follow selection changes a V2 behaviour.** A feed selection used to leave the camera alone; the V2 tests that pin
  that are rewritten in V3-17, and ADR-0020 gets an "amended by" line for it.
- **No rolling-deploy concern.** Console only: no contract, no route, no migration, no environment variable.
- **Scene realism is not decided here.** Shadows, budgets and quality tiers are the ADR-0020 amendment written in V3-11
  from measurements; token values are `tokens.md`; the Operations aids, floors and handover (V3.5) have their own
  decisions in the brief and ADR-0023 and ADR-0024.

## Decided before acceptance

Settled by the tech lead on 2026-10-21 (the brief records each, as Q1, Q3, Q4, Q6 and the principle amendments):

1. The palette follows the direction; Low becomes neutral steel (Q1).
2. Both principle amendments, as above.
3. Opening an incident from the feed flies the camera unless Follow selection is off; arrival never moves it; only the
   feed and its search fly (Q4 and the points raised in the V3 task breakdown).
4. Inter, 11–12 px metadata, 36–40 px controls, 4 / 8 / 12 radii (Q6).
5. Glass at about 90 % opacity with small blurred overlays (Q2).
6. The scene budgets are raised, the numbers set by measurement in V3-11 and recorded in an ADR-0020 amendment (Q3).
7. The accent is split into a fill and a text colour because the accent as text fails on the lighter surfaces.
8. Healthy devices are quiet and the Calm view exists (added after the survey).
9. The render's "Info", Assign, Night mode, frame rate and site selector are out of V3.

## Open at acceptance

Accepted with these four points open; none changes a decision above, and each is settled in the ticket named.

- **Inspector width.** 360 px if the incident sheet's lifecycle stepper and action bar fit (the V3 frame 02 is drawn at
  360); the tech lead judges the frame on the canvas. It is a layout value, so it does not hold up this ADR.
- **The art source** (generated in the repository, from "procedural first") is derived rather than separately answered;
  confirm in V3-00.2.
- **Follow selection's scope** (per browser, as the other account-menu switches) is to be confirmed against
  `UserMenu.tsx` in V3-17.
- **How the Low change reaches the control room** (a release-notes line and a legend entry are decided; who tells the
  shift leads is not).
