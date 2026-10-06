import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CameraFieldOfView1791280160000 implements MigrationInterface {
  name = 'CameraFieldOfView1791280160000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // What each camera sees (ADR-0017). Nullable and without a default: catalog-only, no rewrite;
    // existing cameras stay unknown (NULL) until the seed or an operator sets them. The CHECK scans
    // "camera" under the ADD COLUMN lock — a handful of rows per site.
    // Each side of the OR says IS NOT NULL explicitly: a comparison with NULL is NULL, and a NULL
    // CHECK passes, so half-set values would otherwise get through.
    await queryRunner.query(`
      ALTER TABLE "camera"
        ADD COLUMN "fov_heading_deg" double precision,
        ADD COLUMN "fov_angle_deg" double precision,
        ADD COLUMN "fov_range_m" double precision,
        ADD CONSTRAINT "camera_field_of_view_check" CHECK (
          ("fov_heading_deg" IS NULL AND "fov_angle_deg" IS NULL AND "fov_range_m" IS NULL)
          OR (
            "fov_heading_deg" IS NOT NULL AND "fov_angle_deg" IS NOT NULL AND "fov_range_m" IS NOT NULL
            AND "fov_heading_deg" >= 0 AND "fov_heading_deg" < 360
            AND "fov_angle_deg" > 0 AND "fov_angle_deg" <= 360
            AND "fov_range_m" > 0
          )
        )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Fields of view set since the upgrade are lost; clients draw no cones. Dropping the columns
    // drops the CHECK with them.
    await queryRunner.query(`
      ALTER TABLE "camera"
        DROP COLUMN "fov_heading_deg",
        DROP COLUMN "fov_angle_deg",
        DROP COLUMN "fov_range_m"`);
  }
}
