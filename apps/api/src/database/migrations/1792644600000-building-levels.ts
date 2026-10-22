import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes a building's levels data (ADR-0023): a `building_level` table keyed by building and code,
 * and a nullable `level_code` on "asset" and on "incident", each a composite foreign key to it, so
 * the database refuses a level that belongs to another building.
 *
 * Both columns are nullable and have no default: adding them is catalog-only, every existing row
 * keeps `NULL`, and a composite foreign key of the default `MATCH SIMPLE` kind does not check a row
 * with any `NULL` column, so nothing that exists today is constrained. Older replicas never write
 * the columns and keep working.
 *
 * Both foreign keys are `RESTRICT`, never `CASCADE`: deleting a level must not delete an incident,
 * the audit log of what happened (as `fk_incident_asset` in `IncidentAsset1791966600000`).
 * "building_level" itself cascades with its zone, as the zone's other children do.
 *
 * Locks, all taken in the one boot transaction (`migrate-on-boot.ts`) and bounded by the session's
 * `lock_timeout`: `CREATE TABLE` takes none that matter (a new, empty table); each `ADD COLUMN`
 * takes ACCESS EXCLUSIVE on "asset" or "incident" briefly (catalog only, no rewrite); each foreign
 * key takes SHARE ROW EXCLUSIVE on its table and on "building_level" and validates by scanning the
 * table (every `level_code` is `NULL`); each non-concurrent `CREATE INDEX` takes SHARE on its table
 * and blocks writes to it while it builds. An old replica's write waits for that: fine at the demo's
 * size. On a large "incident" table the key (`NOT VALID` + `VALIDATE`) and the index
 * (`CONCURRENTLY`) would need migrations of their own, as `1791531000000` notes for `CHECK`s.
 *
 * Every constraint and index is named, because the e2e suite asserts the name Postgres reports.
 */
export class BuildingLevels1792644600000 implements MigrationInterface {
  name = 'BuildingLevels1792644600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // `code` is `L1`, `L2`, `B1`, `ROOF` (`LEVEL_CODE_PATTERN` in `@occ/contracts`, spelled out here:
    // a migration keeps doing what it did when it first ran). `sort` orders the levels of a
    // building from the lowest; two levels of one building cannot share a place in that order.
    await queryRunner.query(`
      CREATE TABLE "building_level" (
        "zone_id" uuid NOT NULL,
        "code" varchar(8) NOT NULL,
        "label" varchar(40) NOT NULL,
        "elevation_m" double precision NOT NULL,
        "sort" smallint NOT NULL,
        CONSTRAINT "pk_building_level" PRIMARY KEY ("zone_id", "code"),
        CONSTRAINT "uq_building_level_sort" UNIQUE ("zone_id", "sort"),
        CONSTRAINT "fk_building_level_zone" FOREIGN KEY ("zone_id")
          REFERENCES "zone"("id") ON DELETE CASCADE,
        CONSTRAINT "building_level_code_check" CHECK ("code" ~ '^[A-Z0-9]{1,8}$'),
        CONSTRAINT "building_level_elevation_check" CHECK ("elevation_m" >= 0)
      )`);

    await queryRunner.query(`
      ALTER TABLE "asset"
        ADD COLUMN "level_code" varchar(8),
        ADD CONSTRAINT "fk_asset_level" FOREIGN KEY ("zone_id", "level_code")
          REFERENCES "building_level"("zone_id", "code") ON DELETE RESTRICT`);
    await queryRunner.query(`
      ALTER TABLE "incident"
        ADD COLUMN "level_code" varchar(8),
        ADD CONSTRAINT "fk_incident_level" FOREIGN KEY ("zone_id", "level_code")
          REFERENCES "building_level"("zone_id", "code") ON DELETE RESTRICT`);

    // Supporting indexes for the composite keys, which Postgres does not create. Partial on
    // `IS NOT NULL`, which an equality implies: every existing row is `NULL`, so both start empty
    // and only rows with a level are ever indexed. They serve the RESTRICT check on a delete of a
    // level and a "by level" filter.
    await queryRunner.query(`
      CREATE INDEX "idx_asset_level"
        ON "asset" ("zone_id", "level_code") WHERE "level_code" IS NOT NULL`);
    await queryRunner.query(`
      CREATE INDEX "idx_incident_level"
        ON "incident" ("zone_id", "level_code") WHERE "level_code" IS NOT NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // The levels, and every level set on an asset or an incident since the upgrade, are lost; the
    // assets and the incidents themselves are untouched. Revert the code first: until then a query
    // for the columns fails. Run this before the `down` of any migration the keys point at.
    await queryRunner.query(`DROP INDEX "idx_incident_level"`);
    await queryRunner.query(`DROP INDEX "idx_asset_level"`);
    await queryRunner.query(`
      ALTER TABLE "incident"
        DROP CONSTRAINT "fk_incident_level",
        DROP COLUMN "level_code"`);
    await queryRunner.query(`
      ALTER TABLE "asset"
        DROP CONSTRAINT "fk_asset_level",
        DROP COLUMN "level_code"`);
    await queryRunner.query(`DROP TABLE "building_level"`);
  }
}
