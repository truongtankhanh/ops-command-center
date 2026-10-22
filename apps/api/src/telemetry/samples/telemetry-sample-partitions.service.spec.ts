import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import type { Env } from '../../config/env.validation';
import { MAINTAIN_MS, TelemetrySamplePartitions } from './telemetry-sample-partitions.service';
import type { TelemetryLeader } from '../ingest/telemetry-leader.service';

const NOW = new Date('2026-10-14T10:00:00.000Z');

/**
 * A `DataSource` that lists the partitions the test says exist and records every other statement.
 * `gate` holds the listing, so a run can be kept in flight.
 */
function setup(options: { source?: Env['TELEMETRY_SOURCE']; retention?: number } = {}) {
  const state = {
    listed: [] as string[],
    failOn: undefined as RegExp | undefined,
    gate: undefined as Promise<void> | undefined,
    leading: true,
  };
  const statements: string[] = [];
  const listings: number[] = [];
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('pg_inherits')) {
      listings.push(statements.length);
      await state.gate;
      return state.listed.map((name) => ({ name }));
    }
    if (state.failOn?.test(sql)) throw new Error('permission denied');
    statements.push(sql);
    return [];
  });
  const values: Record<string, unknown> = {
    TELEMETRY_SOURCE: options.source ?? 'mock',
    TELEMETRY_RETENTION_DAYS: options.retention ?? 7,
  };
  const config = { getOrThrow: jest.fn((key: string) => values[key]) };
  const leader = { isLeading: jest.fn(() => state.leading) };
  const service = new TelemetrySamplePartitions(
    { query } as unknown as DataSource,
    config as unknown as ConfigService<Env, true>,
    leader as unknown as TelemetryLeader,
  );
  return { state, statements, listings, query, service };
}

const creates = (statements: string[]) =>
  statements.filter((sql) => sql.startsWith('CREATE TABLE'));
const drops = (statements: string[]) => statements.filter((sql) => sql.startsWith('DROP TABLE'));

describe('TelemetrySamplePartitions', () => {
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('maintain', () => {
    it('creates the three partitions of today and two days ahead on an empty table', async () => {
      const { service, statements } = setup();

      await service.maintain(NOW);

      expect(creates(statements)).toEqual([
        'CREATE TABLE IF NOT EXISTS "telemetry_sample_20261014" PARTITION OF "telemetry_sample" ' +
          "FOR VALUES FROM ('2026-10-14T00:00:00.000Z') TO ('2026-10-15T00:00:00.000Z')",
        'CREATE TABLE IF NOT EXISTS "telemetry_sample_20261015" PARTITION OF "telemetry_sample" ' +
          "FOR VALUES FROM ('2026-10-15T00:00:00.000Z') TO ('2026-10-16T00:00:00.000Z')",
        'CREATE TABLE IF NOT EXISTS "telemetry_sample_20261016" PARTITION OF "telemetry_sample" ' +
          "FOR VALUES FROM ('2026-10-16T00:00:00.000Z') TO ('2026-10-17T00:00:00.000Z')",
      ]);
    });

    it('creates only the ones that are missing', async () => {
      const { service, state, statements } = setup();
      state.listed = ['telemetry_sample_20261014', 'telemetry_sample_20261015'];

      await service.maintain(NOW);

      expect(creates(statements)).toHaveLength(1);
      expect(creates(statements)[0]).toContain('"telemetry_sample_20261016"');
    });

    it('drops the partitions before the cutoff and keeps the rest', async () => {
      const { service, state, statements } = setup({ retention: 7 });
      state.listed = [
        'telemetry_sample_20261001',
        'telemetry_sample_20261006',
        'telemetry_sample_20261007',
        'telemetry_sample_20261013',
        'telemetry_sample_20261014',
        'telemetry_sample_20261015',
        'telemetry_sample_20261016',
      ];

      await service.maintain(NOW);

      expect(drops(statements)).toEqual([
        'DROP TABLE IF EXISTS "telemetry_sample_20261001"',
        'DROP TABLE IF EXISTS "telemetry_sample_20261006"',
      ]);
    });

    it('never drops today, whatever the retention', async () => {
      const { service, state, statements } = setup({ retention: 1 });
      state.listed = ['telemetry_sample_20261012', 'telemetry_sample_20261014'];

      await service.maintain(NOW);

      expect(drops(statements)).toEqual(['DROP TABLE IF EXISTS "telemetry_sample_20261012"']);
    });

    it('never drops the parent, a name that does not match, or a date that is not one', async () => {
      const { service, state, statements } = setup();
      state.listed = [
        'telemetry_sample',
        'telemetry_sample_old',
        'telemetry_sample_2026101',
        'other_20200101',
        'telemetry_sample_20261340',
      ];

      await service.maintain(NOW);

      expect(drops(statements)).toEqual([]);
    });

    it('names each partition it creates or drops, once', async () => {
      const { service, state } = setup();
      state.listed = ['telemetry_sample_20261001'];

      await service.maintain(NOW);

      expect(log).toHaveBeenCalledWith(
        'Created telemetry sample partition telemetry_sample_20261014',
      );
      expect(log).toHaveBeenCalledWith(
        'Dropped telemetry sample partition telemetry_sample_20261001 (past 7 days)',
      );
      expect(log).toHaveBeenCalledTimes(4);
    });

    it('does nothing the second time when everything is in place', async () => {
      const { service, state, statements } = setup();
      state.listed = [
        'telemetry_sample_20261014',
        'telemetry_sample_20261015',
        'telemetry_sample_20261016',
      ];

      await service.maintain(NOW);

      expect(statements).toEqual([]);
      expect(log).not.toHaveBeenCalled();
    });

    it('shares one run between callers that overlap', async () => {
      const { service, state, listings } = setup();
      let open!: () => void;
      state.gate = new Promise<void>((resolve) => {
        open = resolve;
      });

      const first = service.maintain(NOW);
      const second = service.maintain(NOW);
      open();
      await Promise.all([first, second]);

      expect(listings).toHaveLength(1);
    });

    it('does not reject, and says so once while it keeps failing, then once when it recovers', async () => {
      const { service, state } = setup();
      state.failOn = /^CREATE TABLE/;

      await expect(service.maintain(NOW)).resolves.toBeUndefined();
      await expect(service.maintain(NOW)).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Telemetry sample partition upkeep failed'),
      );

      state.failOn = undefined;
      await service.maintain(NOW);

      expect(log).toHaveBeenCalledWith('Telemetry sample partition upkeep recovered');
    });
  });

  describe('ensure', () => {
    it('creates what is missing and drops nothing, even when a partition is expired', async () => {
      const { service, state, statements } = setup();
      state.listed = ['telemetry_sample_20260101'];

      await service.ensure(NOW);

      expect(creates(statements)).toHaveLength(3);
      expect(drops(statements)).toEqual([]);
    });

    it('runs after a maintain in flight, not beside it', async () => {
      const { service, state, listings } = setup();
      let open!: () => void;
      state.gate = new Promise<void>((resolve) => {
        open = resolve;
      });

      const maintaining = service.maintain(NOW);
      const ensuring = service.ensure(NOW);
      await Promise.resolve();
      await Promise.resolve();
      // Only the first run has asked for the listing; the second waits its turn.
      expect(listings).toEqual([0]);

      open();
      await Promise.all([maintaining, ensuring]);

      // The second listing was made after the first run's three creates.
      expect(listings).toEqual([0, 3]);
    });
  });

  describe('the daily timer', () => {
    beforeEach(() => jest.useFakeTimers({ now: NOW }));

    it('starts none on a replica with TELEMETRY_SOURCE=off', () => {
      const { service } = setup({ source: 'off' });

      service.onApplicationBootstrap();

      expect(jest.getTimerCount()).toBe(0);
    });

    it('does not keep the process alive on its own', () => {
      const interval = jest.spyOn(globalThis, 'setInterval');
      const { service } = setup();

      service.onApplicationBootstrap();

      const timer = interval.mock.results[0]?.value as NodeJS.Timeout;
      expect(timer.hasRef()).toBe(false);
    });

    it('runs only while leading, and not before the interval has passed', async () => {
      const { service, state, query } = setup();
      service.onApplicationBootstrap();

      await jest.advanceTimersByTimeAsync(MAINTAIN_MS - 1);
      expect(query).not.toHaveBeenCalled();

      state.leading = false;
      await jest.advanceTimersByTimeAsync(1);
      expect(query).not.toHaveBeenCalled();

      state.leading = true;
      await jest.advanceTimersByTimeAsync(MAINTAIN_MS);
      expect(query).toHaveBeenCalled();
    });

    it('stops at shutdown, and waits for a run in flight', async () => {
      const { service, state, query } = setup();
      let open!: () => void;
      state.gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      service.onApplicationBootstrap();
      const running = service.maintain(NOW);
      await Promise.resolve();

      let stopped = false;
      const stopping = service.beforeApplicationShutdown().then(() => {
        stopped = true;
      });
      await Promise.resolve();
      expect(stopped).toBe(false);
      expect(jest.getTimerCount()).toBe(0);

      open();
      await Promise.all([running, stopping]);
      expect(stopped).toBe(true);

      query.mockClear();
      await jest.advanceTimersByTimeAsync(MAINTAIN_MS * 2);
      expect(query).not.toHaveBeenCalled();
    });
  });
});
