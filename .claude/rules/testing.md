---
paths:
  - '**/*.spec.ts'
  - '**/*.e2e-spec.ts'
  - '**/*.test.ts'
  - '**/*.test.tsx'
  - 'apps/api/test/**'
---

# Testing rules

## Runners and naming (verify before adding a new convention)

| Surface        | Runner                             | Files                          | Where                   |
| -------------- | ---------------------------------- | ------------------------------ | ----------------------- |
| API unit       | Jest + ts-jest                     | `*.spec.ts`                    | beside source in `src/` |
| API e2e        | Jest, `test/jest-e2e.config.js`    | `*.e2e-spec.ts`, `--runInBand` | `apps/api/test/`        |
| Console        | Vitest 4 + jsdom + Testing Library | `*.test.ts`, `*.test.tsx`      | beside source in `src/` |
| camera-adapter | Vitest                             | `src/**/*.test.ts`             | beside source           |
| Model tools    | `node:test` (no dependency)        | `*.test.ts`                    | `ops/model-tools/`      |
| Keycloak theme | `node:test` (no dependency)        | `*.test.ts`                    | `docker/keycloak/`      |

The API uses Jest and everything else Vitest. Do not unify them. The model tools use Node's own runner and are not part of `pnpm test`: `pnpm models:test`
runs them (and CI's model-check step), `pnpm models:typecheck` type-checks them. The sign-in theme's checks run the same way:
`pnpm keycloak:test` (and `pnpm keycloak:typecheck`); its colour checks are part of the console's `lint`.

## API

- Unit specs test one class or function with plain doubles; guards and pipes are exercised with real decorator
  metadata (see `auth/roles.guard.spec.ts`). Anything needing a database is an e2e spec.
- e2e specs boot the real app through `configureApp`, a real PostgreSQL (`*_test` database, `.env.test`) and the
  test OIDC issuer from `test/support/test-issuer.ts`; tokens come from `support/tokens.ts`.
- `test/setup-env.ts` turns the simulator, telemetry and rate limits **off** for every suite. A suite that tests one
  of them switches it back on for itself (`support/enable-rate-limits.ts`, `support/mqtt-broker.ts`).
- Seed data and constraints have named assertions; asserting a Postgres constraint name is deliberate.

## Console

- Use the helpers in `src/test-utils.tsx`: `renderWithQueryClient`, `createTestQueryClient` (no retries),
  `queryWrapper`, `resetStore`, the viewport stub, and the `axe` check.
- Assert roles, text and attributes (`data-variant`), never class names (ADR-0016).
- **`user-event` hangs under `vi.useFakeTimers()`.** Use `fireEvent` plus `act(() => el.focus())` in fake-timer
  blocks; keep `userEvent` on real timers.
- **Wait for React output with RTL `waitFor` / `findBy*`, never `vi.waitFor`** (fine for plain promises).
- **Wrap Zustand or socket changes made outside React in `act(...)`** before asserting on the DOM.
- **A cached incident update must carry a higher `version`**, or `mergeIncidentLists` (structural sharing in
  `useIncidents`) keeps the cached copy and the update silently does nothing.
- **Some tests name source files by path, and `tsc` cannot check those strings.** `src/realtime/twinPath.test.ts` and
  `src/twin/frameDemand.test.ts` scan the source tree and list files by path; `?raw` imports of `docs/…` and `ops/…`
  (`modelParts`, `twinBindings`, `twinMotion` tests) depend on the folder depth. When you move a file, run these tests and
  fix the literals; they fail loudly rather than pass silently.

## Running

- Filtered runs skip the contracts build: rebuild `@occ/contracts` first, or use `pnpm turbo run test --filter=…`.
- e2e is heavy (real database, in-band). Run one file at a time and prefer a pattern over the whole suite.
