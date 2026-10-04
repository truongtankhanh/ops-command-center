import type { MigrationInterface, QueryRunner } from 'typeorm';

export class IdempotencyKeySubject1791088055281 implements MigrationInterface {
  name = 'IdempotencyKeySubject1791088055281';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Keys become per user (ADR-0010). Existing rows have no subject to give them: no placeholder
    // would match a retry's real user anyway, so they are deleted. The table only holds the last
    // 24 h of keys, so the lock is short; a retry of a pre-deploy request creates a new incident.
    await queryRunner.query(`DELETE FROM "idempotency_key"`);
    await queryRunner.query(`
      ALTER TABLE "idempotency_key"
        ADD COLUMN "subject" varchar(255) NOT NULL,
        DROP CONSTRAINT "idempotency_key_pkey",
        ADD CONSTRAINT "idempotency_key_pkey" PRIMARY KEY ("subject", "key")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // The same key from two users would collide on a key-only primary key; keys are only a retry
    // cache, so they are deleted rather than merged.
    await queryRunner.query(`DELETE FROM "idempotency_key"`);
    await queryRunner.query(`
      ALTER TABLE "idempotency_key"
        DROP CONSTRAINT "idempotency_key_pkey",
        DROP COLUMN "subject",
        ADD CONSTRAINT "idempotency_key_pkey" PRIMARY KEY ("key")`);
  }
}
