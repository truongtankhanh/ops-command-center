import type { QueryRunner } from 'typeorm';

/**
 * Every PostgreSQL advisory lock key the API takes, in one place so two features can never pick
 * the same number. The values are arbitrary but must never change: an old and a new replica
 * running side by side during a deploy must still exclude each other.
 */
export const AdvisoryLocks = {
  Migrations: 70_001,
  Seed: 70_002,
  Simulator: 70_003,
} as const;

export type AdvisoryLockName = keyof typeof AdvisoryLocks;

const RETRY_MS = 500;

/** One attempt at a session-level lock, without waiting. `true` if this session now holds it. */
export async function tryAdvisoryLock(
  runner: QueryRunner,
  name: AdvisoryLockName,
): Promise<boolean> {
  const rows: { locked: boolean }[] = await runner.query(
    'SELECT pg_try_advisory_lock($1) AS locked',
    [AdvisoryLocks[name]],
  );
  return rows[0]?.locked === true;
}

/**
 * Takes a session-level lock, retrying until `waitMs` has passed. A blocking `pg_advisory_lock`
 * would be cut off by the session's 5 s `lock_timeout` (`typeorm-options.ts`).
 */
export async function waitForAdvisoryLock(
  runner: QueryRunner,
  name: AdvisoryLockName,
  waitMs: number,
): Promise<void> {
  const deadline = Date.now() + waitMs;
  while (!(await tryAdvisoryLock(runner, name))) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Advisory lock "${name}" is still held by another session after ${waitMs} ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }
}

/** Releases a session-level lock this session holds. Closing the session releases it too. */
export async function releaseAdvisoryLock(
  runner: QueryRunner,
  name: AdvisoryLockName,
): Promise<void> {
  await runner.query('SELECT pg_advisory_unlock($1)', [AdvisoryLocks[name]]);
}
