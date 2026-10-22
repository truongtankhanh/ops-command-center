import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { TelemetryValue } from '@occ/contracts';
import type { DataSource } from 'typeorm';
import type { Env } from '../../config/env.validation';
import type { TelemetryChange, TelemetryIngestService } from '../ingest/telemetry-ingest.service';
import type { TelemetryLeader } from '../ingest/telemetry-leader.service';
import type { TelemetrySamplePartitions } from './telemetry-sample-partitions.service';
import { SAMPLE_FLUSH_MS, TelemetrySampleWriter } from './telemetry-sample-writer.service';

/** 7.3 s into a bucket, so the bucket the row gets is 10:00:05, not the flush's own second. */
const NOW = new Date('2026-10-14T10:00:07.300Z');
const BUCKET = '2026-10-14T10:00:05.000Z';

/**
 * The part of the ingest service the writer reads, with its semantics: a version that counts every
 * arrival, the latest value of each key, and one change per asset for the keys received since a
 * cursor.
 */
class FakeIngest {
  private version = 0;
  private readonly held = new Map<
    string,
    Map<string, { value: TelemetryValue; version: number }>
  >();
  readonly changedSince = jest.fn((cursor: number) => {
    const changes: TelemetryChange[] = [];
    for (const [assetCode, keys] of this.held) {
      const values: Record<string, TelemetryValue> = {};
      for (const [key, entry] of keys) if (entry.version > cursor) values[key] = entry.value;
      if (Object.keys(values).length === 0) continue;
      changes.push({
        assetCode,
        assetId: `id-${assetCode}`,
        values,
        at: NOW.toISOString(),
        receivedAt: NOW.toISOString(),
      });
    }
    return { version: this.version, changes };
  });

  receive(assetCode: string, values: Record<string, TelemetryValue>): void {
    const keys = this.held.get(assetCode) ?? new Map();
    this.held.set(assetCode, keys);
    for (const [key, value] of Object.entries(values)) {
      this.version += 1;
      keys.set(key, { value, version: this.version });
    }
  }
}

function setup(options: { source?: Env['TELEMETRY_SOURCE'] } = {}) {
  const state = {
    leading: true,
    /** Rejections for the next statements, consumed in order. */
    failures: [] as unknown[],
    gate: undefined as Promise<void> | undefined,
  };
  const query = jest.fn(async (_sql: string, _parameters?: unknown[]) => {
    await state.gate;
    const failure = state.failures.shift();
    if (failure !== undefined) throw failure;
    return [];
  });
  const ingest = new FakeIngest();
  const partitions = {
    maintain: jest.fn(async (_now?: Date) => undefined),
    ensure: jest.fn(async (_now?: Date) => undefined),
  };
  const leader = { isLeading: jest.fn(() => state.leading) };
  const config = { getOrThrow: jest.fn(() => options.source ?? 'mock') };
  const writer = new TelemetrySampleWriter(
    { query } as unknown as DataSource,
    config as unknown as ConfigService<Env, true>,
    ingest as unknown as TelemetryIngestService,
    leader as unknown as TelemetryLeader,
    partitions as unknown as TelemetrySamplePartitions,
  );
  return { state, query, ingest, partitions, writer };
}

/** A writer that has gained the lead: its first leading flush has started the cursor. */
async function leading(options: Parameters<typeof setup>[0] = {}) {
  const world = setup(options);
  await world.writer.flush(NOW);
  world.partitions.maintain.mockClear();
  return world;
}

const parametersOf = (query: jest.Mock, call = 0) =>
  query.mock.calls[call]?.[1] as [string[], string[], string[]];

describe('TelemetrySampleWriter', () => {
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let debug: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('when it is not the leader', () => {
    it('touches neither the database nor the ingest service, and writes nothing', async () => {
      const { writer, state, query, ingest, partitions } = setup();
      state.leading = false;
      ingest.receive('CT-01', { temp: 20 });

      await writer.flush(NOW);

      expect(query).not.toHaveBeenCalled();
      expect(partitions.maintain).not.toHaveBeenCalled();
      expect(ingest.changedSince).not.toHaveBeenCalled();
    });
  });

  describe('gaining the lead', () => {
    it('keeps the partitions up first, then writes only what arrives afterwards', async () => {
      const { writer, query, ingest, partitions } = setup();
      ingest.receive('CT-01', { temp: 20 });

      await writer.flush(NOW);

      expect(partitions.maintain).toHaveBeenCalledWith(NOW);
      // The reading held before the lead is not re-stamped as fresh.
      expect(query).not.toHaveBeenCalled();

      ingest.receive('CT-01', { temp: 21 });
      await writer.flush(NOW);

      expect(query).toHaveBeenCalledTimes(1);
      expect(parametersOf(query)[2]).toEqual([JSON.stringify({ temp: 21 })]);
    });

    it('starts again from the present after the lead was lost and regained', async () => {
      const { writer, state, query, ingest, partitions } = await leading();
      ingest.receive('CT-01', { temp: 21 });
      await writer.flush(NOW);
      expect(query).toHaveBeenCalledTimes(1);

      state.leading = false;
      await writer.flush(NOW);
      ingest.receive('CT-01', { temp: 22 });
      state.leading = true;
      await writer.flush(NOW);

      // The reading that arrived while it did not lead is left to the replica that did.
      expect(query).toHaveBeenCalledTimes(1);
      expect(partitions.maintain).toHaveBeenCalledTimes(1);
    });
  });

  describe('a flush', () => {
    it('writes one row per asset, in one statement, stamped with the flush bucket', async () => {
      const { writer, query, ingest } = await leading();
      ingest.receive('CT-01', { temp: 21, running: true });
      ingest.receive('CT-02', { temp: 30 });

      await writer.flush(NOW);

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, parameters] = query.mock.calls[0] as [string, [string[], string[], string[]]];
      expect(parameters).toEqual([
        ['id-CT-01', 'id-CT-02'],
        [BUCKET, BUCKET],
        [JSON.stringify({ temp: 21, running: true }), JSON.stringify({ temp: 30 })],
      ]);
      // One row per asset and bucket, merged: two flushes in one bucket leave one row.
      expect(sql).toContain('ON CONFLICT ("asset_id", "bucket_at") DO UPDATE');
      expect(sql).toContain('"values" = "telemetry_sample"."values" || EXCLUDED."values"');
    });

    it('sends nothing when no key arrived since the last write', async () => {
      const { writer, query, ingest } = await leading();
      ingest.receive('CT-01', { temp: 21 });
      await writer.flush(NOW);
      query.mockClear();

      await writer.flush(NOW);

      expect(query).not.toHaveBeenCalled();
    });

    it('sends each key once: the next flush carries only what arrived since', async () => {
      const { writer, query, ingest } = await leading();
      ingest.receive('CT-01', { temp: 21 });
      await writer.flush(NOW);
      ingest.receive('CT-02', { temp: 30 });

      await writer.flush(NOW);

      expect(parametersOf(query, 1)[0]).toEqual(['id-CT-02']);
    });

    it('puts two flushes of one bucket under the same bucket, for the statement to merge', async () => {
      const { writer, query, ingest } = await leading();
      ingest.receive('CT-01', { temp: 21 });
      await writer.flush(new Date('2026-10-14T10:00:05.100Z'));
      ingest.receive('CT-01', { pressure: 3 });

      await writer.flush(new Date('2026-10-14T10:00:08.900Z'));

      expect(parametersOf(query, 0)[1]).toEqual([BUCKET]);
      expect(parametersOf(query, 1)[1]).toEqual([BUCKET]);
    });

    it('stamps the next bucket from the next 5 s, not from the reading', async () => {
      const { writer, query, ingest } = await leading();
      ingest.receive('CT-01', { temp: 21 });

      await writer.flush(new Date('2026-10-14T10:00:10.000Z'));

      expect(parametersOf(query)[1]).toEqual(['2026-10-14T10:00:10.000Z']);
    });

    it('logs the count at debug and never an asset code', async () => {
      const { writer, ingest } = await leading();
      ingest.receive('CT-01', { temp: 21 });

      await writer.flush(NOW);

      expect(debug).toHaveBeenCalledWith('Wrote 1 telemetry samples');
      for (const call of [...debug.mock.calls, ...log.mock.calls, ...warn.mock.calls]) {
        expect(String(call[0])).not.toContain('CT-01');
      }
    });

    it('shares one write between flushes that overlap', async () => {
      const { writer, state, query, ingest } = await leading();
      ingest.receive('CT-01', { temp: 21 });
      let open!: () => void;
      state.gate = new Promise<void>((resolve) => {
        open = resolve;
      });

      const first = writer.flush(NOW);
      const second = writer.flush(NOW);
      open();
      await Promise.all([first, second]);

      expect(query).toHaveBeenCalledTimes(1);
    });
  });

  describe('when a write fails', () => {
    it('does not reject, keeps its place, and sends the key again with its newest value', async () => {
      const { writer, state, query, ingest } = await leading();
      ingest.receive('CT-01', { temp: 21 });
      state.failures.push(new Error('connection terminated'));

      await expect(writer.flush(NOW)).resolves.toBeUndefined();
      ingest.receive('CT-01', { temp: 22 });
      await writer.flush(NOW);

      expect(query).toHaveBeenCalledTimes(2);
      expect(parametersOf(query, 1)[2]).toEqual([JSON.stringify({ temp: 22 })]);
    });

    it('says so once while it keeps failing, and once when it is back', async () => {
      const { writer, state, ingest } = await leading();
      state.failures.push(new Error('down'), new Error('still down'));
      ingest.receive('CT-01', { temp: 21 });

      await writer.flush(NOW);
      await writer.flush(NOW);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('Telemetry sample write failed, will retry: down');

      await writer.flush(NOW);

      expect(log).toHaveBeenCalledWith('Telemetry sample writes recovered');
      expect(log).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['on the error', { code: '23514' }],
      ['on the driver error', { driverError: { code: '23514' } }],
    ])(
      'creates the partitions and tries the same rows once more when none took them (%s)',
      async (_, failure) => {
        const { writer, state, query, ingest, partitions } = await leading();
        ingest.receive('CT-01', { temp: 21 });
        state.failures.push(failure);

        await writer.flush(NOW);

        expect(partitions.ensure).toHaveBeenCalledWith(NOW);
        expect(query).toHaveBeenCalledTimes(2);
        expect(query.mock.calls[1]).toEqual(query.mock.calls[0]);
        expect(warn).not.toHaveBeenCalled();
      },
    );

    it('gives up for this flush when the retry fails too, and tries again at the next', async () => {
      const { writer, state, query, ingest, partitions } = await leading();
      ingest.receive('CT-01', { temp: 21 });
      state.failures.push({ code: '23514' }, new Error('no space left'));

      await writer.flush(NOW);

      expect(partitions.ensure).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledTimes(1);

      await writer.flush(NOW);

      expect(query).toHaveBeenCalledTimes(3);
    });

    it('does not create partitions for a failure that is not a missing one', async () => {
      const { writer, state, ingest, partitions } = await leading();
      ingest.receive('CT-01', { temp: 21 });
      state.failures.push({ code: '57014' });

      await writer.flush(NOW);

      expect(partitions.ensure).not.toHaveBeenCalled();
    });
  });

  describe('the flush timer', () => {
    beforeEach(() => jest.useFakeTimers({ now: NOW }));

    it('starts none on a replica with TELEMETRY_SOURCE=off', () => {
      const { writer } = setup({ source: 'off' });

      writer.onApplicationBootstrap();

      expect(jest.getTimerCount()).toBe(0);
    });

    it('does not keep the process alive on its own', () => {
      const interval = jest.spyOn(globalThis, 'setInterval');
      const { writer } = setup();

      writer.onApplicationBootstrap();

      const timer = interval.mock.results[0]?.value as NodeJS.Timeout;
      expect(timer.hasRef()).toBe(false);
    });

    it(`flushes every ${SAMPLE_FLUSH_MS} ms and not before`, async () => {
      const { writer, query, ingest, partitions } = setup();
      writer.onApplicationBootstrap();

      await jest.advanceTimersByTimeAsync(SAMPLE_FLUSH_MS - 1);
      expect(partitions.maintain).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      expect(partitions.maintain).toHaveBeenCalledTimes(1);

      ingest.receive('CT-01', { temp: 21 });
      await jest.advanceTimersByTimeAsync(SAMPLE_FLUSH_MS);
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('stops at shutdown, and waits for a flush in flight', async () => {
      const { writer, state, query, ingest } = await leading();
      writer.onApplicationBootstrap();
      ingest.receive('CT-01', { temp: 21 });
      let open!: () => void;
      state.gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      const flushing = writer.flush(NOW);
      await Promise.resolve();

      let stopped = false;
      const stopping = writer.beforeApplicationShutdown().then(() => {
        stopped = true;
      });
      await Promise.resolve();
      expect(stopped).toBe(false);
      expect(jest.getTimerCount()).toBe(0);

      open();
      await Promise.all([flushing, stopping]);
      expect(stopped).toBe(true);

      query.mockClear();
      ingest.receive('CT-01', { temp: 22 });
      await jest.advanceTimersByTimeAsync(SAMPLE_FLUSH_MS * 3);
      expect(query).not.toHaveBeenCalled();
    });
  });
});
