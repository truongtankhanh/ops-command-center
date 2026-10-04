import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { releaseAdvisoryLock, waitForAdvisoryLock } from './advisory-locks';

/** Covers a slow migration on another replica; a lock stuck longer than this fails boot. */
const LOCK_WAIT_MS = 60_000;

const logger = new Logger('Migrations');

/**
 * Applies pending migrations at boot (ADR-0004), one replica at a time. TypeORM's `migrationsRun`
 * takes no lock, so two replicas booting together would run the same DDL and one would crash.
 * A replica that waited for the lock finds nothing pending.
 */
export async function runMigrationsOnBoot(dataSource: DataSource): Promise<void> {
  const runner = dataSource.createQueryRunner();
  try {
    await waitForAdvisoryLock(runner, 'Migrations', LOCK_WAIT_MS);
    try {
      const applied = await dataSource.runMigrations({ transaction: 'all' });
      if (applied.length > 0) {
        logger.log(`Applied ${applied.map((migration) => migration.name).join(', ')}`);
      }
    } finally {
      await releaseAdvisoryLock(runner, 'Migrations');
    }
  } finally {
    await runner.release();
  }
}
