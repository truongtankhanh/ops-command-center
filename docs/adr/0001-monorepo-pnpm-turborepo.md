# ADR-0001: Monorepo with pnpm workspaces and Turborepo

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

The system has two deployable apps (API, operator console) that must agree on the same contract: incident shapes, enum values, WebSocket event names. A second front-end (a read-only video wall) is planned. In a multi-repo setup, a contract change means coordinated releases across repositories and a window where the two sides disagree.

## Options

1. **Separate repositories** with a published `contracts` package — strong isolation, but every contract change is a release + upgrade cycle.
2. **Monorepo with npm/yarn workspaces only** — shared code works, but every task runs for every package on every change.
3. **Monorepo with pnpm workspaces + Turborepo** — shared code, strict dependency isolation (pnpm), and task caching / affected-only execution (Turborepo).
4. **Nx** — powerful, but brings generators, plugins and conventions that this team size does not need.

## Decision

Option 3. `apps/*` for deployables, `packages/*` for shared code. Turborepo pipelines: `build`, `lint`, `typecheck`, `test`, each depending on the upstream `build` of workspace dependencies.

## Consequences

- A contract change and both sides of it land in **one pull request**, reviewed and tested together.
- pnpm's strict `node_modules` prevents an app from importing a package it has not declared.
- CI time stays flat as the repo grows thanks to Turborepo caching.
- Cost: packages need a build step (`tsup`) so both CommonJS (NestJS) and ESM (Vite) consumers can use them.
- Rule enforced by review: apps never import from other apps.
