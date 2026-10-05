import type { MigrationInterface, QueryRunner } from 'typeorm';

export class LogLevelOverride1791185000000 implements MigrationInterface {
  name = 'LogLevelOverride1791185000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // The runtime log level shared by every replica (ADR-0014). New, empty table: no data or lock
    // to worry about. One row at most, hence the fixed id.
    await queryRunner.query(`
      CREATE TABLE "log_level_override" (
        "id"         smallint     PRIMARY KEY CHECK ("id" = 1),
        "level"      varchar(8)   NOT NULL
                       CHECK ("level" IN ('fatal', 'error', 'warn', 'info', 'debug', 'trace')),
        "expires_at" timestamptz  NOT NULL,
        "set_by"     varchar(200) NOT NULL,
        "set_at"     timestamptz  NOT NULL DEFAULT now()
      )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Only an active override is lost: every replica returns to its boot level within one poll.
    await queryRunner.query(`DROP TABLE "log_level_override"`);
  }
}
