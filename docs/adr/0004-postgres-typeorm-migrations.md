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
- Cost: migrations must be written (or generated and reviewed) for every entity change.
