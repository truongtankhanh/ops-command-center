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

| Accessor           | Value                                                                                         | Glyph                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `severityIcon`     | `critical` / `high` / `medium` / `low`                                                        | `OctagonAlert` / `TriangleAlert` / `CircleAlert` / `Info`                                |
| `incidentTypeIcon` | `intrusion` / `fire_alarm` / `equipment_fault` / `medical` / `crowding` / `suspicious_object` | `DoorOpen` / `Flame` / `Wrench` / `HeartPulse` / `Users` / `Package`                     |
| `statusIcon`       | `open` / `acknowledged` / `resolved`                                                          | `CircleDot` / `UserCheck` / `CircleCheck`                                                |
| `eventKindIcon`    | `reported` / `acknowledged` / `resolved`                                                      | `Flag` / `UserCheck` / `CircleCheck` (same meaning as the status, same glyph)            |
| `zoneKindIcon`     | `building` / `parking` / `gate` / `outdoor`                                                   | `Building2` / `SquareParking` / `Fence` / `Trees`                                        |
| `actorKindIcon`    | `user` / `system`                                                                             | `User` / `Cpu`                                                                           |
| `connectionIcon`   | `live` / `connecting` / `reconnecting` / `offline`                                            | `Radio` / `RefreshCw` / `RefreshCw` / `WifiOff` (`connecting` is the first connect only) |
| `cameraIcon`       | `online: true` / `false`                                                                      | `Video` / `VideoOff`                                                                     |

Generic UI glyphs, re-exported by name from `icons.ts`: `Plus`, `X`, `Search`, `Eye`, `Lock`, `Clock`, `Volume2`,
`ChevronDown`, `LogOut`.

`medium` and `low` share the circle and differ only by the inner mark. Severity always comes with its label (brief,
principle 2), so this is accepted; UI-16 re-checks it.

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

- **Size:** `14 | 16 | 18 | 20 | 22`, default 18 — the sizes the mockups use. They are component dimensions, so they
  stay numbers (see [tokens.md](tokens.md#what-may-stay-a-raw-value)).
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

## Map glyphs (for UI-08)

MapLibre cannot render React components, and the offline map style has no sprite or `glyphs` URL, so map icons have
to be registered as images with `map.addImage()`. They use the **same `Glyph` components** — no second icon pipeline.
This is the route UI-08 implements and tests; UI-04 ships no map code.

1. **SVG markup from the component.** Render the glyph with the already-bundled `react-dom/client`: `createRoot` on a
   detached element, `flushSync(() => root.render(<Glyph … />))`, read `innerHTML`, `root.unmount()`. Do it in the
   map's `load` handler, once per glyph — not during render or in a layout effect (`flushSync` warns there).
2. **Raster.** SVG markup → data URL → `HTMLImageElement`, sized at `devicePixelRatio` so markers stay sharp.
3. **Register.** `map.addImage('glyph-<domain>-<value>', image, { pixelRatio, sdf: true })`, e.g.
   `glyph-type-fire_alarm`.
4. **Colour.** As SDF images, glyphs are recoloured with `icon-color`. Colours come from
   `apps/console/src/styles/tokens.ts`, because MapLibre cannot read CSS custom properties; UI-08 adds the severity
   hues and `--on-accent` there (the contrast check catches drift from `tokens.css`). The severity disc under the glyph
   is its own `circle` layer. The mockups stroke map glyphs at 2.6 px — pass that `strokeWidth` when rendering for the
   map.
5. **Fallback.** If SDF glyphs look soft at 13–14 px, register one pre-coloured image per glyph × colour actually used
   instead (4 severities × 6 types at most).

Rejected routes:

- Lucide's per-icon data (`__iconData`): exists only in the package's internal modules, not in its public exports —
  private API that can change in any release.
- `react-dom/server` `renderToStaticMarkup`: would add the server renderer to the client bundle for a few strings.
- A second package (`lucide`, `lucide-static`): a second dependency, kept in version step by hand, for the same
  glyphs.
