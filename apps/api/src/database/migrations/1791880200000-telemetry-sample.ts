import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The reading history (ADR-0018, "Reading history"): one row per asset per 5 s bucket holding the
 * last value of each key received in it, partitioned by UTC day. There is no TypeORM entity on
 * purpose: TypeORM cannot describe a partitioned table, and the writer and the partition service
 * use raw SQL (`telemetry/telemetry-sample-writer.service.ts`, `…-partitions.service.ts`).
 *
 * New, empty table family: no scan and no backfill. The foreign key takes a short SHARE ROW
 * EXCLUSIVE lock on "asset", which only a write to "asset" (the seed top-up) would wait for, and
 * the session's `lock_timeout` bounds. It runs in the one boot transaction, under the `Migrations`
 * advisory lock.
 *
 * It creates today's partition and the next two (UTC, from the database's clock) so a fresh
 * database accepts writes before any leader has run. From then on only the telemetry leader keeps
 * partitions ahead of the clock, so a database whose replicas never lead has only these three. The
 * partition names and ranges are what `telemetry/sample-partitions.ts` produces; they are spelled
 * out here because a migration must keep doing what it did when it first ran.
 *
 * Every constraint is named, because the e2e suite asserts the name Postgres reports. "values" is
 * quoted in raw SQL, as "limit" is on `telemetry_rule`.
 */
export class TelemetrySample1791880200000 implements MigrationInterface {
  name = 'TelemetrySample1791880200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // ON DELETE CASCADE: an asset leaves the catalogue by migration or reviewed write (ADR-0018),
    // and its history is meaningless without it. The primary key's leading column serves the
    // cascade, one index scan per partition.
    await queryRunner.query(`
      CREATE TABLE "telemetry_sample" (
        "asset_id"  uuid        NOT NULL,
        "bucket_at" timestamptz NOT NULL,
        "values"    jsonb       NOT NULL,
        CONSTRAINT "pk_telemetry_sample" PRIMARY KEY ("asset_id", "bucket_at"),
        CONSTRAINT "fk_telemetry_sample_asset" FOREIGN KEY ("asset_id")
          REFERENCES "asset"("id") ON DELETE CASCADE
      ) PARTITION BY RANGE ("bucket_at")`);

    await queryRunner.query(`
      DO $$
      DECLARE
        first_day date := (now() AT TIME ZONE 'UTC')::date;
        n integer;
      BEGIN
        FOR n IN 0..2 LOOP
          EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF "telemetry_sample" FOR VALUES FROM (%L) TO (%L)',
            'telemetry_sample_' || to_char(first_day + n, 'YYYYMMDD'),
            to_char(first_day + n, 'YYYY-MM-DD') || ' 00:00:00+00',
            to_char(first_day + n + 1, 'YYYY-MM-DD') || ' 00:00:00+00'
          );
        END LOOP;
      END
      $$`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Drops the partitions with the parent, so the history goes with it.
    await queryRunner.query(`DROP TABLE "telemetry_sample"`);
  }
}
