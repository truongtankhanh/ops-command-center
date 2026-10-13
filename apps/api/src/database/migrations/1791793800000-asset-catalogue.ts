import type { MigrationInterface, QueryRunner } from 'typeorm';

// Literals rather than the contract's lists: a migration must keep doing what it did when it first
// ran, however `@occ/contracts` grows later (ADR-0021: values are only ever appended).
const SEVERITIES = `'low', 'medium', 'high', 'critical'`;
// The `facilities` and `environment` types a telemetry rule may raise (ADR-0021), never a
// `fire_safety` one: a gas alarm stays with the gas detection panel.
const RULE_INCIDENT_TYPES = `'equipment_fault', 'power_outage', 'water_leak', 'lift_entrapment',
  'hvac_fault', 'network_outage', 'severe_weather', 'flooding', 'fallen_tree'`;

/**
 * The equipment catalogue (ADR-0018): asset classes, what each class measures, the assets
 * themselves and the threshold rules. It does not add `zone.height_m`: `ZoneHeight1791790200000`
 * already did, and a second `ADD COLUMN` would fail every boot.
 *
 * Every constraint is named, because the e2e suite asserts the name Postgres reports. `"limit"` is
 * a reserved word: raw SQL against `telemetry_rule` must quote it.
 */
export class AssetCatalogue1791793800000 implements MigrationInterface {
  name = 'AssetCatalogue1791793800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // New, empty tables, created in dependency order: no scan, no backfill. The foreign key to
    // "zone" takes a short SHARE ROW EXCLUSIVE lock on it, which only a write to "zone" (the seed
    // top-up) would wait for. The rows come from the seed (V2-05.4), not from here.
    await queryRunner.query(`
      CREATE TABLE "asset_class" (
        "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "code"          varchar(32)  NOT NULL,
        "name"          varchar(120) NOT NULL,
        "model_key"     varchar(64),
        "footprint_w_m" double precision NOT NULL,
        "footprint_d_m" double precision NOT NULL,
        "footprint_h_m" double precision NOT NULL,
        "created_at"    timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "uq_asset_class_code" UNIQUE ("code"),
        CONSTRAINT "asset_class_code_check" CHECK ("code" ~ '^[a-z][a-z0-9_]{1,31}$'),
        CONSTRAINT "asset_class_footprint_check" CHECK (
          "footprint_w_m" > 0 AND "footprint_d_m" > 0 AND "footprint_h_m" > 0
        )
      )`);

    // `min` / `max` are the valid range of a number point; a reading outside it is dropped.
    // `enum_values` is set exactly when `kind = 'enum'`, and then is a non-empty JSON array. The
    // `CASE` is not decoration: SQL does not order the operands of `AND`, and
    // `jsonb_array_length` raises on a scalar instead of failing the CHECK (23514).
    // The unique (asset_class_id, key) also serves as the index for the foreign key, and is the
    // target of "telemetry_rule"'s composite foreign key.
    await queryRunner.query(`
      CREATE TABLE "telemetry_point" (
        "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "asset_class_id"      uuid         NOT NULL,
        "key"                 varchar(63)  NOT NULL,
        "label"               varchar(120) NOT NULL,
        "unit"                varchar(16),
        "kind"                varchar(16)  NOT NULL,
        "min"                 double precision,
        "max"                 double precision,
        "enum_values"         jsonb,
        "expected_interval_s" integer      NOT NULL,
        "headline"            smallint,
        "created_at"          timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "fk_telemetry_point_class" FOREIGN KEY ("asset_class_id")
          REFERENCES "asset_class"("id") ON DELETE CASCADE,
        CONSTRAINT "uq_telemetry_point_class_key" UNIQUE ("asset_class_id", "key"),
        CONSTRAINT "telemetry_point_key_check" CHECK ("key" ~ '^[a-z][A-Za-z0-9]{0,62}$'),
        CONSTRAINT "telemetry_point_kind_check" CHECK ("kind" IN ('number', 'boolean', 'enum')),
        CONSTRAINT "telemetry_point_expected_interval_check" CHECK ("expected_interval_s" > 0),
        CONSTRAINT "telemetry_point_headline_check" CHECK ("headline" IS NULL OR "headline" IN (1, 2)),
        CONSTRAINT "telemetry_point_range_check" CHECK (
          "min" IS NULL OR "max" IS NULL OR "min" <= "max"
        ),
        CONSTRAINT "telemetry_point_enum_values_check" CHECK (
          ("kind" = 'enum' AND CASE
              WHEN "enum_values" IS NULL THEN false
              WHEN jsonb_typeof("enum_values") = 'array' THEN jsonb_array_length("enum_values") > 0
              ELSE false
            END)
          OR ("kind" <> 'enum' AND "enum_values" IS NULL)
        )
      )`);
    // At most one point of a class holds each headline rank (1 or 2).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_telemetry_point_class_headline"
        ON "telemetry_point" ("asset_class_id", "headline") WHERE "headline" IS NOT NULL`);

    // `elevation_m` and `heading_deg` have no default: a hand-written INSERT that forgets them
    // fails, instead of putting an asset at ground level facing north. `unique (id,
    // asset_class_id)` is redundant with the primary key; it is the target of a rule override's
    // composite foreign key, which makes the override's class the asset's own class.
    await queryRunner.query(`
      CREATE TABLE "asset" (
        "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "code"           varchar(32)  NOT NULL,
        "name"           varchar(120) NOT NULL,
        "asset_class_id" uuid         NOT NULL,
        "zone_id"        uuid         NOT NULL,
        "lng"            double precision NOT NULL,
        "lat"            double precision NOT NULL,
        "elevation_m"    double precision NOT NULL,
        "heading_deg"    double precision NOT NULL,
        "created_at"     timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "fk_asset_class" FOREIGN KEY ("asset_class_id")
          REFERENCES "asset_class"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_asset_zone" FOREIGN KEY ("zone_id")
          REFERENCES "zone"("id") ON DELETE RESTRICT,
        CONSTRAINT "uq_asset_code" UNIQUE ("code"),
        CONSTRAINT "uq_asset_id_class" UNIQUE ("id", "asset_class_id"),
        CONSTRAINT "asset_code_check" CHECK ("code" ~ '^[A-Z]{2,4}-[A-Z0-9]{2,6}$'),
        CONSTRAINT "asset_elevation_check" CHECK ("elevation_m" >= 0),
        CONSTRAINT "asset_heading_check" CHECK ("heading_deg" >= 0 AND "heading_deg" < 360)
      )`);
    await queryRunner.query(`CREATE INDEX "idx_asset_zone" ON "asset" ("zone_id")`);
    await queryRunner.query(`CREATE INDEX "idx_asset_class" ON "asset" ("asset_class_id")`);

    // A class rule has a NULL "asset_id"; an override sets it and replaces the class rule of the
    // same name for that asset. "asset_class_id" is set on both, and both composite foreign keys
    // are MATCH SIMPLE, so a class rule skips the asset one: the rule's key must be a point of
    // its class, and an override's asset must be of that class.
    // "fk_telemetry_rule_point" is DEFERRABLE INITIALLY DEFERRED, so deleting a class can cascade
    // to its points and to its rules in whichever order Postgres runs the two cascades: the check
    // that no rule still watches a point runs at commit, when both are gone. A point a rule still
    // watches is refused all the same (23503), at commit.
    // A rule cascades with its class and its asset, so V2-07.2's incident.telemetry_rule_id must be
    // RESTRICT or SET NULL, never CASCADE: deleting a rule must not delete an incident.
    // Supporting indexes for the foreign keys: "uq_telemetry_rule_asset_name" serves
    // "fk_telemetry_rule_asset" (its predicate follows from `asset_id = $1`); the class rule index
    // is partial on `asset_id IS NULL`, which a lookup by class alone does not imply, so
    // "idx_telemetry_rule_class_key" serves "fk_telemetry_rule_class" and "fk_telemetry_rule_point".
    await queryRunner.query(`
      CREATE TABLE "telemetry_rule" (
        "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "asset_class_id" uuid         NOT NULL,
        "asset_id"       uuid,
        "name"           varchar(120) NOT NULL,
        "key"            varchar(63)  NOT NULL,
        "comparator"     varchar(8)   NOT NULL,
        "limit"          double precision NOT NULL,
        "clear"          double precision NOT NULL,
        "for_s"          integer      NOT NULL,
        "severity"       varchar(16)  NOT NULL,
        "incident_type"  varchar(32)  NOT NULL DEFAULT 'equipment_fault',
        "enabled"        boolean      NOT NULL DEFAULT true,
        "created_at"     timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "fk_telemetry_rule_class" FOREIGN KEY ("asset_class_id")
          REFERENCES "asset_class"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_telemetry_rule_point" FOREIGN KEY ("asset_class_id", "key")
          REFERENCES "telemetry_point"("asset_class_id", "key") DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT "fk_telemetry_rule_asset" FOREIGN KEY ("asset_id", "asset_class_id")
          REFERENCES "asset"("id", "asset_class_id") ON DELETE CASCADE,
        CONSTRAINT "telemetry_rule_comparator_check" CHECK ("comparator" IN ('above', 'below')),
        CONSTRAINT "telemetry_rule_for_s_check" CHECK ("for_s" >= 0),
        CONSTRAINT "telemetry_rule_severity_check" CHECK ("severity" IN (${SEVERITIES})),
        CONSTRAINT "telemetry_rule_incident_type_check" CHECK (
          "incident_type" IN (${RULE_INCIDENT_TYPES})
        ),
        CONSTRAINT "telemetry_rule_clear_check" CHECK (
          ("comparator" = 'above' AND "clear" <= "limit")
          OR ("comparator" = 'below' AND "clear" >= "limit")
        )
      )`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_telemetry_rule_class_name"
        ON "telemetry_rule" ("asset_class_id", "name") WHERE "asset_id" IS NULL`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_telemetry_rule_asset_name"
        ON "telemetry_rule" ("asset_id", "name") WHERE "asset_id" IS NOT NULL`);
    await queryRunner.query(
      `CREATE INDEX "idx_telemetry_rule_class_key" ON "telemetry_rule" ("asset_class_id", "key")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // The catalogue is lost, thresholds included: operations owns them and changes them by
    // reviewed database write (ADR-0018), so export "telemetry_rule" first on any database where
    // a limit was edited by hand. Clients draw the twin without equipment. Revert the code that
    // reads these tables first: until then `GET /api/assets` fails with a 500. Once V2-06.9
    // (`telemetry_sample`) and V2-07.2 (`incident.asset_id`, `incident.telemetry_rule_id`) exist,
    // their foreign keys point here, so revert those migrations before this one.
    await queryRunner.query(`DROP TABLE "telemetry_rule"`);
    await queryRunner.query(`DROP TABLE "asset"`);
    await queryRunner.query(`DROP TABLE "telemetry_point"`);
    await queryRunner.query(`DROP TABLE "asset_class"`);
  }
}
