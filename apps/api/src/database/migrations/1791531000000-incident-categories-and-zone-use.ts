import type { MigrationInterface, QueryRunner } from 'typeorm';

// Literals rather than the contract's lists: a migration must keep doing what it did when it first
// ran, however `@occ/contracts` grows later (ADR-0021: values are only ever appended).
const V1_INCIDENT_TYPES = `'intrusion', 'fire_alarm', 'equipment_fault', 'medical', 'crowding', 'suspicious_object'`;
const INCIDENT_TYPES = `${V1_INCIDENT_TYPES},
  'theft', 'vandalism', 'suspicious_person', 'assault',
  'fire', 'gas_leak', 'hazmat_spill',
  'injury',
  'power_outage', 'water_leak', 'lift_entrapment', 'hvac_fault', 'network_outage',
  'severe_weather', 'flooding', 'fallen_tree',
  'traffic_accident', 'blocked_access'`;
const V1_INCIDENT_SOURCES = `'operator', 'simulator'`;
// `telemetry` (ADR-0018) is allowed ahead of V2-07, so that ticket needs no second CHECK
// migration. The API neither writes nor documents it until `INCIDENT_SOURCES` gains it.
const INCIDENT_SOURCES = `${V1_INCIDENT_SOURCES}, 'telemetry'`;
const V1_ZONE_KINDS = `'building', 'parking', 'gate', 'outdoor'`;
const ZONE_KINDS = `${V1_ZONE_KINDS}, 'sports', 'utility', 'water'`;
const ZONE_USES = `'academic', 'library', 'laboratory', 'residential', 'dining', 'healthcare',
  'sports_hall', 'administration', 'data_center', 'security_post', 'utility_plant'`;

/**
 * Widens the inline CHECKs of the initial schema to ADR-0021's vocabulary and adds the building
 * `use`. Postgres named those CHECKs `<table>_<column>_check`; each is replaced under its own name.
 */
export class IncidentCategoriesAndZoneUse1791531000000 implements MigrationInterface {
  name = 'IncidentCategoriesAndZoneUse1791531000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Each ALTER takes its table's lock once and scans it to validate the new CHECKs; every existing
    // row passes, since the new lists only add values. Fine at the demo's size. `NOT VALID` +
    // `VALIDATE` would not help while every migration shares one transaction (`migrate-on-boot.ts`):
    // a large "incident" table would need them in migrations of their own.
    await queryRunner.query(`
      ALTER TABLE "incident"
        DROP CONSTRAINT "incident_type_check",
        ADD CONSTRAINT "incident_type_check" CHECK ("type" IN (${INCIDENT_TYPES})),
        DROP CONSTRAINT "incident_source_check",
        ADD CONSTRAINT "incident_source_check" CHECK ("source" IN (${INCIDENT_SOURCES}))`);

    // Nullable and without a default: catalog-only, every zone starts with no use. `kind` is
    // NOT NULL, so the building branch never compares with NULL.
    await queryRunner.query(`
      ALTER TABLE "zone"
        DROP CONSTRAINT "zone_kind_check",
        ADD CONSTRAINT "zone_kind_check" CHECK ("kind" IN (${ZONE_KINDS})),
        ADD COLUMN "use" varchar(16),
        ADD CONSTRAINT "zone_use_check" CHECK (
          "use" IS NULL OR ("kind" = 'building' AND "use" IN (${ZONE_USES}))
        )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Uses set since the upgrade are lost; dropping the column drops "zone_use_check" with it.
    // Restoring the V1 lists fails with a check violation (23514) once any row holds a new type,
    // kind or source: from then on the way back is forward, not this method.
    await queryRunner.query(`
      ALTER TABLE "zone"
        DROP COLUMN "use",
        DROP CONSTRAINT "zone_kind_check",
        ADD CONSTRAINT "zone_kind_check" CHECK ("kind" IN (${V1_ZONE_KINDS}))`);
    await queryRunner.query(`
      ALTER TABLE "incident"
        DROP CONSTRAINT "incident_type_check",
        ADD CONSTRAINT "incident_type_check" CHECK ("type" IN (${V1_INCIDENT_TYPES})),
        DROP CONSTRAINT "incident_source_check",
        ADD CONSTRAINT "incident_source_check" CHECK ("source" IN (${V1_INCIDENT_SOURCES}))`);
  }
}
