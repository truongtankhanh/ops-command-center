import type { MigrationInterface, QueryRunner } from 'typeorm';

export class IncidentVersion1790924435743 implements MigrationInterface {
  name = 'IncidentVersion1790924435743';

  async up(queryRunner: QueryRunner): Promise<void> {
    // The default backfills existing rows and keeps inserts from an older app image valid.
    await queryRunner.query(
      `ALTER TABLE "incident" ADD COLUMN "version" integer NOT NULL DEFAULT 1`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "incident" DROP COLUMN "version"`);
  }
}
