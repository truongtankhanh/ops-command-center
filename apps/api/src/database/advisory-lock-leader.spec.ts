import { EventEmitter } from 'node:events';
import type { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { AdvisoryLockLeader } from './advisory-lock-leader';
import { AdvisoryLocks } from './advisory-locks';

class FakeClient extends EventEmitter {
  readonly end = jest.fn(async () => undefined);
}

/**
 * A `DataSource` whose query runners are fakes of what the leader touches: `connect`, `query`
 * and `release`. Each `createQueryRunner` call makes a new runner with a new client, as the pool
 * would hand out a new session. `events` records the order of queries and releases.
 */
function world() {
  const state = {
    lockFree: true,
    queryError: undefined as Error | undefined,
    unlockError: undefined as Error | undefined,
    connectError: undefined as Error | undefined,
    /** When set, the `pg_try_advisory_lock` query waits for it. */
    gate: undefined as Promise<void> | undefined,
  };
  const events: string[] = [];
  const runners: {
    client: FakeClient;
    connect: jest.Mock;
    query: jest.Mock;
    release: jest.Mock;
  }[] = [];

  const createQueryRunner = jest.fn(() => {
    const client = new FakeClient();
    const runner = {
      client,
      connect: jest.fn(async () => {
        if (state.connectError) throw state.connectError;
        return client;
      }),
      query: jest.fn(async (sql: string, _params?: unknown[]) => {
        if (state.queryError) throw state.queryError;
        if (sql.includes('pg_try_advisory_lock')) {
          events.push('try-lock');
          await state.gate;
          return [{ locked: state.lockFree }];
        }
        if (sql.includes('pg_advisory_unlock')) {
          events.push('unlock');
          if (state.unlockError) throw state.unlockError;
          return [{ pg_advisory_unlock: true }];
        }
        events.push('keep-alive');
        return [{ '?column?': 1 }];
      }),
      release: jest.fn(async () => {
        events.push('release');
      }),
    };
    runners.push(runner);
    return runner;
  });

  const logger = { log: jest.fn(), warn: jest.fn() };
  const leader = new AdvisoryLockLeader({ createQueryRunner } as unknown as DataSource, {
    lock: 'Telemetry',
    label: 'Telemetry',
    logger: logger as unknown as Logger,
  });
  return { state, events, runners, createQueryRunner, logger, leader };
}

describe('AdvisoryLockLeader', () => {
  it('opens no connection until the first check', async () => {
    const { createQueryRunner, leader } = world();

    expect(leader.leading).toBe(false);
    expect(createQueryRunner).not.toHaveBeenCalled();
  });

  it('takes the lock named in its options on the first check, and says so once', async () => {
    const { createQueryRunner, runners, logger, leader } = world();

    expect(await leader.check()).toBe(true);

    expect(leader.leading).toBe(true);
    expect(createQueryRunner).toHaveBeenCalledTimes(1);
    expect(runners[0]?.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_try_advisory_lock'),
      [AdvisoryLocks.Telemetry],
    );
    expect(logger.log).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith('Telemetry leadership acquired');
  });

  it('confirms a live lead with a keep-alive on the same connection, without logging again', async () => {
    const { createQueryRunner, events, logger, leader } = world();
    await leader.check();

    expect(await leader.check()).toBe(true);
    expect(await leader.check()).toBe(true);

    expect(events).toEqual(['try-lock', 'keep-alive', 'keep-alive']);
    expect(createQueryRunner).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledTimes(1);
  });

  it('is not leading while another session holds the lock, and tries again on the next check', async () => {
    const { state, createQueryRunner, logger, leader } = world();
    state.lockFree = false;

    expect(await leader.check()).toBe(false);
    expect(leader.leading).toBe(false);
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();

    state.lockFree = true;
    expect(await leader.check()).toBe(true);
    // The connection opened by the first check is kept, not reopened.
    expect(createQueryRunner).toHaveBeenCalledTimes(1);
  });

  it('shares one round trip between checks that overlap', async () => {
    const { events, leader } = world();

    const results = await Promise.all([leader.check(), leader.check(), leader.check()]);

    expect(results).toEqual([true, true, true]);
    expect(events).toEqual(['try-lock']);
  });

  describe('when the database fails', () => {
    it('counts a failed check as not leading, discards the session and opens a new one next time', async () => {
      const { state, runners, createQueryRunner, logger, leader } = world();
      await leader.check();

      state.queryError = new Error('boom');
      await expect(leader.check()).resolves.toBe(false);

      expect(leader.leading).toBe(false);
      expect(runners[0]?.client.end).toHaveBeenCalledTimes(1);
      expect(runners[0]?.release).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith('Telemetry leadership lost: boom');

      state.queryError = undefined;
      await expect(leader.check()).resolves.toBe(true);
      expect(createQueryRunner).toHaveBeenCalledTimes(2);
    });

    it('does not reject when the connection cannot be opened, and gives the runner back', async () => {
      const { state, runners, logger, leader } = world();
      state.connectError = new Error('no connection');

      await expect(leader.check()).resolves.toBe(false);

      expect(runners[0]?.release).toHaveBeenCalledTimes(1);
      expect(leader.leading).toBe(false);
      // It never led, so nothing was lost.
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('reports one loss once when the client errors and then ends', async () => {
      const { runners, logger, leader } = world();
      await leader.check();

      runners[0]?.client.emit('error', new Error('reset by peer'));
      runners[0]?.client.emit('end');

      expect(leader.leading).toBe(false);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith('Telemetry leadership lost: reset by peer');
    });

    it('says the connection closed when the client ends without an error', async () => {
      const { runners, logger, leader } = world();
      await leader.check();

      runners[0]?.client.emit('end');

      expect(logger.warn).toHaveBeenCalledWith('Telemetry leadership lost: connection closed');
    });
  });

  describe('release', () => {
    it('unlocks before it gives the session back, and is no longer leading', async () => {
      const { events, leader } = world();
      await leader.check();

      await leader.release();

      expect(events).toEqual(['try-lock', 'unlock', 'release']);
      expect(leader.leading).toBe(false);
    });

    it('unlocks nothing when it never led, but still gives the session back', async () => {
      const { state, events, leader } = world();
      state.lockFree = false;
      await leader.check();

      await leader.release();

      expect(events).toEqual(['try-lock', 'release']);
    });

    it('does nothing when no connection was ever opened', async () => {
      const { createQueryRunner, leader } = world();

      await expect(leader.release()).resolves.toBeUndefined();

      expect(createQueryRunner).not.toHaveBeenCalled();
    });

    it('can be called twice', async () => {
      const { events, leader } = world();
      await leader.check();

      await leader.release();
      await leader.release();

      expect(events).toEqual(['try-lock', 'unlock', 'release']);
    });

    it('waits for a check in flight, then unlocks what it took', async () => {
      const { state, events, leader } = world();
      let open!: () => void;
      state.gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      const checking = leader.check();
      await Promise.resolve();

      const releasing = leader.release();
      open();
      await Promise.all([checking, releasing]);

      expect(events).toEqual(['try-lock', 'unlock', 'release']);
      expect(leader.leading).toBe(false);
    });

    it('answers false afterwards and opens no connection', async () => {
      const { createQueryRunner, leader } = world();
      await leader.check();
      await leader.release();

      await expect(leader.check()).resolves.toBe(false);

      expect(createQueryRunner).toHaveBeenCalledTimes(1);
    });

    it('closes the session instead of returning it when the unlock fails', async () => {
      const { state, runners, leader } = world();
      await leader.check();
      state.unlockError = new Error('connection terminated');

      await expect(leader.release()).resolves.toBeUndefined();

      // A pooled session that kept the lock would keep every replica from leading again.
      expect(runners[0]?.client.end).toHaveBeenCalledTimes(1);
      expect(runners[0]?.release).toHaveBeenCalledTimes(1);
      expect(leader.leading).toBe(false);
    });
  });
});
