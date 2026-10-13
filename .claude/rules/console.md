---
paths:
  - 'apps/console/src/**/*.{ts,tsx,css}'
---

# Console (React + Vite) rules

## Styling (ADR-0016)

- Each component owns a co-located `Component.module.css`, imported as `styles`; class names are camelCase.
- Global CSS is only `styles/tokens.css` (custom properties) and `styles/base.css` (reset, focus ring,
  `[data-severity] → --sev`). No other global class.
- **Variants and state are attributes, not modifier classes:** `.button[data-variant='primary']`,
  `.tab[aria-selected='true']`. Tests assert roles, text and attributes, never class names.
- Use `var(--token)`; do not hard-code colours, spacing or type sizes. A copy of a token outside `tokens.css` is
  checked on lint. After changing a token run `pnpm --filter @occ/console tokens:contrast` and commit the regenerated
  `docs/design/tokens.md`.
- Sizes scale with `--ui-scale` (wall modes); write them as `calc(<px> * var(--ui-scale))` like the existing tokens.

## Structure

- `ui/` holds primitives with no domain knowledge; `components/` holds feature components; `lib/` holds pure logic
  and small hooks with their tests beside them.
- Glyphs come from `src/ui/icons.ts` only; importing `lucide-react` anywhere else fails lint.
- Server state is TanStack Query with keys from `queryKeys` in `api/queries.ts` (reference data uses
  `staleTime: Infinity`). UI state is the Zustand store in `store.ts`. Realtime goes through `realtime/`, not through
  ad-hoc sockets in components.
- Browser storage is optional: wrap reads and writes in `try/catch` and render correctly without it (see
  `lib/shortcuts.ts`).
- Types, event names and permission checks (`hasPermission`, `hasPermissionFor`) come from `@occ/contracts`. The
  console hides what a role cannot do, but the API enforces it.
- Render unknown enum values safely (types, kinds, uses, roles can be added server-side first).

## Accessibility

- Single-character keyboard shortcuts must stay switchable (WCAG 2.1.4); register them with `useShortcut` and list
  them in `lib/shortcuts.ts` so the help dialog stays true.
- `App.a11y.test.tsx` and the `axe` helper in `test-utils.tsx` guard regressions; new interactive components get a
  role-based test.
- `lint` also runs `scripts/contrast.ts --check`; a failing contrast pair is a lint failure.
