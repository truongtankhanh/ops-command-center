import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Links an incident to the asset and the telemetry rule that raised it (ADR-0018), and lets the
 * database refuse a second unresolved incident for the same pair, whatever the replica or timing.
 *
 * Both columns are nullable and have no default: adding them is catalog-only, every existing
 * incident keeps `NULL`, and `NULL`s are distinct in a unique index, so an operator, simulator or
 * seed incident is never constrained. Older replicas never write the columns and keep working.
 *
 * Both foreign keys are `RESTRICT`, never `CASCADE`: `AssetCatalogue1791793800000` makes a rule
 * cascade with its class and its asset, so deleting a rule or an asset must not delete an
 * incident, the audit log of what happened.
 *
 * Locks, all taken in the one boot transaction (`migrate-on-boot.ts`) and bounded by the
 * session's `lock_timeout`: `ADD COLUMN` takes ACCESS EXCLUSIVE on "incident" briefly; each
 * foreign key takes SHARE ROW EXCLUSIVE on "incident" and on its target and validates by scanning
 * "incident" (every value is `NULL`); each non-concurrent `CREATE INDEX` takes SHARE on "incident"
 * and blocks writes to it while it builds. An old replica's incident write waits for that: fine at
 * the demo's size. On a large table the foreign keys (`NOT VALID` + `VALIDATE`) and the indexes
 * (`CONCURRENTLY`) would need migrations of their own, as `1791531000000` notes for `CHECK`s.
 *
 * Every constraint and index is named, because the e2e suite asserts the name Postgres reports.
 */
export class IncidentAsset1791966600000 implements MigrationInterface {
  name = 'IncidentAsset1791966600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "incident"
        ADD COLUMN "asset_id" uuid,
        ADD COLUMN "telemetry_rule_id" uuid,
        ADD CONSTRAINT "fk_incident_asset" FOREIGN KEY ("asset_id")
          REFERENCES "asset"("id") ON DELETE RESTRICT,
        ADD CONSTRAINT "fk_incident_telemetry_rule" FOREIGN KEY ("telemetry_rule_id")
          REFERENCES "telemetry_rule"("id") ON DELETE RESTRICT`);

    // At most one unresolved incident per (asset, rule). It is re-armed by resolving the first:
    // recovery of the reading never resolves it (ADR-0018). A second breach while one is open is
    // the 23505 `IncidentsService.reportFromTelemetry` turns into `already_open`.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_incident_open_asset_rule"
        ON "incident" ("asset_id", "telemetry_rule_id") WHERE "status" <> 'resolved'`);

    // Supporting indexes for the foreign keys, which Postgres does not create. The unique index is
    // partial on the status, so a lookup by asset or by rule alone does not imply its predicate and
    // would not use it: a RESTRICT check on a delete of an asset or a rule would scan "incident".
    // Partial on `IS NOT NULL`, which an equality implies: every existing row is `NULL`, so both
    // start empty and only the incidents a rule raised are ever indexed.
    await queryRunner.query(`
      CREATE INDEX "idx_incident_asset"
        ON "incident" ("asset_id") WHERE "asset_id" IS NOT NULL`);
    await queryRunner.query(`
      CREATE INDEX "idx_incident_telemetry_rule"
        ON "incident" ("telemetry_rule_id") WHERE "telemetry_rule_id" IS NOT NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // The links are lost; the incidents themselves are untouched. Revert the code first: until
    // then a query for the columns fails. Run this before `AssetCatalogue…`'s `down`, whose tables
    // the foreign keys point at.
    await queryRunner.query(`DROP INDEX "idx_incident_telemetry_rule"`);
    await queryRunner.query(`DROP INDEX "idx_incident_asset"`);
    await queryRunner.query(`DROP INDEX "uq_incident_open_asset_rule"`);
    await queryRunner.query(`
      ALTER TABLE "incident"
        DROP CONSTRAINT "fk_incident_telemetry_rule",
        DROP CONSTRAINT "fk_incident_asset",
        DROP COLUMN "telemetry_rule_id",
        DROP COLUMN "asset_id"`);
  }
}
