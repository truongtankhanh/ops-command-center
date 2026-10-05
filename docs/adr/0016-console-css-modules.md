# ADR-0016: Console styling with CSS Modules over global design tokens

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

The console had one global stylesheet, `apps/console/src/styles/app.css` (924 lines). It styled every component through about a hundred global class names (UI-02 in the console UI plan). Each feature appended to it (IMP-09 added the sign-in screens and the session banner, IMP-10 the timeline actor and "View only"). Nothing kept one component's rules away from another's:

- `.detail`, `.detail-toprow` and `.detail-title` styled both the incident detail and the report form. The form then overrode the title with `.report-form .detail-title`.
- `.button` was restyled by position (`.session-user .button`, `.session-banner .button`). A change for one place could reach every button.

The redesign (UI-03 to UI-19) rewrites most of these rules over many PRs, so styles need to be owned per component first.

Constraints that shaped the decision:

- **Plain CSS today.** Custom properties for colours and fonts, and `data-*` / ARIA attributes for state (`data-status`, `data-severity`, `aria-selected`, `aria-current`).
- **Severity colour crosses components.** `[data-severity] → --sev` is read by the feed, the detail, the map markers and the report form's segmented control.
- **MapLibre builds DOM imperatively.** Markers and zone labels are elements created in effects, with a class name set in code, and `maplibre-gl.css` styles the same elements.
- **Tests run with `test.css: false`.** Vitest then returns a proxy for `*.module.css` whose class names are `_<local>_<hash>`, not the source name.
- **The repo enables `noUncheckedIndexedAccess`.** Vite types a CSS Module as an index signature, so `styles.x` is `string | undefined`.
- **No new dependency without a reason.** The console bundles only what it runs.

## Decision

### 1. CSS Modules, with the Vite built-in support

Each component owns a co-located `Component.module.css`, imported as `styles`. Local class names are camelCase (`styles.severityStrip`), so no `localsConvention` setting is needed. No dependency and no build configuration is added.

Considered:

- **Keep one global file with a naming convention (BEM).** No migration, but the convention is not enforced. The collisions above already happened under a convention.
- **Tailwind.** A new dependency and build plugin, and every `className` and rule rewritten. The tokens would be restated in Tailwind's theme. A pixel-identical migration is not realistic, and the redesign would start from a second vocabulary.
- **Runtime CSS-in-JS (styled-components, Emotion).** New dependencies, and styles injected at render time in a console that re-renders the header every second and the feed every 15 s. styled-components has been in maintenance mode since 2025.
- **Zero-runtime CSS-in-JS (vanilla-extract, Linaria).** A build plugin and styles written in TypeScript. That moves away from plain CSS for no gain over modules.

### 2. A global layer of tokens and element defaults only

`styles/app.css`, imported once in `main.tsx`, only imports two global files:

- `tokens.css`: the `:root` custom properties. Modules read them with `var()`, so UI-03 can change tokens without touching module syntax.
- `base.css`: reset, `body`, `button`, the focus ring, and `[data-severity] → --sev`.

No other global class exists. Third-party CSS (`maplibre-gl.css`, `@fontsource`) stays imported where it is used.

### 3. Shared modules until the UI primitives exist

Three modules in `styles/` are imported by more than one component:

| Module              | Classes                                        | Replaced by (console UI plan)          |
| ------------------- | ---------------------------------------------- | -------------------------------------- |
| `button.module.css` | `button`                                       | `Button` (UI-05)                       |
| `panel.module.css`  | `panel`, `toprow`, `title`, `actions`, `error` | `Sheet` (UI-05, UI-10)                 |
| `text.module.css`   | `appTitle`, `empty`, `muted`                   | identity (UI-06), `EmptyState` (UI-05) |

They are deleted when their replacement lands. A new shared style goes into a primitive, not into a fourth shared module.

### 4. Variants and state are attributes, not modifier classes

A variant is a `data-*` or ARIA attribute on the element, selected next to the local class: `.button[data-variant='primary']`, `.row[data-status='resolved']`, `.tab[aria-selected='true']`. This follows the existing `data-status` / `data-severity` pattern, and it gives tests a stable contract:

- Tests assert roles, text and attributes, never class names. `IncidentDetail.test.tsx` asserts `data-variant="primary"` instead of the former `button-primary` class.
- End-to-end and visual tests (IMP-17, UI-19) select the same way, since built class names are hashed.

### 5. The cascade never depends on bundle order

Vite orders module CSS by the import graph, and a new import elsewhere can change that order. So:

- Overriding a class from another module uses higher specificity, never a later rule of equal specificity: `.form .title` for the report form's title, `.sessionUser button` and `.sessionBanner button` for the buttons in the header and the session banner.
- A module does not set a property that third-party CSS sets on the same element. `.maplibregl-marker` sets `position: absolute` on every marker. The `position: relative` that `.incident-marker` declared was always overridden, and was dropped.

### 6. Imperative DOM and inline styles

- Elements built outside JSX (MapLibre markers, zone labels) take their class from the module: `el.className = styles.incidentMarker!`. The `!` is needed because of `noUncheckedIndexedAccess`.
- Static styling is never an inline `style` prop. The legend swatches, the camera tile's `<figure>` margin and the detail's severity casing moved into their modules. A `style` prop stays acceptable only for values computed at runtime.

Considered:

- **Typed CSS Modules (`typescript-plugin-css-modules`, or generated `.d.ts`).** These turn a misspelt class into a compile error and remove the `!`. They add a dev dependency or a codegen step, and the editor plugin does not affect `tsc`. Deferred: revisit if a missing class reaches review.

## Consequences

- The migration changed no rendered style. The production CSS before and after was compared rule by rule, with module names mapped back to the old classes. The only differences are the declarations listed in §5 and §6, and keyframe names now scoped to their module.
- Built class names are hashed (`_button_1yptv_3`). DevTools still shows the local name in them. Nothing outside a component can select its classes.
- `app.css` contains no rules. Adding a global class is a review flag.
- The three shared modules are temporary, and their removal is part of UI-05, UI-06 and UI-10.
- **Revisit** when:
  - the primitives move to a `packages/ui` package (roadmap OCC-20): the package then ships its own CSS, and the consuming apps must import it;
  - a second theme (light mode, control-room wall) is added: tokens are already custom properties, so it should be a `tokens.css` change, with no module change;
  - class-name typos become a real source of bugs: add typed CSS Modules (§6).
