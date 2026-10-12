import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the extrusion height of a building's shell (ADR-0018). ADR-0018 lists the column under
 * `AssetCatalogue` (V2-05); it lives here because the demo seed (V2-04.2) needs it first, so
 * `AssetCatalogue` must not add it again: a second `ADD COLUMN` would fail at boot.
 */
export class ZoneHeight1791790200000 implements MigrationInterface {
  name = 'ZoneHeight1791790200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Metres above ground. Nullable and without a default: catalog-only, no rewrite; every zone
    // starts with no height and clients draw their default. The CHECK scans "zone" under the
    // ADD COLUMN lock, a handful of rows. A NULL passes by the first branch; `> 0` refuses 0 and
    // negatives. Only SQL (and the V2-04.2 seed) writes the column: no API does.
    await queryRunner.query(`
      ALTER TABLE "zone"
        ADD COLUMN "height_m" double precision,
        ADD CONSTRAINT "zone_height_check" CHECK ("height_m" IS NULL OR "height_m" > 0)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Heights set since the upgrade are lost; clients draw their default. Dropping the column
    // drops "zone_height_check" with it. Revert the code first: the new code selects "height_m",
    // so once the column is gone `GET /api/zones` fails with a 500 until that code is reverted.
    await queryRunner.query(`ALTER TABLE "zone" DROP COLUMN "height_m"`);
  }
}
