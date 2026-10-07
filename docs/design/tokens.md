# Console design tokens

The console's visual vocabulary: colour, type, spacing, radii, shadows, motion, focus and layers. Approved in the
[design brief](brief.md) (UI-01), implemented in UI-03.

## Where they live

| File                                     | Holds                                                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `apps/console/src/styles/tokens.css`     | Every token as a CSS custom property on `:root`. Modules read them with `var()` (ADR-0016 §2).       |
| `apps/console/src/styles/tokens.ts`      | The map's values (`mapColors`, `mapMotion`, `layout`): MapLibre and the marker images take literals. |
| `apps/console/index.html`, `favicon.svg` | Literal copies of `--surface-1` (`theme-color`) and of three colours in the favicon.                 |

A copy outside `tokens.css` is checked against it on every lint (below), so it cannot drift silently. One exception:
the cluster count font on the map (`lib/mapImages.ts`, a copy of `--weight-semibold`, `--type-s` and `--font-ui`;
see [icons.md](icons.md#map-glyphs)).

## Which surface, which token

From the brief's surface rules:

- `--surface-0`: ground, map, inputs. `--surface-1`: header, feed, sheet. `--surface-2`: selected row, cards, action
  bar. `--surface-3`: menu, toast, banner. Camera tiles sit on `--camera-ground`.
- Text tokens pass 4.5:1 on every surface. Critical text never sits on `--surface-3` (below 4.5:1): use the icon there
  and keep the label in `--text-primary`.
- `--border-strong` marks input and control boundaries on `--surface-0` / `--surface-1` only (≥ 3:1).
  `--border-subtle` is decorative: structure comes from surfaces. So a `secondary` `Button` (its boundary is
  `--border-strong`) sits only on `--surface-0` / `--surface-1`. On `--surface-2` / `--surface-3` (action bar, toast,
  menu, banner) use `primary` or `ghost`, or add a checked pair first.
- A severity badge (`SeverityBadge`, and the checked option of a severity `SegmentedControl`) keeps its label in
  `--text-primary` on the `--sev-*-bg` tint. The hue is only on the icon, the tint and the border. The icon is held
  to 3:1 as a graphic, which is why critical (4.43:1 on its tint) passes.
- The escalated critical KPI tile (frame 04) uses the same rule on `--sev-critical-hot-bg`, an opaque 18 % mix into
  `--surface-1` (the header): count and label in `--text-primary`, the hue on the icon, the border and the
  `--sev-critical-hot-ring` glow.
- Status (`--status-*`) is neutral-based and never uses a severity hue. Severity (`--sev-*`) is the only loud colour.
- System feedback (`--success`, `--warning`, `--danger`) appears only in the connection pill, banners, toasts and
  form errors, never on an incident.
- Layers, bottom to top: `--z-sheet`, `--z-banner`, `--z-popover`, `--z-toast`, `--z-dialog` (a modal confirmation,
  over `--scrim`), `--z-session`. The session-expired banner stays above a dialog, so signing in again is always
  reachable.

## What may stay a raw value

Component CSS and TSX use tokens for colour, `font-size` / `line-height` / `font-weight`, spacing (padding, margin,
gap, offsets used as spacing), `border-radius`, `box-shadow`, `z-index`, animation durations and easing, and the
focus ring. These may stay raw:

- `@media` breakpoints: custom properties are not allowed in media queries.
- 1–3 px border, outline and stroke widths, inset `box-shadow` lines of the same widths (selected feed row, checked
  severity option), and `outline-offset`. Drop shadows always use `--shadow-*`.
- Component dimensions: `width`, `height`, `min-*`, `max-width`, `grid-template-columns`, `aspect-ratio`, `ch` and
  `vh` lengths, and the geometry of drawn graphics (lifecycle stepper dot and rail, marker pulse). The sheet's width
  is the exception: it is `--sheet-width` (440 px, frame 02), because the map pads by the same value; at ≤ 720 px the
  sheet is full-screen (`100%`). Icon sizes (14 / 16 / 18 / 20 / 22 px, the `Icon` `size` prop) count as well —
  see [icons.md](icons.md).
- MapLibre numbers in `CampusMap.tsx`, `lib/map*.ts`, `lib/geo.ts` and `lib/sitePlan.ts`: `line-width` and
  `line-dasharray`, circle radii and stroke widths, `fitBounds` padding, `easeTo` duration, zoom levels, cluster
  radius, marker offsets, the pulse frame rate and scale, the marker image geometry in `lib/mapImages.ts` (image boxes,
  disc radii, glyph sizes and strokes), and the site plan geometry in metres (boundary, roads, field markings, inset
  and row spacing). The site plan colours are map-only values in `tokens.ts` (`mapColors.site`), not tokens.
- The map tooltip's placement distances (flip below the anchor near the top, horizontal clamp) and the zone label
  halo (a 3 px `--surface-0` text stroke, frame 01).
- The simulated camera image drawn on the `CameraTile` canvas: it is picture content, not UI, and real players replace
  it (OCC-16).
- `body` `line-height: 1.45`, unitless on purpose: it scales for every element that sets only a `font-size`. A px
  value would be inherited as is.

## How the contrast is checked

`apps/console/scripts/contrast.ts` reads `tokens.css` and `tokens.ts`, computes WCAG 2.x contrast ratios, and checks
the pairs that occur in the UI (minimum 4.5:1 for text, 3:1 for meaningful boundaries) and the copied values (map
colours, the pulse duration and the sheet width in `tokens.ts`, `theme-color`, the favicon).

- `pnpm --filter @occ/console lint` runs it with `--check` and fails on a pair below its minimum or a drifted copy.
- `pnpm --filter @occ/console tokens:contrast` regenerates the tables below. Run it after changing a token and commit
  the result.

A pair marked "reported only" is published but not enforced yet, with the reason.

## Contrast

<!-- contrast:start -->

<!-- Generated by `pnpm --filter @occ/console tokens:contrast` — do not edit between the markers. -->

### Every colour token on every surface

| Token               | Value   | `--surface-0` #0c1821 | `--surface-1` #13222d | `--surface-2` #1a2d3a | `--surface-3` #223848 |
| ------------------- | ------- | --------------------- | --------------------- | --------------------- | --------------------- |
| `--text-primary`    | #e4edf3 | 15.16                 | 13.68                 | 11.96                 | 10.25                 |
| `--text-secondary`  | #a6b8c5 | 8.80                  | 7.94                  | 6.95                  | 5.95                  |
| `--text-tertiary`   | #91a5b4 | 7.06                  | 6.37                  | 5.57                  | 4.77                  |
| `--accent`          | #8c9bff | 7.06                  | 6.37                  | 5.57                  | 4.77                  |
| `--sev-critical`    | #ff5a4e | 5.84                  | 5.27                  | 4.61                  | 3.95                  |
| `--sev-high`        | #ff9f43 | 8.81                  | 7.95                  | 6.95                  | 5.96                  |
| `--sev-medium`      | #f2d04b | 11.90                 | 10.74                 | 9.39                  | 8.05                  |
| `--sev-low`         | #6cc3d5 | 8.91                  | 8.04                  | 7.03                  | 6.02                  |
| `--status-resolved` | #86bba0 | 8.24                  | 7.44                  | 6.50                  | 5.57                  |
| `--success`         | #5ccf98 | 9.27                  | 8.37                  | 7.32                  | 6.27                  |
| `--warning`         | #f0b85e | 10.03                 | 9.06                  | 7.92                  | 6.79                  |
| `--danger`          | #ff7f8a | 7.41                  | 6.69                  | 5.85                  | 5.01                  |
| `--border-strong`   | #5a7488 | 3.67                  | 3.31                  | 2.90                  | 2.48                  |
| `--border-subtle`   | #25394a | 1.51                  | 1.36                  | 1.19                  | 1.02                  |

Informational: a token is only held to a minimum on the surfaces listed below.

### Checked pairs

| Foreground          | Background                                | Ratio | Minimum | Result                                |
| ------------------- | ----------------------------------------- | ----- | ------- | ------------------------------------- |
| `--text-primary`    | `--surface-0`                             | 15.16 | 4.5     | pass                                  |
| `--text-primary`    | `--surface-1`                             | 13.68 | 4.5     | pass                                  |
| `--text-primary`    | `--surface-2`                             | 11.96 | 4.5     | pass                                  |
| `--text-primary`    | `--surface-3`                             | 10.25 | 4.5     | pass                                  |
| `--text-secondary`  | `--surface-0`                             | 8.80  | 4.5     | pass                                  |
| `--text-secondary`  | `--surface-1`                             | 7.94  | 4.5     | pass                                  |
| `--text-secondary`  | `--surface-2`                             | 6.95  | 4.5     | pass                                  |
| `--text-secondary`  | `--surface-3`                             | 5.95  | 4.5     | pass                                  |
| `--text-tertiary`   | `--surface-0`                             | 7.06  | 4.5     | pass                                  |
| `--text-tertiary`   | `--surface-1`                             | 6.37  | 4.5     | pass                                  |
| `--text-tertiary`   | `--surface-2`                             | 5.57  | 4.5     | pass                                  |
| `--text-tertiary`   | `--surface-3`                             | 4.77  | 4.5     | pass                                  |
| `--status-resolved` | `--surface-0`                             | 8.24  | 4.5     | pass                                  |
| `--status-resolved` | `--surface-1`                             | 7.44  | 4.5     | pass                                  |
| `--status-resolved` | `--surface-2`                             | 6.50  | 4.5     | pass                                  |
| `--status-resolved` | `--surface-3`                             | 5.57  | 4.5     | pass                                  |
| `--accent`          | `--surface-0`                             | 7.06  | 4.5     | pass                                  |
| `--accent`          | `--surface-1`                             | 6.37  | 4.5     | pass                                  |
| `--accent`          | `--surface-2`                             | 5.57  | 4.5     | pass                                  |
| `--accent`          | `--surface-3`                             | 4.77  | 4.5     | pass                                  |
| `--on-accent`       | `--accent`                                | 7.06  | 4.5     | pass                                  |
| `--sev-critical`    | `--surface-0`                             | 5.84  | 4.5     | pass                                  |
| `--sev-critical`    | `--surface-1`                             | 5.27  | 4.5     | pass                                  |
| `--sev-critical`    | `--surface-2`                             | 4.61  | 4.5     | pass                                  |
| `--sev-high`        | `--surface-0`                             | 8.81  | 4.5     | pass                                  |
| `--sev-high`        | `--surface-1`                             | 7.95  | 4.5     | pass                                  |
| `--sev-high`        | `--surface-2`                             | 6.95  | 4.5     | pass                                  |
| `--sev-medium`      | `--surface-0`                             | 11.90 | 4.5     | pass                                  |
| `--sev-medium`      | `--surface-1`                             | 10.74 | 4.5     | pass                                  |
| `--sev-medium`      | `--surface-2`                             | 9.39  | 4.5     | pass                                  |
| `--sev-low`         | `--surface-0`                             | 8.91  | 4.5     | pass                                  |
| `--sev-low`         | `--surface-1`                             | 8.04  | 4.5     | pass                                  |
| `--sev-low`         | `--surface-2`                             | 7.03  | 4.5     | pass                                  |
| `--sev-critical`    | `--surface-3`                             | 3.95  | 4.5     | reported only: icon only on surface-3 |
| `--success`         | `--surface-1`                             | 8.37  | 4.5     | pass                                  |
| `--success`         | `--surface-2`                             | 7.32  | 4.5     | pass                                  |
| `--success`         | `--surface-3`                             | 6.27  | 4.5     | pass                                  |
| `--warning`         | `--surface-1`                             | 9.06  | 4.5     | pass                                  |
| `--warning`         | `--surface-2`                             | 7.92  | 4.5     | pass                                  |
| `--warning`         | `--surface-3`                             | 6.79  | 4.5     | pass                                  |
| `--danger`          | `--surface-1`                             | 6.69  | 4.5     | pass                                  |
| `--danger`          | `--surface-2`                             | 5.85  | 4.5     | pass                                  |
| `--danger`          | `--surface-3`                             | 5.01  | 4.5     | pass                                  |
| `--border-strong`   | `--surface-0`                             | 3.67  | 3       | pass                                  |
| `--border-strong`   | `--surface-1`                             | 3.31  | 3       | pass                                  |
| `--text-secondary`  | `--camera-ground`                         | 9.45  | 4.5     | pass                                  |
| `map zone outline`  | `map ground`                              | 3.57  | 3       | pass                                  |
| `--text-secondary`  | `map ground`                              | 8.80  | 4.5     | pass                                  |
| `map zone outline`  | `map boundary`                            | 3.40  | 3       | pass                                  |
| `--text-secondary`  | `map boundary`                            | 8.39  | 4.5     | pass                                  |
| `--accent`          | `map boundary`                            | 6.73  | 3       | pass                                  |
| `--accent`          | `map zone building`                       | 5.01  | 3       | pass                                  |
| `--accent`          | `map zone parking`                        | 5.58  | 3       | pass                                  |
| `--accent`          | `map zone gate`                           | 4.79  | 3       | pass                                  |
| `--accent`          | `map zone outdoor`                        | 5.54  | 3       | pass                                  |
| `--sev-critical`    | `--surface-3`                             | 3.95  | 3       | pass                                  |
| `--sev-high`        | `--surface-3`                             | 5.96  | 3       | pass                                  |
| `--sev-medium`      | `--surface-3`                             | 8.05  | 3       | pass                                  |
| `--sev-low`         | `--surface-3`                             | 6.02  | 3       | pass                                  |
| `--text-primary`    | `--sev-critical-bg` over `--surface-1`    | 11.48 | 4.5     | pass                                  |
| `--text-primary`    | `--sev-high-bg` over `--surface-1`        | 10.37 | 4.5     | pass                                  |
| `--text-primary`    | `--sev-medium-bg` over `--surface-1`      | 9.61  | 4.5     | pass                                  |
| `--text-primary`    | `--sev-low-bg` over `--surface-1`         | 10.06 | 4.5     | pass                                  |
| `--sev-critical`    | `--sev-critical-bg` over `--surface-1`    | 4.43  | 3       | pass                                  |
| `--sev-high`        | `--sev-high-bg` over `--surface-1`        | 6.03  | 3       | pass                                  |
| `--sev-medium`      | `--sev-medium-bg` over `--surface-1`      | 7.55  | 3       | pass                                  |
| `--sev-low`         | `--sev-low-bg` over `--surface-1`         | 5.91  | 3       | pass                                  |
| `--status-resolved` | `--status-resolved-bg` over `--surface-1` | 5.68  | 4.5     | pass                                  |
| `--text-primary`    | `--sev-critical-hot-bg`                   | 10.99 | 4.5     | pass                                  |
| `--sev-critical`    | `--sev-critical-hot-bg`                   | 4.24  | 3       | pass                                  |
| `--text-secondary`  | `--sev-critical-bg` over `--surface-1`    | 6.67  | 4.5     | pass                                  |
| `--warning`         | `--sev-critical-bg` over `--surface-1`    | 7.60  | 4.5     | pass                                  |
| `--status-resolved` | `--sev-critical-bg` over `--surface-1`    | 6.25  | 4.5     | pass                                  |
| `--text-secondary`  | `--sev-high-bg` over `--surface-1`        | 6.02  | 4.5     | pass                                  |
| `--warning`         | `--sev-high-bg` over `--surface-1`        | 6.87  | 4.5     | pass                                  |
| `--status-resolved` | `--sev-high-bg` over `--surface-1`        | 5.64  | 4.5     | pass                                  |
| `--text-secondary`  | `--sev-medium-bg` over `--surface-1`      | 5.58  | 4.5     | pass                                  |
| `--warning`         | `--sev-medium-bg` over `--surface-1`      | 6.36  | 4.5     | pass                                  |
| `--status-resolved` | `--sev-medium-bg` over `--surface-1`      | 5.23  | 4.5     | pass                                  |
| `--text-secondary`  | `--sev-low-bg` over `--surface-1`         | 5.84  | 4.5     | pass                                  |
| `--warning`         | `--sev-low-bg` over `--surface-1`         | 6.66  | 4.5     | pass                                  |
| `--status-resolved` | `--sev-low-bg` over `--surface-1`         | 5.47  | 4.5     | pass                                  |
| `--text-primary`    | `--accent-tint` over `--surface-1`        | 10.75 | 4.5     | pass                                  |
| `--on-accent`       | `--sev-critical`                          | 5.84  | 3       | pass                                  |
| `--on-accent`       | `--sev-high`                              | 8.81  | 3       | pass                                  |
| `--on-accent`       | `--sev-medium`                            | 11.90 | 3       | pass                                  |
| `--on-accent`       | `--sev-low`                               | 8.91  | 3       | pass                                  |

### Values copied out of tokens.css

| Copy                                                 | Value                     | Must equal                | Result |
| ---------------------------------------------------- | ------------------------- | ------------------------- | ------ |
| `mapColors.ground` (src/styles/tokens.ts)            | #0c1821                   | #0c1821                   | match  |
| `mapColors.severity.critical` (src/styles/tokens.ts) | #ff5a4e                   | #ff5a4e                   | match  |
| `mapColors.severity.high` (src/styles/tokens.ts)     | #ff9f43                   | #ff9f43                   | match  |
| `mapColors.severity.medium` (src/styles/tokens.ts)   | #f2d04b                   | #f2d04b                   | match  |
| `mapColors.severity.low` (src/styles/tokens.ts)      | #6cc3d5                   | #6cc3d5                   | match  |
| `mapColors.surface1` (src/styles/tokens.ts)          | #13222d                   | #13222d                   | match  |
| `mapColors.surface3` (src/styles/tokens.ts)          | #223848                   | #223848                   | match  |
| `mapColors.accent` (src/styles/tokens.ts)            | #8c9bff                   | #8c9bff                   | match  |
| `mapColors.onAccent` (src/styles/tokens.ts)          | #0c1821                   | #0c1821                   | match  |
| `mapColors.textPrimary` (src/styles/tokens.ts)       | #e4edf3                   | #e4edf3                   | match  |
| `mapColors.textSecondary` (src/styles/tokens.ts)     | #a6b8c5                   | #a6b8c5                   | match  |
| `mapColors.textTertiary` (src/styles/tokens.ts)      | #91a5b4                   | #91a5b4                   | match  |
| `mapMotion.pulseMs` (src/styles/tokens.ts)           | 1800ms                    | 1800ms                    | match  |
| `layout.sheetWidth` (src/styles/tokens.ts)           | 440px                     | 440px                     | match  |
| `theme-color` (index.html)                           | #13222d                   | #13222d                   | match  |
| colours in public/favicon.svg                        | #0c1821, #8c9bff, #e4edf3 | #0c1821, #8c9bff, #e4edf3 | match  |

<!-- contrast:end -->
