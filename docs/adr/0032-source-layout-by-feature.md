# ADR-0032: Source is grouped by feature inside the existing layers, with relative imports and a lint-guarded layering

- **Status:** Accepted 2026-10-22
- **Date:** 2026-10-22
- **Context documents:** [ADR-0001](0001-monorepo-pnpm-turborepo.md), [ADR-0016](0016-console-css-modules.md),
  [ADR-0020](0020-digital-twin-rendering-and-model-pipeline.md)

## Context

The monorepo is organised by workspace (ADR-0001) and the console by layer (`ui/`, `components/`, `lib/`, `twin/`; ADR-0016,
ADR-0020). That worked while the console was small. Measured on 2026-10-22:

| Area                               | Shape today                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `apps/console/src/lib/`            | 95 source files in one folder (12.5k lines); 51 of them are 3D logic (`twin*`, `useTwin*`)  |
| `apps/console/src/components/`     | 50 loose files beside `wall/`, the only folder that groups by feature                       |
| `apps/api/src/telemetry/`          | 24 files: sources, ingest, rule evaluation, sample persistence and the gateway together     |
| `apps/api/src/database/`           | infrastructure and `seed/` together; it imports 8 files from `assets/`, 7 from `incidents/` |
| `packages/contracts/src/domain.ts` | 427 lines holding six domains                                                               |

A reader cannot tell from the tree which files belong together, and every contract change lands in the same file.

Constraints that shape the options:

- **The 3D toolchain is fenced by a lint pattern on the folder name.** `three`, `@react-three/*` and `three-mesh-bvh` are
  importable only under `src/twin/`, and `**/twin/*` / `**/twin` may be imported statically from nowhere else
  (ADR-0020, `apps/console/eslint.config.mjs`). A new folder named `twin` elsewhere would fail lint. Ten pure
  `twin*` helpers are imported from outside `twin/`, so they cannot move into it.
- **Every import is relative** (1,792 edges in the console, 534 in the API, no path alias). Any move rewrites many lines, and some
  paths are strings that the compiler does not check (`vi.mock`, `?raw` imports of repository files, two tests that scan the
  source tree by path, two API specs that read files by `__dirname` depth).
- **`@occ/contracts` is consumed from `dist/` and is additive** (`packages.md`): its public surface must not change.
- **Migrations are append-only and registered by path in `database/typeorm-options.ts`**; advisory-lock numbers never change.
- Git history must stay usable across moves.

## Options

**Console organisation**

1. **Feature folders inside the existing layers**: `lib/<feature>/`, `components/<feature>/`; `ui/`, `api/`, `realtime/`, `auth/`,
   `styles/`, `twin/` unchanged.
2. **Feature slices**: `features/<name>/{components,lib}`. Closer to a textbook, but it rewrites ADR-0016 and ADR-0020 wording, the lint
   configuration and the rule files, and moves CSS ownership. Measured coupling does not call for it: between the proposed `lib/`
   folders there are about 50 imports in total, and most cross-folder imports go to `ui/` or from `twin/` to `lib/`.
3. **Leave it flat.** The folders keep growing.

**Imports**

1. **Keep relative imports**, rewritten by a script.
2. **A `@/` alias**: needs `tsconfig`, Vite, Vitest and ESLint changes and a second pass over every import.
3. **Barrel files** (`index.ts` per folder): hide the dependency graph and invite cycles.

**API `telemetry/`**: (a) sub-folders by role inside the one Nest module; (b) several Nest modules. (b) changes the provider graph and
dependency injection, which is a behaviour risk for a layout change.

**Contracts**: (a) `domain/<context>.ts` re-exported by `domain/index.ts`; (b) also split `api.ts` and `events.ts` (74 and 183 lines,
not worth it); (c) a second package entry point, which breaks "the apps import only the package root".

## Decision

1. **Console: feature folders inside the existing layers** (option 1). Planned folders: `lib/{twin-core,map,assets,telemetry,incidents,wall,shell,shared,cameras}`
   and `components/{incidents,assets,map,stage,cameras,telemetry,auth,shell,wall}`. `shell/` holds cross-cutting UI concerns
   (shortcuts, density, display mode), `shared/` holds generic helpers (time, `useNow`, users).
2. **A folder is never named with the bare segment `twin` outside `src/twin/`.** The pure 3D logic is `lib/twin-core/`, the 2D/3D switch and its
   banners are `components/stage/`. The lint patterns of ADR-0020 stay as they are.
3. **Imports stay relative.** No alias, no barrel files.
4. **The layering is enforced where it costs nothing**: `src/lib/**` may not import `src/components/**` (nor `twin/`, nor `three`, nor
   `lucide-react`). It was true of all 95 files when the rule was added. `ui/` imports `lib/` today, so no rule is added for it.
5. **API: `telemetry/` gets sub-folders by role** (`sources/`, `ingest/`, `rules/`, `samples/`, `gateway/`) inside the same module.
   Entities stay with their owning feature (`telemetry-point.entity.ts`, `telemetry-rule.entity.ts` stay in `assets/`, ADR-0018);
   migrations, `typeorm-options.ts`, `advisory-locks.ts` and `data-source.ts` do not move. Lifting `seed/` out of `database/` is allowed
   but optional.
6. **Contracts: `domain.ts` becomes `domain/<context>.ts`** (geo, incident, zone, camera, site-plan, telemetry, asset). The package
   `index.ts` is unchanged and the built public surface (runtime keys and `.d.ts` export names, ESM and CJS) must be byte-identical.
7. **Moves are mechanical and separate from edits**: per batch, one commit that only `git mv`s files with their tests and CSS modules,
   one that rewrites paths by script, no logic change in the same pull request. A move is accepted when the import graph, mapped through
   the move list, equals the graph before it.
8. **`src/twin/` internals are not reorganised by this decision.** It is cohesive and already a boundary; any change there is decided
   separately, with the chunk budget measured before and after.

## Consequences

- A feature's code can be found by folder in both apps, and a folder is small enough to scan. `lib/twin-core/` (about 50 files) and
  `src/twin/` stay larger on purpose: each is one concern.
- Relative paths get longer (`../../lib/map/mapLayers`). That is the accepted price of not adding an alias.
- The `twin` naming constraint is now a rule of the layout, written in `.claude/rules/console.md`. A reviewer who sees a new `twin/`
  folder outside `src/twin/` should ask for another name.
- The layering rule makes one direction mechanical. Mutual imports between feature folders (for example `map` and `assets`) exist and are
  accepted: folders are not packages.
- `git blame` and `git log` lose continuity across a move unless the reader follows it. Use `git log --follow -- <path>`, and
  `git config blame.ignoreRevsFile .git-blame-ignore-revs`; the mechanical commits are listed in that file.
- Tracked documents that name moved files (`docs/api` `Source:` lines, ADR path mentions, rules, `CLAUDE.md`) are updated in the pull
  request that moves them. Accepted ADRs get path-only edits; their decisions are not rewritten.
- Branches opened before a move conflict with it. Git follows a rename on rebase when the file itself is unchanged, so most of the cost
  is rebasing import lines.
- Not decided here: an alias or barrel files later, a `features/` slice layout (option 2) if cross-folder coupling grows, reorganising
  `src/twin/`.

## Addendum 2026-10-23: as built

The decision was carried out without change to it. What the work showed:

- **Done:** `packages/contracts/src/domain/` (seven context files and an index); `apps/api/src/telemetry/` in `sources/`, `ingest/`,
  `rules/`, `samples/` and `gateway/`; `apps/console/src/lib/` in nine folders (`twin-core` holds 52 files, one more than planned because
  `useSelectionTarget` wraps `twinSelection` and is used only by 3D code); `apps/console/src/components/` in eight new folders beside
  `wall/` (none holds more than 12 source files, none is left loose).
- **Not done, by choice:** lifting `seed/` out of `database/` (decision 5 left it optional) and any change inside `src/twin/` (decision 8).
- **The `twin` naming constraint did not bite.** The ADR-0020 lint patterns matched neither `lib/twin-core/` nor `components/stage/`.
- **The method held.** After every batch the import graph mapped through the move list equalled the graph before it (console 1,792
  edges, API 534), the public surface of `@occ/contracts` was byte-identical (runtime keys in ESM and CJS, exported names in
  `index.d.ts` and `index.d.cts`), and the API still had no runtime import cycle between files. Unit tests stayed at the same
  totals (API 50 suites, console 197 files / 5,161 tests).
- **The twin chunk grew by 4 bytes** (350,997 B to 351,001 B of the 375,000 B budget), after the last console batch. Moving `Tips` changed
  its path, which feeds the CSS-module class name hash that the 3D tooltip uses; this is a cause worked out from how the hash is built,
  not measured separately.
- **Two string references to moved files remain on purpose:** two comments in the migration `1791880200000-telemetry-sample.ts` still
  name `telemetry/telemetry-sample-writer.service.ts` and `telemetry/sample-partitions.ts`. Migrations are append-only, so they were not edited.
- **A tool that rewrites only module specifiers needs a check on the rest:** the codemod does not see paths in CSS or prose, so every
  batch ended with a search for the old path in code, tests, comments and tracked documents.
