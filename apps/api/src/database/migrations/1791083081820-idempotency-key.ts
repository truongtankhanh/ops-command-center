import type { MigrationInterface, QueryRunner } from 'typeorm';

export class IdempotencyKey1791083081820 implements MigrationInterface {
  name = 'IdempotencyKey1791083081820';

  async up(queryRunner: QueryRunner): Promise<void> {
    // New, empty table: no existing data or lock to worry about. No foreign key to "incident":
    // a key row records what a request returned, not part of the incident (ADR-0009).
    // `response_body` is `json`, not `jsonb`, so a replay keeps the original key order.
    await queryRunner.query(`
      CREATE TABLE "idempotency_key" (
        "key"             varchar(255) PRIMARY KEY,
        "request_hash"    char(64)     NOT NULL,
        "response_status" smallint,
        "response_body"   json,
        "incident_id"     uuid,
        "created_at"      timestamptz  NOT NULL DEFAULT now(),
        "expires_at"      timestamptz  NOT NULL
      )`);
    // The hourly cleanup deletes by expiry.
    await queryRunner.query(
      `CREATE INDEX "idx_idempotency_key_expires_at" ON "idempotency_key" ("expires_at")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Keys still inside their 24 h window lose their retry protection; incidents are unaffected.
    await queryRunner.query(`DROP TABLE "idempotency_key"`);
  }
}
