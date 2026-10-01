import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1790800000000 implements MigrationInterface {
  name = 'InitialSchema1790800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "zone" (
        "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "code"        varchar(32)  NOT NULL UNIQUE,
        "name"        varchar(120) NOT NULL,
        "kind"        varchar(16)  NOT NULL CHECK ("kind" IN ('building', 'parking', 'gate', 'outdoor')),
        "polygon"     jsonb        NOT NULL,
        "center_lng"  double precision NOT NULL,
        "center_lat"  double precision NOT NULL,
        "created_at"  timestamptz  NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`
      CREATE TABLE "camera" (
        "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "code"        varchar(32)  NOT NULL UNIQUE,
        "name"        varchar(120) NOT NULL,
        "zone_id"     uuid         NOT NULL REFERENCES "zone"("id") ON DELETE RESTRICT,
        "lng"         double precision NOT NULL,
        "lat"         double precision NOT NULL,
        "stream_path" varchar(255) NOT NULL,
        "online"      boolean      NOT NULL DEFAULT true,
        "created_at"  timestamptz  NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX "idx_camera_zone" ON "camera" ("zone_id")`);

    await queryRunner.query(`CREATE SEQUENCE "incident_code_seq" START 1`);
    await queryRunner.query(`
      CREATE TABLE "incident" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "code"            varchar(16)  NOT NULL UNIQUE,
        "type"            varchar(32)  NOT NULL CHECK ("type" IN
                            ('intrusion', 'fire_alarm', 'equipment_fault', 'medical', 'crowding', 'suspicious_object')),
        "severity"        varchar(16)  NOT NULL CHECK ("severity" IN ('low', 'medium', 'high', 'critical')),
        "status"          varchar(16)  NOT NULL CHECK ("status" IN ('open', 'acknowledged', 'resolved')),
        "title"           varchar(160) NOT NULL,
        "description"     text,
        "zone_id"         uuid         NOT NULL REFERENCES "zone"("id") ON DELETE RESTRICT,
        "lng"             double precision NOT NULL,
        "lat"             double precision NOT NULL,
        "source"          varchar(16)  NOT NULL CHECK ("source" IN ('operator', 'simulator')),
        "reported_at"     timestamptz  NOT NULL,
        "acknowledged_at" timestamptz,
        "resolved_at"     timestamptz
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_incident_status_reported" ON "incident" ("status", "reported_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "incident_event" (
        "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "incident_id" uuid        NOT NULL REFERENCES "incident"("id") ON DELETE CASCADE,
        "kind"        varchar(16) NOT NULL CHECK ("kind" IN ('reported', 'acknowledged', 'resolved')),
        "note"        text,
        "at"          timestamptz NOT NULL
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_incident_event_incident" ON "incident_event" ("incident_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "incident_event"`);
    await queryRunner.query(`DROP TABLE "incident"`);
    await queryRunner.query(`DROP SEQUENCE "incident_code_seq"`);
    await queryRunner.query(`DROP TABLE "camera"`);
    await queryRunner.query(`DROP TABLE "zone"`);
  }
}
