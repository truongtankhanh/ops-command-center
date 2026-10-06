import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SitePlan1791280100000 implements MigrationInterface {
  name = 'SitePlan1791280100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // The site plan drawn under the zones, as data (ADR-0017). New, empty tables: no lock or
    // backfill to worry about. The demo campus's plan comes from the seed, not from here.
    await queryRunner.query(`
      CREATE TABLE "site" (
        "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "code"        varchar(32)  NOT NULL UNIQUE,
        "name"        varchar(120) NOT NULL,
        "center_lng"  double precision NOT NULL,
        "center_lat"  double precision NOT NULL,
        "created_at"  timestamptz  NOT NULL DEFAULT now()
      )`);

    // `->> 'type'` is NULL when the key is missing, and a NULL CHECK passes: hence `coalesce`.
    // The unique (site_id, sort_order) also serves as the index for the foreign key.
    await queryRunner.query(`
      CREATE TABLE "site_feature" (
        "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "site_id"     uuid        NOT NULL REFERENCES "site"("id") ON DELETE CASCADE,
        "part"        varchar(16) NOT NULL
                        CONSTRAINT "site_feature_part_check" CHECK ("part" IN ('boundary', 'road', 'field')),
        "geometry"    jsonb       NOT NULL
                        CONSTRAINT "site_feature_geometry_type_check"
                        CHECK (coalesce("geometry" ->> 'type', '') IN ('Polygon', 'LineString')),
        "sort_order"  smallint    NOT NULL,
        CONSTRAINT "site_feature_site_order_key" UNIQUE ("site_id", "sort_order")
      )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Site plans are lost; clients fall back to drawing the zones only.
    await queryRunner.query(`DROP TABLE "site_feature"`);
    await queryRunner.query(`DROP TABLE "site"`);
  }
}
