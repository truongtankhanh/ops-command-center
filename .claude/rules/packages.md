---
paths:
  - 'packages/**/*.ts'
---

# Shared packages rules

## `@occ/contracts`

- It is the API ↔ console contract: domain types (`domain/`, one file per context; `domain/index.ts` re-exports them and the
  package root re-exports that), REST shapes (`api.ts`), socket event names and payloads
  (`events.ts`: `/events`, `/telemetry`), roles, permissions and the role → permission/category maps (`auth.ts`).
  It has no runtime dependencies and no tests; keep it that way.
- **Consumed from `dist/` only** (`exports` points at the `tsup` output). After any edit run
  `pnpm --filter @occ/contracts build`; `pnpm --filter <app> test|typecheck` does not do it for you, and a value-only
  change passes typecheck while tests fail. `pnpm turbo run <task> --filter=<app>` builds dependencies first.
- **Additive by default.** Enum lists (incident types, zone kinds, uses, roles) are only appended: the API's
  migrations and old consoles still see old values. Removing or renaming a value is a breaking change and needs an
  ADR and a `!` commit.
- A contract change lands together with both sides that use it, in one PR (ADR-0001).
- Splitting or moving a contract file is not a contract change if the built public surface is byte-identical: compare the
  runtime keys (CJS and ESM) and the exported names of `dist/index.d.ts` and `dist/index.d.cts` before and after.
- Event names are constants (`IncidentEvents`, `TelemetryEvents`); never repeat a string literal in the apps.

## `@occ/camera-adapter`

- `CameraSource` is the port (`camera-source.ts`): `kind` and `resolveStream(camera)`. Implementations
  (`mock-camera-source.ts`, `mediamtx-camera-source.ts`) decide where video comes from; callers never do.
  Selection happens in `create-camera-source.ts` from configuration (ADR-0002).
- Export new public symbols from `src/index.ts`; the apps import only the package root.
- Tests are Vitest, `src/**/*.test.ts`, beside the code.

## Build

- Both packages build with `tsup` to ESM + CJS + `.d.ts` because NestJS consumes CJS and Vite consumes ESM.
- `typescript` and build settings extend `tsconfig.base.json`; do not add a dependency on an app.
