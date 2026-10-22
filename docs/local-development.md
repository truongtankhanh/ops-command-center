# Local development: Docker and tests

How to run the stack in Docker and how to run the API and console tests on your machine. It is a task-oriented
companion to the [README](../README.md) (which has the full environment-variable table) and to
[`.claude/rules/testing.md`](../.claude/rules/testing.md) (the testing conventions).

## Prerequisites

| Tool                   | Version | Notes                                                                 |
| ---------------------- | ------- | --------------------------------------------------------------------- |
| Node                   | 24      | `nvm install` reads `.nvmrc`                                          |
| pnpm                   | 10      | `corepack enable`; the exact version is pinned in `package.json`      |
| Docker with Compose v2 | recent  | Postgres and Keycloak for development, the whole stack, the e2e suite |

```bash
pnpm install
```

## Where the Docker files are

Everything Docker is under [`docker/`](../docker/):

```
docker/
  docker-compose.yml          the demo stack
  api/Dockerfile              one Dockerfile per image
  console/Dockerfile          (+ nginx.conf, the edge)
  telemetry-sim/Dockerfile
  keycloak/                   demo realm, the `occ` login theme, its checks
  prometheus/ grafana/        observability profile
  mosquitto/                  telemetry profile
```

The Compose file is **not** at the repository root, so a bare `docker compose …` finds nothing there. Use the
scripts, which pass `-f docker/docker-compose.yml` for you:

| Command                       | What it does                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `pnpm docker:up`              | Starts `postgres` and `keycloak` only: what `pnpm dev` and the tests need     |
| `pnpm docker:down`            | Stops and removes the containers and the network; the database volume stays   |
| `pnpm docker:restart`         | Recreates `postgres` and `keycloak` (an edited realm is imported again)       |
| `pnpm docker:stack`           | Builds and starts the whole stack in the foreground: <http://localhost:18080> |
| `pnpm docker:stack:telemetry` | The whole stack over real MQTT: adds `mosquitto` and `telemetry-sim`          |
| `pnpm docker:stack:replicas`  | The same with two API replicas behind nginx                                   |
| `pnpm docker:compose <args>`  | Any other Compose command, e.g. `pnpm docker:compose logs api`                |

Relative paths inside the Compose file resolve against `docker/`; `context: ..` is the repository root. Dockerfiles
are built from that root, and `.dockerignore` stays there because it belongs to the build context.

### Ports

| Service  | Address           | Override        |
| -------- | ----------------- | --------------- |
| postgres | `127.0.0.1:15432` | `POSTGRES_PORT` |
| keycloak | `127.0.0.1:18081` | `KEYCLOAK_PORT` |
| console  | `127.0.0.1:18080` | `CONSOLE_BIND`  |
| grafana  | `127.0.0.1:13001` | `GRAFANA_PORT`  |

The API publishes no host port in Compose; it is reached through the console's nginx. Changing `POSTGRES_PORT`
means changing `DB_PORT` in `apps/api/.env` (and `.env.test`) to match.

### Optional profiles

```bash
pnpm docker:compose --profile observability up --build --scale api=2      # Prometheus + Grafana
pnpm docker:stack:telemetry                                               # Mosquitto + device simulator, TELEMETRY_SOURCE=mqtt
```

### Resetting

`pnpm docker:down` keeps the `pgdata` volume. To start from an empty database:

```bash
pnpm docker:compose down -v
```

## Developing against Docker (Postgres + Keycloak)

The usual loop runs the API and console on the host and only the dependencies in Docker.

```bash
cp apps/api/.env.example apps/api/.env      # once; the defaults match the Compose ports
pnpm docker:up                              # Postgres :15432, Keycloak :18081
pnpm dev                                    # API :13000 (metrics :9464), console :15173
```

Sign in at <http://localhost:15173> as `operator`, `supervisor`, `technician` or `viewer`; each password is the
username. Keycloak takes 20–60 s to become ready on first start. If sign-in fails right after `docker:up`, wait and
reload.

`pnpm dev` builds `@occ/contracts` and `@occ/camera-adapter` first (Turborepo `dependsOn: ["^build"]`).

## Running the tests

> The e2e suite is heavy (a real database, run in band) and the unit suites fan out over workers. On a laptop,
> run one workspace or one file at a time instead of the whole monorepo, and cap the workers.

### Contracts must be built first

`@occ/contracts` resolves from `dist/`. A filtered run (`pnpm --filter …`) does **not** rebuild it, and a
value-only change to a contract is invisible to `typecheck` and shows up as confusing test failures. After editing
`packages/contracts/src`:

```bash
pnpm --filter @occ/contracts build
```

or run through Turborepo, which builds dependencies for you: `pnpm turbo run test --filter=@occ/api`.

### API unit tests (Jest)

Specs are `*.spec.ts`, beside the code in `apps/api/src/`. They need no database.

```bash
pnpm --filter @occ/api test --maxWorkers=2                       # all API unit specs, two workers
pnpm --filter @occ/api test src/incidents/incidents.service.spec.ts   # one file
pnpm --filter @occ/api test -t "acknowledge"                     # by test name
```

Do not put `--` between the script and Jest's flags (`test -- --maxWorkers=2`): pnpm forwards the `--` to Jest, which then reads
everything after it as file patterns and finds no test ("No tests found"). Write the flags straight after the script name.

### API e2e tests (Jest, real PostgreSQL)

Specs are `*.e2e-spec.ts` in `apps/api/test/`. They boot the real app against a real database, drop and rebuild its
schema, and **refuse to run unless the database name ends in `_test`**. They never read `apps/api/.env`; they read
`apps/api/.env.test`.

One-off setup:

```bash
cp apps/api/.env.test.example apps/api/.env.test
pnpm docker:up                                                       # Postgres must be running
pnpm docker:compose exec postgres createdb -U postgres ops_test
```

Run (the script already passes `--runInBand`):

```bash
pnpm --filter @occ/api test:e2e test/incidents.e2e-spec.ts       # one file: the default
pnpm --filter @occ/api test:e2e                                      # the whole suite: slow, run it deliberately
```

Raise `LOG_LEVEL` in `.env.test` to debug one failing case; tests log at `warn` by default.

### Console tests (Vitest + Testing Library)

Specs are `*.test.ts` and `*.test.tsx`, beside the code in `apps/console/src/`.

```bash
pnpm --filter @occ/console test                                      # all console tests
pnpm --filter @occ/console exec vitest run src/lib/incidents.test.ts # one file
pnpm --filter @occ/console exec vitest run --maxWorkers=2            # cap the workers
```

Before writing async console tests, read the pitfalls in [`.claude/rules/testing.md`](../.claude/rules/testing.md):
`user-event` hangs under fake timers, `waitFor` must be RTL's, and store or socket changes outside React need `act`.

### Other suites

| Suite                         | Command                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------- |
| camera-adapter, telemetry-sim | `pnpm --filter @occ/camera-adapter test`, `pnpm --filter @occ/telemetry-sim test` |
| 3D model checks               | `pnpm models:check`, `pnpm models:test`, `pnpm models:typecheck`                  |
| Keycloak theme                | `pnpm keycloak:test`, `pnpm keycloak:typecheck`                                   |

Model and Keycloak tests use Node's own runner and are not part of `pnpm test`; CI runs them in their own steps.

### Static checks

```bash
pnpm format:check    # Prettier (pnpm format writes)
pnpm lint            # ESLint; the console's lint also checks design-token contrast
pnpm typecheck
pnpm build           # also fails if the 3D twin's lazy chunk is over its gzip budget
```

### Everything CI runs, on your machine

```bash
pnpm ci:local --fast          # format, lint, typecheck, unit tests
pnpm ci:local --only images   # build the images and boot the stack with two API replicas
pnpm ci:local                 # the whole workflow
```

The images job runs under its own Compose project (`occ-ci-local`) and ports, so it never touches the volumes of
`pnpm docker:up`. It does need port 18080: stop `pnpm docker:stack` first. Details and options are in the
[README](../README.md#running-ci-on-your-machine-and-switching-githubs-ci-off).

## Reading history across file moves

Source files are sometimes moved without any other change (for example the source-layout refactor). Follow a file past
its move with `git log --follow -- <path>`. To keep `git blame` pointing at the real author rather than the move, tell git
about the repository's list of mechanical commits once per clone:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

## Troubleshooting

| Symptom                                                     | Cause and fix                                                                                      |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `no configuration file provided: not found`                 | A bare `docker compose` at the root. Use `pnpm docker:compose …` or `-f docker/docker-compose.yml` |
| Port 15432 or 18081 already in use                          | Set `POSTGRES_PORT` / `KEYCLOAK_PORT`, and match `DB_PORT` / `OIDC_JWKS_URL` / `KEYCLOAK_URL`      |
| e2e refuses to start: database name must end in `_test`     | `DB_NAME` in `apps/api/.env.test` must be `ops_test` (create it with `createdb`, above)            |
| Tests fail after a contract change but `typecheck` is green | `@occ/contracts` `dist/` is stale: `pnpm --filter @occ/contracts build`                            |
| The API refuses to boot with an `OIDC_*` message            | Copy the `OIDC_*` lines from `apps/api/.env.example` into your existing `.env`                     |
| Edited the Keycloak realm and nothing changed               | The realm is imported on start: `pnpm docker:restart`                                              |
| Images job stops at its first step                          | Port 18080 is taken by `pnpm docker:stack`; stop it                                                |
