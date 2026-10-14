# Index audit — 2026-10-14

Database: `ops_test` on the local Compose PostgreSQL (`localhost:15432`, PostgreSQL 17.11), read-only session
(`default_transaction_read_only=on`). Confirmed with Sếp before connecting: the `*_test` database, whole `public`
schema. Context: V2-06.9 (`telemetry_sample`, migration `1791880200000-telemetry-sample.ts`).

## Read this first: what this audit can and cannot say

- **Statistics window: about 1 h 13 min.** `stats_reset` is `NULL` (never reset), the server started
  2026-10-13 23:47 UTC and was audited about 01:00 UTC. The database is a test database whose schema the last e2e
  suite (`incidents.e2e-spec`) dropped and rebuilt, so every counter is from that run alone. **No scan count here is
  evidence that an index is unused.**
- **Size.** The whole database is 9.9 MB; no index is larger than 16 kB; the largest table is 96 kB. There is nothing
  to rebuild and nothing worth the write-path saving of dropping. Bloat cannot be measured properly:
  `pgstattuple` is not installed (only `plpgsql`).
- **`telemetry_sample` is empty** in this database (0 rows, three partitions `telemetry_sample_20261014` – `…16`),
  because the last suite rebuilt the schema and ran with `TELEMETRY_SOURCE=off`. Its size, growth and planner
  behaviour at volume are not measured here (ADR-0018's estimate of about 540,000 rows a day for 31 assets is
  still an estimate; V2-06.12 measures it). Plans below were taken on empty, never-analysed tables.
- A first version of the foreign-key and duplicate-index queries cut `indkey` (a 0-based vector) at the wrong
  position and reported false results; both were corrected and re-run, and only the corrected results are below.

## 1. Unused indexes (zero scans in the window)

Not conclusive: see the window above. Listed so the next audit on a database with real traffic has a baseline.

| Table             | Index                               | Size  | Kind                 | Note                                          |
| ----------------- | ----------------------------------- | ----- | -------------------- | --------------------------------------------- |
| `site_feature`    | `site_feature_pkey`                 | 16 kB | primary key          | enforces a constraint: never a drop candidate |
| `incident`        | `incident_code_key`                 | 16 kB | unique               | enforces `code`: keep                         |
| `asset`           | `asset_pkey`                        | 16 kB | primary key          | target of five foreign keys: keep             |
| `asset`           | `uq_asset_id_class`                 | 16 kB | unique `(id, class)` | target of a composite foreign key: keep       |
| `incident_event`  | `incident_event_pkey`               | 16 kB | primary key          | keep                                          |
| `telemetry_point` | `telemetry_point_pkey`              | 16 kB | primary key          | keep                                          |
| `telemetry_point` | `uq_telemetry_point_class_headline` | 16 kB | partial unique       | enforces "one headline rank per class": keep  |
| `telemetry_rule`  | `telemetry_rule_pkey`               | 16 kB | primary key          | keep                                          |
| `throttler_hit`   | `throttler_hit_pkey`                | 8 kB  | primary key          | keep                                          |
| `idempotency_key` | `idx_idempotency_key_expires_at`    | 16 kB | plain, expiry sweep  | the only non-constraint candidate; re-check   |
| `throttler_hit`   | `idx_throttler_hit_expires_at`      | 8 kB  | plain, expiry sweep  | the only non-constraint candidate; re-check   |

Only the two `expires_at` indexes are not constraints. Both serve a periodic expiry delete that may simply not
have run inside one hour. Re-check them on a long-running database before any decision.

## 2. Duplicate / redundant indexes

| Table   | Index             | Covered by                               | Verdict                                                                                                                                                                                                                                                                     |
| ------- | ----------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `asset` | `asset_pkey (id)` | `uq_asset_id_class (id, asset_class_id)` | **Not redundant.** A prefix, but the primary key is the referenced key of `telemetry_sample`, `telemetry_rule` and others (`REFERENCES asset(id)`), which a unique index on two columns cannot serve. The composite one exists on purpose, as the migration's comment says. |

No other index is equal to, or a strict prefix of, another on the same table with the same predicate. The new
table's partitions each have only their primary key.

## 3. Bloated indexes

None to report: no index above 16 kB, database 9.9 MB. Bloat was not measurable with exact tooling
(`pgstattuple` absent); size alone gives no signal at this scale.

## 4. Foreign keys without a supporting index

Strict test: an index (not partial) whose leading columns are the foreign key's columns.

| Table            | Foreign key                                          | References | On delete  | Finding                                                                                                                                                                                                                                                                                                        |
| ---------------- | ---------------------------------------------------- | ---------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `incident`       | `incident_zone_id_fkey (zone_id)`                    | `zone`     | `RESTRICT` | **No index.** `incident` has `idx_incident_status_reported (status, reported_at)` only. Pre-existing, not from V2-06.9. Matters when `zone` rows are deleted or incidents are listed by zone, at a table size this database does not have (55 rows).                                                           |
| `telemetry_rule` | `fk_telemetry_rule_asset (asset_id, asset_class_id)` | `asset`    | `CASCADE`  | **Served by design, not by the strict test.** `uq_telemetry_rule_asset_name (asset_id, name) WHERE asset_id IS NOT NULL` leads with `asset_id`, and the foreign key's equality implies the predicate (documented in `AssetCatalogue1791793800000`). Listed because the strict test cannot see partial indexes. |

Every other foreign key is served by an index with the right leading columns, including the new one:
`telemetry_sample.fk_telemetry_sample_asset (asset_id)` is served by `pk_telemetry_sample (asset_id, bucket_at)`.
Its partitions' primary keys showed 31 scans each: the referenced-side checks of the `asset` rows, using the
leading column as intended.

## 5. `telemetry_sample` (V2-06.9): access paths

Taken with `EXPLAIN (COSTS OFF)` on empty, never-analysed partitions, so the shape may change with data.

| Access path                                                                 | Plan                                                                                                                       | Verdict                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One asset over a time range (the V2-06.10 route, at most 1 h / 720 buckets) | `Append`, `Subplans Removed: 2`, `Index Scan` on the partition's primary key with `asset_id = …` and the `bucket_at` range | Good: partition pruning plus the leading column. No extra index needed.                                                                                                                                                  |
| Every asset at one instant (`WHERE bucket_at = …`)                          | one `Bitmap Index Scan` per surviving partition on the primary key, condition on the non-leading column                    | Works on empty tables; at volume it would read each partition's whole index. **Not an access path in V2** (the overview is in memory). If it appears, a `BRIN` on `bucket_at` is the cheap candidate; do not add it now. |
| Partition drop (retention)                                                  | `DROP TABLE` of a whole partition                                                                                          | No index involvement; no `DELETE`, so no index or table bloat from retention.                                                                                                                                            |

## Candidates for a plan command (not acted on here)

For `/steel-plan-db-nestjs`, none urgent:

1. `incident (zone_id)`: add a supporting index for `incident_zone_id_fkey`; decide with real row counts and the
   zone-filtered list queries. Pre-existing.
2. Re-run this audit on a long-lived database (the Compose demo volume, or staging) once `TELEMETRY_SOURCE=mock`
   or `mqtt` has led for a few days: unused-index counts become meaningful, and `telemetry_sample` can be sized
   against ADR-0018's estimate (V2-06.12).
3. Install `pgstattuple` on the database used for audits, so bloat can be measured instead of inferred.

## Queries

Read-only: `pg_stat_database`, `pg_stat_user_indexes` + `pg_index`, `pg_class` sizes, `pg_constraint` +
`pg_index` (foreign keys against index leading columns, 1-based via `string_to_array(indkey::text, ' ')`),
`pg_inherits`, `pg_stat_user_tables`, and two `EXPLAIN (COSTS OFF)` statements. No index was created, dropped or
rebuilt.
