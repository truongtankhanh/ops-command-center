# ADR-0006: Configuration and secrets per environment

- **Status:** Accepted
- **Date:** 2026-10-02
- **Amended by:** [ADR-0014](0014-structured-logging-and-correlation.md) (`DEPLOYMENT_ENV`; runtime log level)

## Context

The API validates its environment once, at boot, through the `Env` class (`apps/api/src/config/env.validation.ts`). Every call site reads it through `ConfigService`. Around that core, five things were left to chance:

- **Which `.env` file loads** depended on the working directory (`@nestjs/config` defaults to `process.cwd()/.env`).
- **The e2e suite read the developer's `.env`.** `AppModule` loads and validates config when it is imported, before `beforeAll` runs, so the suite's own `DATABASE_URL` fallback never applied. The suite then dropped the `public` schema of whatever database `.env` pointed at, which is normally the local development database. Its `SEED_ON_BOOT` / `SIMULATOR_ENABLED` overrides were ignored for the same reason.
- **The TypeORM CLI bypassed validation.** `data-source.ts` read `DATABASE_URL` raw and silently fell back to a hardcoded local connection string.
- **Production defaults were demo defaults.** Unset `CAMERA_SOURCE` meant `mock` and unset `SEED_ON_BOOT` meant `true`, even under `NODE_ENV=production`. A deploy that forgot one variable would boot with synthetic cameras and seed the fictional campus into a real database, and nothing would report it.
- **Nothing said where secrets come from** outside a laptop, or what staging is. The only secret today is the password inside `DATABASE_URL`.

## Decision

### 1. One env file per mode, anchored to the API, and real env always wins

`envFilePath()` (`apps/api/src/config/env-files.ts`) resolves `apps/api/.env`, or `apps/api/.env.test` when `NODE_ENV=test`, relative to the code rather than the working directory. Both the Nest app and the TypeORM CLI use it. `override` stays off: a variable set by the shell, CI or the platform always beats the file. `.env` and every `.env.*` except `*.example` are gitignored and kept out of the Docker build context.

Considered: the `@nestjs/config` default (depends on cwd, which was the bug), and a `.env.${NODE_ENV}.local` → `.env.${NODE_ENV}` → `.env` cascade (flexible, but nothing needs it yet).

### 2. One validation path

The TypeORM CLI loads the same file with Node's built-in `process.loadEnvFile` (which never overwrites a variable that is already set) and runs the same `validateEnv` as the app. There is no fallback: a missing or malformed `DATABASE_URL` stops the migration with the same key-naming error. `DATABASE_URL` must be a `postgres://` or `postgresql://` URL.

Considered: requiring developers to export `DATABASE_URL` before every migration command (no file loading). It is simpler code, but every developer pays for it on every run.

### 3. Tests never touch a non-test database

- Under Jest, `NODE_ENV=test` selects `.env.test`, copied from the tracked `.env.test.example`.
- `test/setup-env.ts` runs as Jest `setupFiles`, before the spec imports `AppModule`, so its overrides actually reach `ConfigService`.
- Before dropping the schema, the suite refuses any database whose name does not end in `_test`.
- CI keeps injecting a throwaway `…/ops_test` URL and never sees a staging or production secret.

Considered: `ignoreEnvFile` under test (every developer must export variables by hand, and a stale shell export is easy to miss), and a mocked `ConfigService` (not viable, because the e2e suite needs a real database).

### 4. Production refuses demo behaviour unless the deploy opts in

| `NODE_ENV`                      | `CAMERA_SOURCE` unset | `CAMERA_SOURCE=mock` | `SEED_ON_BOOT` unset | `SEED_ON_BOOT=true` |
| ------------------------------- | --------------------- | -------------------- | -------------------- | ------------------- |
| `development`, `test`           | `mock`                | allowed              | `true`               | allowed             |
| `production`                    | **boot fails**        | **boot fails**       | `false`              | **boot fails**      |
| `production` + `DEMO_MODE=true` | **boot fails**        | allowed              | `false`              | allowed             |

`DEMO_MODE=true` is the explicit opt-in. Only the Docker Compose demo sets it, because the image runs `NODE_ENV=production`. Every failure names the key, never a value.

Considered: environment-aware defaults without the opt-in (`CAMERA_SOURCE=mock` would still boot silently in production), and leaving defaults as they were (the gap stays open).

### 5. Environments and where their values come from

`NODE_ENV` has no default: a process that does not set it fails at boot rather than running as development. Developers set it in `apps/api/.env`, Jest sets `test`, and the image sets `production`. Staging is not a separate `NODE_ENV`. It runs the production image with `NODE_ENV=production`, and it differs from production only in the values injected into it.

| Environment       | `NODE_ENV`    | `DEPLOYMENT_ENV` (ADR-0014) | Values come from                                                     |
| ----------------- | ------------- | --------------------------- | -------------------------------------------------------------------- |
| Local development | `development` | `local` (default)           | `apps/api/.env`, copied from `.env.example` (placeholders)           |
| Tests (local)     | `test`        | `test` (default)            | `apps/api/.env.test`, copied from `.env.test.example`; shell wins    |
| CI                | `test`        | `test` (default)            | Job-level `env:` with a throwaway Postgres container; no `secrets.*` |
| Compose demo      | `production`  | `demo`                      | Inline values in `docker-compose.yml`, plus `DEMO_MODE=true`         |
| Staging           | `production`  | `staging` (required)        | Platform secret injection; no `.env` file in the container           |
| Production        | `production`  | `production` (required)     | Platform secret injection, scoped to this service; no `.env` file    |

**Amendment (ADR-0014).** `DEPLOYMENT_ENV` is a label, not a second behaviour axis: it is stamped on every log line as `env` and changes nothing else, so the `APP_ENV` rejection below still stands. It has no default in production, so a staging deploy cannot be tagged `production` by omission.

The image reads environment variables only and contains no `.env`. Whatever runs it (orchestrator, PaaS, secret manager integration) injects `DATABASE_URL` and owns its rotation. The specific secret manager stays open until there is a deploy target; choosing one is a separate decision.

Considered: an `APP_ENV` variable next to `NODE_ENV` (a second environment axis, and ADR-0005 would have to pick one), adding `staging` to `NODE_ENV` (Express and other libraries treat any value other than `production` as development mode), and choosing a vendor now (no platform to choose for).

### 6. Lifecycle

Configuration is resolved once at boot (`ConfigModule` with `cache: true`) and is immutable for the life of the process. Nothing hot-reloads; changing a value means restarting the process.

**Amendment (ADR-0014).** One runtime override exists, and it is not configuration: the log level can be raised for a limited time through the `log_level_override` table, which every replica polls. `Env` itself stays immutable.

## Consequences

- A production deploy that forgets a variable fails at boot with the key's name, instead of running with demo behaviour. **This is breaking** for any production deploy that relied on the old defaults: it must set `CAMERA_SOURCE`, and also `DEMO_MODE=true` if it really wants `mock` or seeding.
- `pnpm test:e2e` needs a one-off local setup (`.env.test` and an `ops_test` database). It can no longer wipe the development database, even if `.env.test` is misconfigured.
- Migrations fail loudly instead of targeting `localhost` when `DATABASE_URL` is missing.
- Revisit when a deploy target exists (choose the secret manager and write it down here), or when a value needs to change without a restart (that would need a lifecycle section with the mechanism and its risk window).
