---
paths:
  - 'apps/api/src/config/**'
  - 'apps/api/.env*.example'
  - 'docker-compose.yml'
  - '**/Dockerfile'
  - 'ops/**'
  - '.github/**'
---

# Configuration and operations rules

## Adding or changing an environment variable

One validated path (ADR-0006): `config/env.validation.ts`. Touch these together, in the same PR:

1. `Env` class in `env.validation.ts` with a validator and a doc comment. Environment-dependent defaults go in
   `applyEnvironmentDefaults`; demo-only behaviour that production must refuse goes in `productionProblems`
   (lifted by `DEMO_MODE`); limits that `DEMO_MODE` must not lift go in their own check, like the rate-limit one.
2. `env.validation.spec.ts`: valid, invalid and production cases.
3. `apps/api/.env.example` (commented, with the default) and `.env.test.example` if tests are affected.
4. `docker-compose.yml`: pass it through only if the demo stack needs it, and say why in a comment.
5. `README.md`: the variable table under "Running locally" and, if relevant, the Compose paragraph.
6. The ADR that owns it (ADR-0006 for config and secrets, ADR-0019 for telemetry).
7. If it holds a secret: add its name to `logging/redaction.ts` and `redaction.spec.ts`.

## Invariants

- Production has no defaults for `CAMERA_SOURCE`, `TELEMETRY_SOURCE` or `DEPLOYMENT_ENV`; mock sources, seeding,
  `http` issuers and `mqtt://` need `DEMO_MODE=true`; `RATE_LIMIT_ENABLED=false` is refused outright. Do not add a
  fallback that lets a forgotten value boot.
- Config is fixed for the life of the process. Secrets come from the platform environment, never from the repo.
- Tests never read `apps/api/.env`; they read `.env.test`.

## Compose, images, CI

- Compose is the demo stack: it sets `DEMO_MODE`, `DEPLOYMENT_ENV=demo` and demo credentials. Host ports bind to
  loopback; the API publishes none and is reached through the console's nginx, which is what lets `--scale api=2`
  work (ADR-0008).
- The metrics port (9464) is for the Compose network only; nginx never proxies it and no host port may publish it
  (ADR-0015). CI asserts both.
- The API image runs `NODE_ENV=production` as user `node`; its `HEALTHCHECK` uses liveness, never readiness
  (ADR-0013).
- CI order: format, lint, typecheck, the model checks (`models:typecheck`, `models:check`, `models:test`), test,
  test:e2e, build, then the `images` job. Keep new checks in the right job
  and make each failure name itself in the log.
- `ops/keycloak/occ-realm.json` is re-imported on every start; roles and demo users change there, not at runtime.
