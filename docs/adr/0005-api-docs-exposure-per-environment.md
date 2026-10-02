# ADR-0005: API docs exposure per environment

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

The API serves Swagger UI at `/api/docs` and the raw spec at `/api/docs-json` and `/api/docs-yaml`. Until now this ran unconditionally, in every environment, with "Try it out" enabled. The production image sets `NODE_ENV=production`, but the config never read it, so production served the same interactive docs as a developer laptop.

The API has no authentication yet (OCC-21). An open docs page in production hands out the complete API surface and lets anyone fire state-changing requests (report, acknowledge, resolve) from the browser. Nobody chose this; it was the development default left on.

## Options

1. **Disable docs in production** — no UI, no raw spec.
2. **Gate docs behind authentication** — the right long-term answer, impossible until the API has auth.
3. **Keep docs in production, read-only** — strip "Try it out"; the full surface of an unauthenticated API is still published.

## Decision

Option 1 by default, with option 3 as an explicit opt-in.

| Environment                         | `NODE_ENV`    | Docs served                     | Try it out |
| ----------------------------------- | ------------- | ------------------------------- | ---------- |
| Local development                   | `development` | Yes                             | On         |
| Tests                               | `test`        | Yes                             | On         |
| Production                          | `production`  | No — `/api/docs*` returns `404` | —          |
| Production, `API_DOCS_ENABLED=true` | `production`  | Yes                             | Off        |

`NODE_ENV` and `API_DOCS_ENABLED` are validated in `Env`; an unknown `NODE_ENV` value fails boot. The Docker Compose stack is a demo, not a production deployment: it sets `API_DOCS_ENABLED=true`, and because the image runs `NODE_ENV=production` the page is read-only there.

Consumers lose nothing: the console builds against `@occ/contracts`, and the spec stays published in the repository as `docs/api/openapi.json`.

## Consequences

- A production deploy that forgets about docs gets the safe posture: nothing served.
- Turning docs on in production is a visible, reviewable config change, and still cannot execute requests.
- Revisit when OIDC sign-in lands (OCC-21): option 2 becomes possible, and the spec should then document the auth scheme.
