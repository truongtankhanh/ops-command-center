import type { MigrationInterface, QueryRunner } from 'typeorm';

export class OutboxRequestId1791185060000 implements MigrationInterface {
  name = 'OutboxRequestId1791185060000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // The correlation id travels with the event to every replica's listener (ADR-0014). Nullable
    // and without a default: a catalog-only change, no rewrite. Existing rows stay NULL.
    await queryRunner.query(`ALTER TABLE "outbox" ADD COLUMN "request_id" varchar(64)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Only the correlation of rows not yet cleaned up is lost; delivery is unaffected.
    await queryRunner.query(`ALTER TABLE "outbox" DROP COLUMN "request_id"`);
  }
}
