import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Outbox1790929369576 implements MigrationInterface {
  name = 'Outbox1790929369576';

  async up(queryRunner: QueryRunner): Promise<void> {
    // New, empty table: no existing data or lock to worry about. No foreign key to "incident":
    // an outbox row is a record of what was published, not part of the incident (ADR-0007).
    await queryRunner.query(`
      CREATE TABLE "outbox" (
        "id"           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        "aggregate_id" uuid        NOT NULL,
        "event"        varchar(32) NOT NULL CHECK ("event" IN ('incident.created', 'incident.updated')),
        "payload"      jsonb       NOT NULL,
        "created_at"   timestamptz NOT NULL DEFAULT now(),
        "published_at" timestamptz
      )`);
    // The relay only ever reads pending rows, in id order; published rows are kept for a day.
    await queryRunner.query(
      `CREATE INDEX "idx_outbox_pending" ON "outbox" ("id") WHERE "published_at" IS NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Drops events not yet published; consoles converge on their next refetch.
    await queryRunner.query(`DROP TABLE "outbox"`);
  }
}
