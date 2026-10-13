---
paths:
  - 'apps/api/src/database/**'
  - 'apps/api/src/**/*.entity.ts'
---

# Database rules (PostgreSQL + TypeORM)

## Migrations

- **Migrations only.** `synchronize` is off and `migrationsRun` is false; the app applies migrations itself at boot
  under an advisory lock (`migrate-on-boot.ts`, ADR-0004).
- **Append-only.** Never edit a migration that has been merged; add a new one. A second `ADD COLUMN` for something an
  earlier migration added fails every boot.
- **Naming and registration.** `database/migrations/<epoch>-<kebab-name>.ts`, class `Name<epoch>` with
  `name = 'Name<epoch>'`. Generate with `pnpm --filter @occ/api migration:generate src/database/migrations/<name>`,
  then **add the class to `migrations` in `typeorm-options.ts`**: migrations are listed explicitly, not globbed.
- **Literals, not contract lists.** A migration must keep doing what it did when it first ran, so it spells out enum
  values instead of importing them from `@occ/contracts`. Contract enums are only ever appended (ADR-0021).
- **Name every constraint** (`uq_…`, `…_check`); the e2e suite asserts the name Postgres reports. Prefer CHECK
  constraints over free text for closed sets.
- **Lock awareness.** The session sets `statement_timeout` 15 s and `lock_timeout` 5 s (`typeorm-options.ts`).
  Describe in a comment which locks a migration takes and what waits for them; prefer new empty tables over
  rewriting large ones.
- Reserved words must be quoted in raw SQL (`"limit"` on `telemetry_rule`).

## Entities and seed

- A new entity goes into the `entities` array in `typeorm-options.ts`; entity specs (`*.entity.spec.ts`) cover
  invariants that do not need a database.
- Seed data lives in `database/seed/` and only runs when `SEED_ON_BOOT` is on; production needs `DEMO_MODE` for that.
  Seeding is idempotent and top-up capable (`seed.service.ts`); keep new seed data deterministic and keyed by `code`.
- New advisory lock keys are added to `AdvisoryLocks` in `database/advisory-locks.ts`; existing numbers never change
  (old and new replicas run side by side during a deploy).

## Tests

- e2e specs drop and rebuild the schema, so the database name must end in `_test`; the suite refuses anything else.
  Never point `DB_NAME` of `.env.test` at a development database.
