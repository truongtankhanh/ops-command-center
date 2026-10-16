# Ops Command Center

<!-- INIT-CONTEXT:START:project-snapshot -->

## Project Snapshot

A real-time operations command center for a campus: live incidents on a map, camera tiles, an audited
incident lifecycle, and (V2) equipment telemetry with a 3D digital-twin console. The reference scenario is a
fictional campus and all data is synthetic, but the production guards are real (see Watch Out For).

V2 direction: asset catalogue + MQTT telemetry + three.js twin — ADR-0018 … ADR-0021 and
`docs/design/v2/brief.md`.

<!-- INIT-CONTEXT:END:project-snapshot -->

<!-- INIT-CONTEXT:START:tech-stack -->

## Tech Stack

| Surface  | Stack                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------- |
| Repo     | pnpm 10 workspaces + Turborepo, Node 24 (`.nvmrc`), TypeScript ~5.9 strict                         |
| API      | NestJS 12, TypeORM on PostgreSQL 17, Socket.IO, `mqtt`, `jose` (OIDC), pino, Prometheus client     |
| Console  | React 19, Vite 8, TanStack Query 5, Zustand 5, MapLibre GL, `oidc-client-ts`, CSS Modules          |
| Packages | `@occ/contracts` and `@occ/camera-adapter`, built with `tsup` to ESM + CJS                         |
| Identity | Keycloak 26 (demo realm in `ops/keycloak`); roles `operator`, `supervisor`, `technician`, `viewer` |
| Tests    | Jest 30 + ts-jest (API), Vitest 4 + Testing Library + axe (console, camera-adapter)                |
| Delivery | Docker Compose (api, postgres, keycloak, console + nginx), GitHub Actions                          |

<!-- INIT-CONTEXT:END:tech-stack -->

<!-- INIT-CONTEXT:START:architecture -->

## Architecture at a Glance

- **Five workspaces.** `apps/api`, `apps/console`, `packages/contracts`, `packages/camera-adapter`, and the demo
  device simulator `ops/telemetry-sim`. Apps never import other apps; both sides of a contract change land in one PR
  (ADR-0001). The simulator carries a catalogue and a waveform copy that a spec in the API keeps in step.
- **Contracts first.** Domain types, event names and the role → permission map live in `@occ/contracts`; the API and
  the console both read them.
- **Ports and adapters.** `CameraSource` (mock | MediaMTX) and `TelemetrySource` (mock | mqtt | off) are chosen once
  at startup from env (ADR-0002, ADR-0019).
- **Incident events.** Written to a transactional outbox in the same transaction as the change, relayed over Postgres
  `NOTIFY` to every replica, broadcast on the Socket.IO `/events` namespace; clients order by `version`
  (ADR-0007, ADR-0008).
- **Telemetry.** MQTT in, best-effort `/telemetry` namespace out, latest reading wins (ADR-0019).
- **Auth.** Every route needs an OIDC token from the configured issuer; permissions are checked server-side (ADR-0010,
  ADR-0011). nginx in front of the API is the only edge.

Design in full: `docs/architecture.md`; decisions: the ADR table in `README.md`.

<!-- INIT-CONTEXT:END:architecture -->

<!-- INIT-CONTEXT:START:directory-map -->

## Directory Map

| Path                                           | Purpose                                                                                                                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/<feature>/`                      | One NestJS module per feature: `assets`, `auth`, `cameras`, `incidents`, `sites`, `telemetry`, `zones`, `realtime`, `outbox`, `simulator`, `health`, `metrics`, `logging`, `rate-limit` |
| `apps/api/src/common/`                         | Domain errors, the exception filter, geo helpers                                                                                                                                        |
| `apps/api/src/config/`                         | Env validation (`env.validation.ts`) and env-file lookup                                                                                                                                |
| `apps/api/src/database/`                       | Data source, `migrations/`, `seed/`, advisory locks, migrate-on-boot                                                                                                                    |
| `apps/api/test/`                               | e2e specs (`*.e2e-spec.ts`), global setup, `support/` (test issuer, MQTT broker, tokens)                                                                                                |
| `apps/console/src/components/`                 | Feature components, each with its `.module.css`                                                                                                                                         |
| `apps/console/src/ui/`                         | Primitives (Button, Dialog, Sheet, Toast …) and the icon map `icons.ts`                                                                                                                 |
| `apps/console/src/lib/`                        | Pure logic and small hooks (map, incidents, shortcuts, density …)                                                                                                                       |
| `apps/console/src/twin/`                       | The 3D twin (three.js, R3F): the only code that imports them, loaded lazily (ADR-0020)                                                                                                  |
| `apps/console/src/{api,realtime,auth,styles}/` | REST client + query keys, socket hooks, OIDC, tokens and global CSS                                                                                                                     |
| `apps/console/scripts/`                        | `contrast.ts`: checks design tokens (runs in `lint`)                                                                                                                                    |
| `packages/contracts/src/`                      | `domain.ts`, `api.ts`, `events.ts`, `auth.ts`                                                                                                                                           |
| `packages/camera-adapter/src/`                 | `CameraSource` port, mock and MediaMTX implementations                                                                                                                                  |
| `ops/`                                         | Keycloak realm, Prometheus config, Grafana dashboard                                                                                                                                    |
| `docs/`                                        | `adr/`, `api/` (reference + `openapi.json`), `design/`, `architecture.md`, `roadmap.md`                                                                                                 |

Specs sit next to the code they test (`*.spec.ts` in the API, `*.test.ts(x)` elsewhere).

<!-- INIT-CONTEXT:END:directory-map -->

<!-- INIT-CONTEXT:START:conventions -->

## Conventions

- **TypeScript:** strict, `noUncheckedIndexedAccess`, `noImplicitOverride`. Prettier: single quotes, trailing commas,
  100 columns. Format with `pnpm format`.
- **Imports:** `consistent-type-imports` is enforced everywhere except `apps/api`, where Nest DI needs value imports.
  The console imports icons only through `src/ui/icons.ts` (ESLint-enforced).
- **Naming:** files are kebab-case in the API and PascalCase for console components; one `.module.css` per
  component; migrations are `<epoch>-<kebab-name>.ts` with class `Name<epoch>`.
- **Errors:** services throw `DomainError` subclasses; one filter turns them into the `ApiError` body. Never throw
  raw status codes from domain code.
- **Validation:** class-validator DTOs with unknown fields rejected; server-side authorization only.
- **Config:** read through the validated `Env`, never `process.env` directly.
- **Comments** explain why and cite the ADR; many files do. Keep that habit.
- Path-specific rules are in `.claude/rules/` and load automatically.

<!-- INIT-CONTEXT:END:conventions -->

<!-- INIT-CONTEXT:START:commands -->

## Common Commands

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm docker:up                              # postgres :15432, keycloak :18081 (loopback); also docker:down, docker:restart
pnpm dev                                    # API :13000 (metrics :9464), console :15173
                                            # the 3D view is on in `pnpm dev`; elsewhere only with ?twin=1 until V2-19.8

pnpm format:check && pnpm lint && pnpm typecheck && pnpm build
                                            # build also fails if the 3D twin's lazy chunk is over its gzip budget (ADR-0020)
pnpm test                                   # unit: Jest (API), Vitest (console, camera-adapter)
pnpm test:e2e                               # API against real PostgreSQL
pnpm --filter @occ/api migration:generate src/database/migrations/<name>
pnpm --filter @occ/api log-level show       # runtime log level (ADR-0014)
pnpm docker:stack                           # whole stack on :18080 (docker compose up --build)
pnpm ci:local [--fast|--skip-e2e|...]       # ci.yml's steps on this machine (own Compose project, throttled)
pnpm ci:off | ci:on | ci:status              # switch GitHub Actions CI with the CI_ENABLED variable (needs gh or a token)
```

- **e2e prerequisites:** `cp apps/api/.env.test.example apps/api/.env.test` and a database whose name ends in
  `_test` (the suite drops and rebuilds the schema). It runs `--runInBand`.
- **Filtered runs skip the contracts build.** After editing `packages/contracts/src`, run
  `pnpm --filter @occ/contracts build`, or use `pnpm turbo run test --filter=@occ/api`.
- Env variables: full table in `README.md` (Running locally).

<!-- INIT-CONTEXT:END:commands -->

<!-- INIT-CONTEXT:START:git-workflow -->

## Git Workflow

- Default branch `main`; one short-lived branch per ticket: `<type>/<TICKET>-<kebab-slug>`
  (`feat/V2-06.5-mqtt-telemetry-source`, `refactor/V2-06.2-extract-socket-handshake`).
- Conventional Commits with scope and ticket, squash-merged through a PR:
  `feat(api): V2-06.4 validate readings and hold each asset's latest state (#57)`.
  Scopes in use: `api`, `console`, `contracts`, `ops`, `design`, `adr`. Breaking change: `feat(api)!:`.
- CI (`.github/workflows/ci.yml`) runs format, lint, typecheck, unit, e2e and build, then boots the Compose stack
  with two API replicas and probes it. All of it must pass before merge.

<!-- INIT-CONTEXT:END:git-workflow -->

<!-- INIT-CONTEXT:START:watch-out-for -->

## Watch Out For

- **Production guards are invariants, not demo defaults.** With `NODE_ENV=production` and no `DEMO_MODE`, the API
  refuses mock cameras, mock telemetry, seeding, `http`/`mqtt://` URLs and a missing `DEPLOYMENT_ENV`; production
  never allows `RATE_LIMIT_ENABLED=false`. Do not loosen them or add a default that boots without them (ADR-0006).
- **Migrations are append-only** and must be registered in `database/typeorm-options.ts`; `synchronize` is off.
  An edited, already-applied migration changes nothing on existing databases.
- **Contracts resolve from `dist/`.** A value-only contract change is invisible to `typecheck` and shows up as test
  failures until `@occ/contracts` is rebuilt.
- **A new env variable touches several files** — validation, both `.env` examples, Compose, the README table, the
  ADR. A new secret also goes into the log redaction list.
- **Incident events must all arrive; readings only the latest.** Do not route telemetry through the outbox, or
  incident events through the best-effort path.
- **Rate limits and advisory lock keys** have one home each (`rate-limit/rate-limits.ts`,
  `database/advisory-locks.ts`); lock numbers must never change.
- **Console async tests** have known pitfalls (fake timers vs `user-event`, `waitFor`, `act`) — see
  `.claude/rules/testing.md`.
- **Never link tracked docs to per-developer working directories** (`docs/plan`, `docs/audit`, `docs/test`, …):
  they are git-excluded.

<!-- INIT-CONTEXT:END:watch-out-for -->

<!-- INIT-CONTEXT:START:references -->

## Deeper References

| Need                                   | Where                                                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Run it, env variables, operations      | `README.md`                                                                                     |
| System design, domain model, real-time | `docs/architecture.md`                                                                          |
| Why a decision was made                | `docs/adr/` (index table in `README.md`)                                                        |
| Endpoints, events, error shapes        | `docs/api/README.md`, `docs/api/openapi.json`                                                   |
| UI and V2 design, tokens, icons        | `docs/design/`, `docs/design/v2/brief.md`                                                       |
| Milestones                             | `docs/roadmap.md`                                                                               |
| Path-specific rules                    | `.claude/rules/`: `api`, `database`, `console`, `packages`, `testing`, `config-and-ops`, `docs` |

<!-- INIT-CONTEXT:END:references -->

<!-- INIT-CONTEXT:START:compact-instructions -->

## Compact Instructions

When compacting (automatic or manual), preserve:

- The current ticket ID / branch / slug being worked on, if any.
- Which persistent artifact file is in progress — a path under
  `docs/plan/`, `docs/review/`, `docs/test/`, `docs/context/`,
  `docs/audit/`, `docs/debug/`, or `docs/tickets/` — and which phase or
  batch was last completed in it.
- Do not preserve full file contents or diffs already written to disk —
  those files are the source of truth and can be re-read; only the
  pointer to which one is active, and where progress left off, needs to
  survive compaction.

<!-- INIT-CONTEXT:END:compact-instructions -->
