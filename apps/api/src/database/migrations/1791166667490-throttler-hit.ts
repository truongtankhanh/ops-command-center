import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ThrottlerHit1791166667490 implements MigrationInterface {
  name = 'ThrottlerHit1791166667490';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Rate-limit counters shared by every replica (ADR-0012). New, empty table. UNLOGGED: counters
    // are disposable, so they skip the WAL; a crash or a failover only resets them.
    // No entity: the storage uses raw SQL, and TypeORM never drops a table it has no entity for.
    await queryRunner.query(`
      CREATE UNLOGGED TABLE "throttler_hit" (
        "key"           text        PRIMARY KEY,
        "hits"          integer     NOT NULL,
        "expires_at"    timestamptz NOT NULL,
        "blocked_until" timestamptz
      )`);
    // The cleanup deletes by expiry.
    await queryRunner.query(
      `CREATE INDEX "idx_throttler_hit_expires_at" ON "throttler_hit" ("expires_at")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Only in-flight counters are lost: every client starts a fresh window.
    await queryRunner.query(`DROP TABLE "throttler_hit"`);
  }
}
