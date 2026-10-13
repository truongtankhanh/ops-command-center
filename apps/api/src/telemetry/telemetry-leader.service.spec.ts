import { EventEmitter } from 'node:events';
import type { ConfigService } from '@nestjs/config';
import { Registry } from '@prometheus-io/client';
import type { DataSource } from 'typeorm';
import type { Env } from '../config/env.validation';
import { AdvisoryLocks } from '../database/advisory-locks';
import { TelemetryMetrics } from '../metrics/telemetry.metrics';
import { LEADER_CHECK_MS, TelemetryLeader } from './telemetry-leader.service';

type Source = Env['TELEMETRY_SOURCE'];

/** A `DataSource` of fake runners; `events` records queries and releases in order. */
function database() {
  const state = { queryError: undefined as Error | undefined };
  const events: string[] = [];
  const runners: {
    client: EventEmitter & { end: jest.Mock };
    query: jest.Mock;
    release: jest.Mock;
  }[] = [];
  const createQueryRunner = jest.fn(() => {
    const client = Object.assign(new EventEmitter(), { end: jest.fn(async () => undefined) });
    const runner = {
      client,
      connect: jest.fn(async () => client),
      query: jest.fn(async (sql: string, _params?: unknown[]) => {
        if (state.queryError) throw state.queryError;
        if (sql.includes('pg_try_advisory_lock')) {
          events.push('try-lock');
          return [{ locked: true }];
        }
        events.push(sql.includes('pg_advisory_unlock') ? 'unlock' : 'keep-alive');
        return [];
      }),
      release: jest.fn(async () => {
        events.push('release');
      }),
    };
    runners.push(runner);
    return runner;
  });
  return {
    state,
    events,
    runners,
    createQueryRunner,
    dataSource: { createQueryRunner } as unknown as DataSource,
  };
}

function setup(source: Source) {
  const db = database();
  const registry = new Registry();
  const metrics = new TelemetryMetrics(registry);
  const config = { getOrThrow: jest.fn(() => source) } as unknown as ConfigService<Env, true>;
  const leader = new TelemetryLeader(db.dataSource, config, metrics);

  const gauge = async () =>
    (await registry.getSingleMetric('telemetry_leader')!.get()).values[0]?.value;
  return { ...db, leader, gauge };
}

/** Lets the first check, started without awaiting, run to its end. */
const settle = () => jest.advanceTimersByTimeAsync(0);

describe('TelemetryLeader', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('with TELEMETRY_SOURCE=off', () => {
    it('starts no timer and opens no connection, and reports 0', async () => {
      const { leader, createQueryRunner, gauge } = setup('off');

      leader.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(LEADER_CHECK_MS * 3);

      expect(jest.getTimerCount()).toBe(0);
      expect(createQueryRunner).not.toHaveBeenCalled();
      expect(leader.isLeading()).toBe(false);
      expect(await gauge()).toBe(0);
    });

    it('has nothing to release at shutdown', async () => {
      const { leader, createQueryRunner } = setup('off');
      leader.onApplicationBootstrap();

      await expect(leader.beforeApplicationShutdown()).resolves.toBeUndefined();

      expect(createQueryRunner).not.toHaveBeenCalled();
    });
  });

  describe.each(['mock', 'mqtt'] as const)('with TELEMETRY_SOURCE=%s', (source) => {
    it('checks once at bootstrap, takes the Telemetry lock and reports 1', async () => {
      const { leader, runners, gauge } = setup(source);

      leader.onApplicationBootstrap();
      await settle();

      expect(leader.isLeading()).toBe(true);
      expect(runners).toHaveLength(1);
      expect(await gauge()).toBe(1);
      expect(runners[0]?.query).toHaveBeenCalledWith(
        expect.stringContaining('pg_try_advisory_lock'),
        [AdvisoryLocks.Telemetry],
      );
    });

    it(`checks again every ${LEADER_CHECK_MS} ms, and not before`, async () => {
      const { leader, events } = setup(source);
      leader.onApplicationBootstrap();
      await settle();
      expect(events).toEqual(['try-lock']);

      await jest.advanceTimersByTimeAsync(LEADER_CHECK_MS - 1);
      expect(events).toEqual(['try-lock']);

      await jest.advanceTimersByTimeAsync(1);
      expect(events).toEqual(['try-lock', 'keep-alive']);
    });
  });

  it('does not keep the process alive on its own timer', async () => {
    const interval = jest.spyOn(globalThis, 'setInterval');
    const { leader } = setup('mock');

    leader.onApplicationBootstrap();

    const timer = interval.mock.results[0]?.value as NodeJS.Timeout;
    expect(timer.hasRef()).toBe(false);
    interval.mockRestore();
  });

  it('reports 0 as soon as the leader connection is lost', async () => {
    const { leader, runners, gauge } = setup('mock');
    leader.onApplicationBootstrap();
    await settle();
    expect(await gauge()).toBe(1);

    runners[0]?.client.emit('end');

    expect(leader.isLeading()).toBe(false);
    expect(await gauge()).toBe(0);
  });

  it('survives a failing check: the timer callback never rejects, and the next one reconnects', async () => {
    const { state, leader, createQueryRunner } = setup('mock');
    leader.onApplicationBootstrap();
    await settle();

    state.queryError = new Error('database down');
    await jest.advanceTimersByTimeAsync(LEADER_CHECK_MS);
    expect(leader.isLeading()).toBe(false);

    state.queryError = undefined;
    await jest.advanceTimersByTimeAsync(LEADER_CHECK_MS);
    expect(leader.isLeading()).toBe(true);
    expect(createQueryRunner).toHaveBeenCalledTimes(2);
  });

  describe('at shutdown', () => {
    it('stops the timer, then unlocks and gives the session back', async () => {
      const { leader, events } = setup('mock');
      leader.onApplicationBootstrap();
      await settle();

      await leader.beforeApplicationShutdown();

      expect(jest.getTimerCount()).toBe(0);
      expect(events).toEqual(['try-lock', 'unlock', 'release']);
      expect(leader.isLeading()).toBe(false);
    });

    it('is harmless twice, and no check runs afterwards', async () => {
      const { leader, events, createQueryRunner } = setup('mock');
      leader.onApplicationBootstrap();
      await settle();

      await leader.beforeApplicationShutdown();
      await leader.beforeApplicationShutdown();
      await jest.advanceTimersByTimeAsync(LEADER_CHECK_MS * 3);

      expect(events).toEqual(['try-lock', 'unlock', 'release']);
      expect(createQueryRunner).toHaveBeenCalledTimes(1);
    });
  });
});
