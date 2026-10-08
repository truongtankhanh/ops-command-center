# Console design brief

Status: **approved** (UI-01, 2026-10-05). Mockups: [Ops Console Mockups](https://claude.ai/artifact/LMhi5bcJE5xxdLMbR6qHJP)
(design canvas, private until shared from its Share menu). Source of every frame:
[mockups/](mockups/) — `Main.dc.html` is frame 00, the rest are numbered like the frames. They render
on the canvas only (they load its `support.js` runtime); read them for markup and values, not in a
browser.

This brief fixes the look of `apps/console` before any styling task starts, so UI-02 … UI-19 implement
a design instead of inventing one per PR. Every later UI task links the frame it implements (see
[Frame index](#frame-index)).

## Users

| Role (ADR-0011) | Who                                      | What they do in the console                                                                       |
| --------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `operator`      | Night-shift operator in the control room | Watches the feed and map, reports incidents, acknowledges and resolves them, checks cameras       |
| `supervisor`    | Shift lead                               | Same rights as an operator today; reads the console to see what the shift is handling             |
| `viewer`        | Management, other teams, a video wall    | Follows incidents, map and cameras; never changes anything — every screen has a view-only variant |

## Viewing conditions

- Dark room, 12-hour shift: low overall luminance, no large bright areas, nothing that flickers.
- Read from 1–2 m on a large display, and at arm's length on a laptop: condensed type for density, 13 px
  is the smallest text, numbers are tabular.
- Attention is split between the console, radio and phone: what needs action must be findable without
  reading, and must not rely on colour alone.

## Principles

1. **Severity is the only loud colour.** One cool accent for interaction; status uses shape, icon and
   neutral tones, never the severity hue.
2. **Never colour alone.** Severity and status always carry an icon and text (WCAG 1.4.1).
3. **Depth over lines.** Four surface levels with shadows; borders only where they carry meaning.
4. **One scale for everything.** 4 px spacing grid, one type scale, three radii, three shadows.
5. **Motion serves attention.** Arrival, selection and escalation animate; nothing else does. Everything
   respects `prefers-reduced-motion`.
6. **Stable layout.** Detail, report form and toasts overlay the stage; the map never resizes.
7. **Role-aware, not role-broken.** A hidden action never leaves a hole; the view-only state is
   designed and explained. The API's 403 stays the real control.

## References

The family is control-room software — Grafana, Genetec Security Center, Milestone XProtect: dark, calm,
dense, colour only where it means something. The mockups borrow the posture, not any product's layout
or visual identity.

## Decisions

### Accent: periwinkle `#8c9bff`

| Option                     | Why not / why                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Teal / cyan                | The obvious control-room accent, but `--sev-low` is already cyan (`#6cc3d5`): a selected row and a low-severity badge would read the same. Rejected.               |
| Near-white (today)         | Primary buttons are the brightest thing on screen and look like disabled light panels. Rejected.                                                                   |
| **Periwinkle `#8c9bff`** ✓ | Hue sits between the severity hues and none of them; 7.1:1 on ground, 4.8:1 on the lightest surface; dark text on it is 7.1:1. Used for buttons, focus, selection. |

### Icon set: Lucide (`lucide-react`)

Tree-shakeable, one consistent 24 px / 2 px-stroke grid, and it covers every contract value (see the
icon map on the foundations frame). Licence is **ISC**, not MIT as `console-ui-plan.md` says — still
permissive, but UI-04 should state it correctly. Wrap it in a local `Icon` component so the set can be
swapped. Map markers render the same glyphs (MapLibre `addImage()` in UI-08).

### Type: keep Barlow Semi Condensed (UI) + Barlow (body)

Already bundled through `@fontsource`, condensed enough for a dense feed and header, with tabular
figures. Replacing it would cost bundle and visual churn for no gain in legibility. Scale: 12 / 13 / 14 /
15 (body) / 16 / 20 / 24 / 32.

## Proposed tokens (input to UI-03)

Contrast ratios against each surface, computed with the WCAG 2.x formula. UI-03 commits the script that
produces this table.

| Token               | Value     | surface-0 `#0c1821` | surface-1 `#13222d` | surface-2 `#1a2d3a` | surface-3 `#223848` |
| ------------------- | --------- | ------------------- | ------------------- | ------------------- | ------------------- |
| `--text-primary`    | `#e4edf3` | 15.2                | 13.7                | 12.0                | 10.3                |
| `--text-secondary`  | `#a6b8c5` | 8.8                 | 7.9                 | 7.0                 | 6.0                 |
| `--text-tertiary`   | `#91a5b4` | 7.1                 | 6.4                 | 5.6                 | 4.8                 |
| `--accent`          | `#8c9bff` | 7.1                 | 6.4                 | 5.6                 | 4.8                 |
| `--sev-critical`    | `#ff5a4e` | 5.8                 | 5.3                 | 4.6                 | **3.9 — icon only** |
| `--sev-high`        | `#ff9f43` | 8.8                 | 8.0                 | 7.0                 | 6.0                 |
| `--sev-medium`      | `#f2d04b` | 11.9                | 10.7                | 9.4                 | 8.1                 |
| `--sev-low`         | `#6cc3d5` | 8.9                 | 8.0                 | 7.0                 | 6.0                 |
| `--status-resolved` | `#86bba0` | 8.2                 | 7.4                 | 6.5                 | 5.6                 |
| `--success`         | `#5ccf98` | 9.3                 | 8.4                 | 7.3                 | 6.3                 |
| `--warning`         | `#f0b85e` | 10.0                | 9.1                 | 7.9                 | 6.8                 |
| `--danger`          | `#ff7f8a` | 7.4                 | 6.7                 | 5.9                 | 5.0                 |
| `--border-strong`   | `#5a7488` | 3.7                 | 3.3                 | 2.9                 | 2.5                 |
| zone outline        | `#56728a` | 3.6                 | —                   | —                   | —                   |

Replaces the failing tokens of today: `--text-faint` `#5f7887` (2.7–3.9), `--resolved` `#6f8f7f`
(3.4–5.1), zone outline `#3b5668` (2.1).

Rules that follow from the table:

- Critical text never sits on `surface-3` (menus, toasts, banners); use the icon there and keep the
  label in `--text-primary`.
- `--border-strong` marks input boundaries on `surface-0` / `surface-1` only (≥ 3:1). Structure uses
  surfaces and `--border-subtle`, which is decorative.
- System feedback (`--success`, `--warning`, `--danger`) appears only in pills, banners, toasts and form
  errors — never on an incident. This replaces the raw `#4fd18b` "live" green and the critical red reused
  for the offline state and the session banner.
- Surfaces: `surface-0` ground, map and inputs; `surface-1` header, feed, sheet; `surface-2` selected
  row, cards, action bar; `surface-3` menu, toast, banner. Camera tiles keep their own `#070f15`.
- Spacing 4 / 8 / 12 / 16 / 20 / 24 / 32; radii 4 (chips) / 6 (controls) / 10 (cards, toasts); shadows
  1 (bars) / 2 (map controls) / 3 (sheet, menu, toast). Focus ring: 2 px `--accent`, 2 px offset.

The full set lives in the `:root` block of [mockups/console.css](mockups/console.css), ready to lift
into `tokens.css`.

## Frame index

| Frame                                    | Shows                                                                                        | Implemented by                    |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------- |
| 00 Foundations                           | Surfaces, contrast, accent, buttons, `Kbd`, severity badges/KPI/markers, status, type, icons | UI-03, UI-04, UI-05               |
| 01 Overview — operator, nothing selected | Shell, KPI tiles, connection pill, clock, feed with search/tabs/counts, map, camera strip    | UI-06, UI-07, UI-08, UI-09, UI-13 |
| 02 Incident selected — detail sheet      | Sheet over the stage, map panned (not resized), lifecycle stepper, metrics, timeline, note   | UI-10, UI-11                      |
| 03 Report incident — pick on map         | Type grid, severity segmented control with icons, pick-on-map pin, zone highlight            | UI-12                             |
| 04 Critical incident arrives             | Persistent critical toast, escalated KPI tile, highlighted row, pulsing marker               | UI-14, UI-07                      |
| 05 Offline — live updates paused         | Offline pill, "paused since" banner with retry, "as of" notice in the feed                   | UI-15                             |
| 06 Viewer — incident open, user menu     | No Report / Acknowledge / Resolve; designed view-only footer; user menu; offline camera tile | UI-06, UI-11, UI-13               |
| 07 Session expired — banner over a draft | Session banner above the sheet; the half-filled report stays                                 | UI-15                             |
| 08–11 Sign-in screens                    | Signing in / out, sign-in failed, no access, insecure context                                | UI-15                             |
| — Display modes, density (no frame)      | Wall ≥ 1920 / 3200 px, laptop, tablet, phone fallback, compact — screenshots in the UI-17 PR | UI-17                             |

## Interaction decisions taken in the mockups

- **Detail and report are one overlay sheet (440 px; × `--ui-scale` on a wall, UI-17) at every width.** It
  covers the right of the stage, camera strip included; the strip already puts the incident's cameras first, so
  they stay visible on the left. The map pans to keep the selection beside the sheet (UI-10).
- **Escape with a non-empty draft shows a hint, not a confirm dialog**: "Esc keeps your note. Close
  discards it." Keeps today's rule (Escape never discards; Close / Cancel do) and adds feedback (UI-10).
- **Map controls move to the bottom-right**, so toasts and banners own the top of the stage.
- **Shortcuts** `N` report, `/` search, `A` acknowledge, `R` resolve, `Esc` close are shown as `Kbd`
  hints and are ignored while focus is in a text field. `?` opens a list of every key, also reachable from the account
  menu. The single-key ones (`N`, `/`, `A`, `R`, `?`) can be turned off in the account menu, for speech input
  (WCAG 2.1.4); their hints go with them (UI-16).
- **Feed row:** severity icon tile, type icon + title, age (warning colour and clock icon once an open
  incident passes its attention threshold, see [Approved decisions](#approved-decisions)), status chip,
  zone, code. The type is an icon next to the title, not a
  text column — the 368 px feed cannot fit both.
- **KPI tiles are the severity filter** (`aria-pressed`); an active filter shows as a removable chip.
- **Critical toast persists until dismissed**; high-severity toasts auto-dismiss. Sound is off by
  default and is a per-user toggle in the user menu.
- **Viewer:** the user menu says why actions are missing; the sheet ends in a view-only footer instead
  of a gap.

## Approved decisions

The questions this brief left open, decided on 2026-10-05:

1. **Accent: periwinkle `#8c9bff`.** The only hue clear of the severity set (red, orange, yellow, cyan),
   of `--success` green and of the `--danger` / critical reds; AA on every surface.
2. **Session texts: two secondary lines are added; the existing texts stay unchanged** (so the
   assertions in `AuthGate.test.tsx` hold).
   - Session-expired banner: "Signing in again reloads the console — unsent notes and reports will be
     lost." The draft mockup said the draft would stay, which is false: "Sign in again" calls
     `signinRedirect()` (`apps/console/src/auth/session.ts`), a full navigation to Keycloak.
   - No-access screen: "Signed in as {displayName}", so an administrator knows which account needs a
     role.
3. **Attention threshold: fixed constants now, not waiting for SLA (OCC-26).** Applies only to
   **open** (unacknowledged) incidents; acknowledging clears it. Critical 2 min, high 5 min, medium
   15 min, low 30 min — starting values to confirm with operations before UI-07. One constant in
   `apps/console/src/lib/incidents.ts`, named an attention threshold, not an SLA: display only, nothing
   enforces it server-side. OCC-26 later replaces it with the server's SLA.
4. **The sheet covers the full stage height, camera strip included.** One behaviour at every width (at
   ≤ 1100 px the detail is already a full-height overlay); stopping above the strip would leave about
   670 px for stepper, timeline and action bar; the strip lists the incident's zone cameras first, so
   they stay in the uncovered part, and the sheet has its own zone cameras.

### Follow-up outside UI work

Keeping drafts across "Sign in again" is an authentication change, not a UI one: either sign in again
in a popup (`signinPopup`, the page never unloads) or persist drafts before the redirect. Persisting a
report draft also has to persist its `Idempotency-Key` with it, or a retry after sign-in could create a
duplicate (ADR-0009). Track it as its own `IMP-` task; until then the banner text above tells the
truth.

## Found while preparing this brief

- `public/favicon.svg` uses `#ff9f43` — the high-severity orange — as its accent dot, which breaks
  principle 1. The mockups' brand mark uses the accent; update the favicon and `theme-color` in UI-03 /
  UI-06.
