# ADR-0004: PostgreSQL with TypeORM, migrations only

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

The data is relational (zones → cameras, zones → incidents → timeline) with a few flexible parts (zone polygons, camera source configuration). The deployment target is a single on-prem host that operations staff, not developers, will upgrade.

## Decision

- **PostgreSQL** — relational integrity, `jsonb` for the flexible parts, and a clear path to PostGIS when spatial queries are needed.
- **TypeORM** with the NestJS integration — entities double as the domain model for this size of system.
- **Migrations only.** `synchronize` is never enabled in any environment. The API runs pending migrations at boot (`migrationsRun`), so an upgrade is "pull the new image, restart".
- Reference data (the demo campus) is seeded at boot only when the database is empty, controlled by `SEED_ON_BOOT`.

## Consequences

- Every schema change is reviewed as SQL in a pull request and is reproducible in every environment.
- Upgrades on customer hardware need no manual database step.
- Incident + timeline writes happen in one transaction, together with the outbox row that announces the change. A relay publishes it after commit (see ADR-0007, which amends ADR-0003).
- Migrations run under the app's session limits (`typeorm-options.ts`): `statement_timeout` 15 s, `lock_timeout` 5 s. A migration that needs longer, such as a large backfill or a table rewrite, raises them inside its own transaction with `SET LOCAL statement_timeout = …`. A migration whose `ALTER` cannot get its lock within 5 s fails, and the API does not boot. It fails fast instead of queueing behind live traffic. Restart once traffic is quieter, or raise `lock_timeout` in that migration on purpose.
- Cost: migrations must be written (or generated and reviewed) for every entity change.
