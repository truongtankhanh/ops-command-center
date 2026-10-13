import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { AdvisoryLocks } from '../database/advisory-locks';
import { SimulatorLeader } from './simulator-leader.service';

/**
 * Only what the refactor onto `AdvisoryLockLeader` must not change: the lock it takes, the line it
 * logs and the two methods the simulator calls. The lifecycle itself is covered by
 * `advisory-lock-leader.spec.ts`.
 */
function leaderOverFakes() {
  const client = Object.assign(new EventEmitter(), { end: jest.fn(async () => undefined) });
  const runner = {
    connect: jest.fn(async () => client),
    query: jest.fn(async (sql: string, _params?: unknown[]) =>
      sql.includes('pg_try_advisory_lock') ? [{ locked: true }] : [],
    ),
    release: jest.fn(async () => undefined),
  };
  const dataSource = { createQueryRunner: () => runner } as unknown as DataSource;
  return { runner, leader: new SimulatorLeader(dataSource) };
}

describe('SimulatorLeader', () => {
  let log: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    log.mockRestore();
  });

  it('competes for the Simulator lock, 70_003, and nothing else', async () => {
    const { runner, leader } = leaderOverFakes();

    expect(await leader.isLeader()).toBe(true);

    expect(AdvisoryLocks.Simulator).toBe(70_003);
    expect(runner.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_try_advisory_lock'),
      [70_003],
    );
  });

  it('logs the same line, under its own context, as before the shared helper', async () => {
    const { leader } = leaderOverFakes();

    await leader.isLeader();

    expect(log).toHaveBeenCalledWith('Simulator leadership acquired');
    const owner = log.mock.contexts[0] as { context?: string };
    expect(owner.context).toBe('SimulatorLeader');
  });

  it('unlocks and gives the session back on release', async () => {
    const { runner, leader } = leaderOverFakes();
    await leader.isLeader();

    await leader.release();

    expect(runner.query).toHaveBeenLastCalledWith(
      expect.stringContaining('pg_advisory_unlock'),
      [70_003],
    );
    expect(runner.release).toHaveBeenCalledTimes(1);
    expect(await leader.isLeader()).toBe(false);
  });
});
