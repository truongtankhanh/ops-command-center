import { Registry } from '@prometheus-io/client';
import type { TelemetryPoint } from '@occ/contracts';
import type { AssetsService, CatalogueAsset } from '../assets/assets.service';
import { TelemetryMetrics } from '../metrics/telemetry.metrics';
import { TelemetryIngestService } from './telemetry-ingest.service';
import type {
  AssetStatusReport,
  RawReading,
  TelemetrySource,
  Unsubscribe,
  UpstreamState,
} from './sources/telemetry-source';

/** On a minute boundary, so timers and ISO strings in the cases below read plainly. */
const NOW = Date.parse('2026-10-13T08:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

const point = (key: string, over: Partial<TelemetryPoint> = {}): TelemetryPoint => ({
  key,
  label: key,
  unit: null,
  kind: 'number',
  min: 0,
  max: 100,
  enumValues: null,
  expectedIntervalS: 5,
  headline: null,
  ...over,
});

const asset = (code: string, points: TelemetryPoint[]): CatalogueAsset => ({
  id: `id-${code}`,
  code,
  points,
  rules: [],
});

const CT_01 = asset('CT-01', [
  point('temp', { headline: 1 }),
  point('pressure', { headline: 2, max: 10 }),
  point('vibration', { min: null, max: null }),
  point('running', { kind: 'boolean', min: null, max: null }),
  point('mode', { kind: 'enum', min: null, max: null, enumValues: ['run', 'idle'] }),
]);
const CT_02 = asset('CT-02', [point('temp', { headline: 1 })]);

const reading = (
  assetCode: string,
  values: Record<string, number | boolean | string>,
  at?: string,
): RawReading => ({ assetCode, values, ...(at === undefined ? {} : { at }) });

/** A source that does what the test says, and records the order of what was asked of it. */
class FakeSource implements TelemetrySource {
  readonly kind = 'fake';
  onStart?: () => Promise<void>;
  onStop?: () => Promise<void>;
  private readonly readings = new Set<(reading: RawReading) => void>();
  private readonly upstreams = new Set<(state: UpstreamState) => void>();
  private readonly statuses = new Set<(report: AssetStatusReport) => void>();

  constructor(private readonly events: string[]) {}

  get listenerCount(): number {
    return this.readings.size + this.upstreams.size + this.statuses.size;
  }

  async start(): Promise<void> {
    this.events.push('start');
    await this.onStart?.();
  }

  async stop(): Promise<void> {
    this.events.push('stop');
    await this.onStop?.();
  }

  onReading(listener: (reading: RawReading) => void): Unsubscribe {
    this.events.push('onReading');
    this.readings.add(listener);
    return () => {
      this.readings.delete(listener);
    };
  }

  onUpstream(listener: (state: UpstreamState) => void): Unsubscribe {
    this.events.push('onUpstream');
    this.upstreams.add(listener);
    return () => {
      this.upstreams.delete(listener);
    };
  }

  onStatus(listener: (report: AssetStatusReport) => void): Unsubscribe {
    this.events.push('onStatus');
    this.statuses.add(listener);
    return () => {
      this.statuses.delete(listener);
    };
  }

  emit(raw: RawReading): void {
    for (const listener of [...this.readings]) listener(raw);
  }

  status(report: AssetStatusReport): void {
    for (const listener of [...this.statuses]) listener(report);
  }

  report(state: UpstreamState): void {
    for (const listener of [...this.upstreams]) listener(state);
  }
}

const started: TelemetryIngestService[] = [];

/** A service over a fake source and a fake catalogue read, its logger silenced and spied. */
function build(initial: readonly CatalogueAsset[] = [CT_01]) {
  const events: string[] = [];
  const source = new FakeSource(events);
  const catalogue = { current: initial, failure: undefined as Error | undefined };
  const load = jest.fn(async (): Promise<readonly CatalogueAsset[]> => {
    events.push('catalogue');
    if (catalogue.failure) throw catalogue.failure;
    return catalogue.current;
  });
  const registry = new Registry();
  const service = new TelemetryIngestService(
    source,
    { catalogue: load } as unknown as AssetsService,
    new TelemetryMetrics(registry),
  );
  started.push(service);

  const logger = service['logger'];
  const log = jest.spyOn(logger, 'log').mockImplementation(() => undefined);
  const debug = jest.spyOn(logger, 'debug').mockImplementation(() => undefined);
  const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

  /** Boots the service, then forgets the boot's own log lines. */
  async function boot(): Promise<void> {
    await service.onApplicationBootstrap();
    log.mockClear();
    debug.mockClear();
    warn.mockClear();
  }

  return { service, source, registry, load, catalogue, events, log, debug, warn, boot };
}

/** The count of each result, by name. */
async function counts(registry: Registry): Promise<Record<string, number>> {
  const { values } = await registry.getSingleMetric('telemetry_messages_total')!.get();
  return Object.fromEntries(values.map((value) => [String(value.labels.result), value.value]));
}

describe('TelemetryIngestService', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));

  afterEach(async () => {
    await Promise.all(started.splice(0).map((service) => service.beforeApplicationShutdown()));
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('validation', () => {
    it('accepts a reading that fits, returns its values and counts it `accepted`', async () => {
      const { service, registry, boot } = build();
      await boot();

      const accepted = service.ingest(reading('CT-01', { temp: 21.5, running: true }));

      expect(accepted).toEqual({ temp: 21.5, running: true });
      expect(await counts(registry)).toEqual({
        accepted: 1,
        unknown_asset: 0,
        invalid: 0,
        clock_skew: 0,
      });
    });

    it('drops a reading of an unknown asset and counts it `unknown_asset`', async () => {
      const { service, registry, boot } = build();
      await boot();

      const accepted = service.ingest(reading('XX-99', { temp: 1 }));

      expect(accepted).toEqual({});
      expect((await counts(registry)).unknown_asset).toBe(1);
      expect(service.latestState()).toEqual({});
    });

    it.each([
      ['an unknown key', { voltage: 5 }],
      ['a string for a number point', { temp: '21' }],
      ['a number below `min`', { temp: -1 }],
      ['a number above `max`', { temp: 100.5 }],
      ['an enum value that is not one of its values', { mode: 'standby' }],
    ])(
      'drops %s and counts it `invalid`, with nothing stored and nothing clamped',
      async (_, v) => {
        const { service, registry, boot } = build();
        await boot();

        const accepted = service.ingest(reading('CT-01', v));

        expect(accepted).toEqual({});
        expect(await counts(registry)).toMatchObject({ invalid: 1, accepted: 0 });
        expect(service.valuesOf('CT-01')).toEqual({});
        expect(service.latestState()).toEqual({});
      },
    );

    it('counts a reading with one bad value once, and still applies the others', async () => {
      const { service, registry, boot } = build();
      await boot();

      const accepted = service.ingest(reading('CT-01', { temp: 20, pressure: 99, mode: 'run' }));

      expect(accepted).toEqual({ temp: 20, mode: 'run' });
      expect(await counts(registry)).toEqual({
        accepted: 0,
        unknown_asset: 0,
        invalid: 1,
        clock_skew: 0,
      });
      expect(service.valuesOf('CT-01')).toEqual({ temp: 20, mode: 'run' });
    });

    it('replaces an `at` more than 5 minutes off with the receive time and counts it `clock_skew`', async () => {
      const { service, registry, boot } = build();
      await boot();

      service.ingest(reading('CT-01', { temp: 20 }, iso(NOW - 6 * 60_000)));

      expect(await counts(registry)).toMatchObject({ clock_skew: 1, accepted: 0 });
      // The values are good, so they are kept, stamped with the receive time.
      expect(service.changedSince(0).changes).toEqual([
        {
          assetCode: 'CT-01',
          assetId: 'id-CT-01',
          values: { temp: 20 },
          at: iso(NOW),
          receivedAt: iso(NOW),
        },
      ]);
    });

    it('keeps an `at` within 5 minutes', async () => {
      const { service, registry, boot } = build();
      await boot();

      service.ingest(reading('CT-01', { temp: 20 }, iso(NOW - 4 * 60_000)));

      expect(await counts(registry)).toMatchObject({ accepted: 1, clock_skew: 0 });
      expect(service.changedSince(0).changes[0]).toMatchObject({
        at: iso(NOW - 4 * 60_000),
        receivedAt: iso(NOW),
      });
    });

    it('does not throw for a reading that is not what the port says', async () => {
      const { service, registry, boot } = build();
      await boot();

      expect(() =>
        service.ingest({ assetCode: 7, values: null } as unknown as RawReading),
      ).not.toThrow();
      expect((await counts(registry)).unknown_asset).toBe(1);
    });
  });

  describe('the latest state', () => {
    it('is the reading that arrived last, whatever its `at` says', async () => {
      const { service, boot } = build();
      await boot();

      service.ingest(reading('CT-01', { temp: 10 }, iso(NOW)));
      service.ingest(reading('CT-01', { temp: 20 }, iso(NOW - 60_000)));

      expect(service.valuesOf('CT-01')).toEqual({ temp: 20 });
    });

    it('leaves one value per key, and the keys of other readings alone', async () => {
      const { service, boot } = build();
      await boot();

      service.ingest(reading('CT-01', { temp: 10, pressure: 5 }));
      service.ingest(reading('CT-01', { temp: 11 }));
      service.ingest(reading('CT-01', { temp: 12 }));

      expect(service.valuesOf('CT-01')).toEqual({ temp: 12, pressure: 5 });
      expect(service.changedSince(0).changes[0].values).toEqual({ temp: 12, pressure: 5 });
    });

    it('lists an asset only once it has a reading, and never with a placeholder', async () => {
      const { service, boot } = build([CT_01, CT_02]);
      await boot();

      expect(service.latestState()).toEqual({});
      expect(service.overview()).toEqual({});

      service.ingest(reading('CT-01', { temp: 10 }));

      expect(Object.keys(service.latestState())).toEqual(['CT-01']);
      expect(Object.keys(service.overview())).toEqual(['CT-01']);
      expect(service.valuesOf('CT-02')).toEqual({});
    });

    it('reports `receivedAt` as the newest of the asset’s keys', async () => {
      const { service, boot } = build();
      await boot();

      service.ingest(reading('CT-01', { temp: 10 }));
      jest.setSystemTime(NOW + 10_000);
      service.ingest(reading('CT-01', { pressure: 5 }));

      expect(service.latestState()['CT-01']).toEqual({
        online: true,
        receivedAt: iso(NOW + 10_000),
        values: { temp: 10, pressure: 5 },
      });
    });

    it('gives the overview only the headline keys that have a value, by rank', async () => {
      const { service, boot } = build();
      await boot();

      service.ingest(reading('CT-01', { vibration: 3, mode: 'run', temp: 10 }));
      expect(service.overview()['CT-01'].headline).toEqual({ temp: 10 });

      service.ingest(reading('CT-01', { pressure: 4 }));
      const { headline, online, receivedAt } = service.overview()['CT-01'];
      expect(Object.keys(headline)).toEqual(['temp', 'pressure']);
      expect(online).toBe(true);
      expect(receivedAt).toBe(iso(NOW));
    });

    // V2-09.2: the class's state point rides the overview whatever its rank, so a console can say
    // Running / Standby for an asset it does not watch. `running` is not a headline of `CT_01`.
    it('carries the state point beside the headlines once it has a value, and not before', async () => {
      const { service, boot } = build();
      await boot();

      service.ingest(reading('CT-01', { temp: 10, vibration: 3 }));
      expect(service.overview()['CT-01'].headline).toEqual({ temp: 10 });

      service.ingest(reading('CT-01', { running: true }));
      expect(service.overview()['CT-01'].headline).toEqual({ temp: 10, running: true });
    });

    it('carries a state point that reads false: false is a value', async () => {
      const { service, boot } = build();
      await boot();

      service.ingest(reading('CT-01', { temp: 10, running: false }));

      expect(service.overview()['CT-01'].headline).toEqual({ temp: 10, running: false });
    });

    it('does not repeat a state point that is already a headline', async () => {
      const pump = asset('PMP-01', [
        point('pressure', { headline: 1 }),
        point('running', { kind: 'boolean', min: null, max: null, headline: 2 }),
      ]);
      const { service, boot } = build([pump]);
      await boot();

      service.ingest(reading('PMP-01', { running: false, pressure: 4 }));

      const { headline } = service.overview()['PMP-01'];
      expect(Object.keys(headline)).toEqual(['pressure', 'running']);
      expect(headline).toEqual({ pressure: 4, running: false });
    });

    it('leaves the held values alone: the state point is in them already', async () => {
      const { service, boot } = build();
      await boot();

      service.ingest(reading('CT-01', { temp: 10, running: true }));

      expect(service.valuesOf('CT-01')).toEqual({ temp: 10, running: true });
      expect(service.latestState()['CT-01'].values).toEqual({ temp: 10, running: true });
    });

    it('hands out copies: changing a result changes nothing held', async () => {
      const { service, boot } = build();
      await boot();
      service.ingest(reading('CT-01', { temp: 10 }));

      service.latestState()['CT-01'].values.temp = 99;
      service.valuesOf('CT-01').temp = 99;
      delete service.overview()['CT-01'];
      service.changedSince(0).changes[0].values.temp = 99;

      expect(service.valuesOf('CT-01')).toEqual({ temp: 10 });
      expect(Object.keys(service.overview())).toEqual(['CT-01']);
    });
  });

  describe('changedSince', () => {
    it('lets each reader keep a cursor of its own', async () => {
      const { service, boot } = build([CT_01, CT_02]);
      await boot();
      service.ingest(reading('CT-01', { temp: 10 }));

      const first = service.changedSince(0);
      service.ingest(reading('CT-02', { temp: 30 }));
      const second = service.changedSince(first.version);
      const other = service.changedSince(0);

      expect(first.changes.map((c) => c.assetCode)).toEqual(['CT-01']);
      expect(second.changes.map((c) => c.assetCode)).toEqual(['CT-02']);
      expect(other.changes.map((c) => c.assetCode)).toEqual(['CT-01', 'CT-02']);
    });

    it("carries the asset's id, from the catalogue that validated the reading", async () => {
      const { service, boot } = build([CT_01, CT_02]);
      await boot();
      service.ingest(reading('CT-02', { temp: 30 }));
      service.ingest(reading('CT-01', { temp: 10 }));

      const { changes } = service.changedSince(0);

      expect(
        Object.fromEntries(changes.map((change) => [change.assetCode, change.assetId])),
      ).toEqual({ 'CT-01': 'id-CT-01', 'CT-02': 'id-CT-02' });
    });

    it('is empty, with the same cursor, when nothing arrived since', async () => {
      const { service, boot } = build();
      await boot();
      service.ingest(reading('CT-01', { temp: 10 }));
      const { version } = service.changedSince(0);

      expect(service.changedSince(version)).toEqual({ version, changes: [] });
    });

    it('lists a key again when a reading of it arrives, even with the same value', async () => {
      const { service, boot } = build();
      await boot();
      service.ingest(reading('CT-01', { temp: 10 }));
      const { version } = service.changedSince(0);

      service.ingest(reading('CT-01', { temp: 10 }));

      expect(service.changedSince(version).changes[0].values).toEqual({ temp: 10 });
    });

    it('stamps a change with the newest `at` and `receivedAt` among its keys', async () => {
      const { service, boot } = build();
      await boot();
      service.ingest(reading('CT-01', { temp: 10 }, iso(NOW - 1_000)));
      jest.setSystemTime(NOW + 5_000);
      service.ingest(reading('CT-01', { pressure: 4 }, iso(NOW + 4_000)));

      expect(service.changedSince(0).changes).toEqual([
        {
          assetCode: 'CT-01',
          assetId: 'id-CT-01',
          values: { temp: 10, pressure: 4 },
          at: iso(NOW + 4_000),
          receivedAt: iso(NOW + 5_000),
        },
      ]);
    });
  });

  describe('knows', () => {
    it('is false until the catalogue has been read, and true for what it holds', async () => {
      const { service, boot } = build([CT_01]);
      expect(service.knows('CT-01')).toBe(false);

      await boot();

      expect(service.knows('CT-01')).toBe(true);
      expect(service.knows('CT-02')).toBe(false);
    });

    it('does not need a reading to be held: a catalogue asset is known before it reports', async () => {
      const { service, boot } = build([CT_01]);
      await boot();

      expect(service.latestState()).toEqual({});
      expect(service.knows('CT-01')).toBe(true);
    });

    it('follows the catalogue when it is read again', async () => {
      const { service, catalogue, boot } = build([CT_01]);
      await boot();

      catalogue.current = [CT_02];
      await jest.advanceTimersByTimeAsync(60_000);

      expect(service.knows('CT-01')).toBe(false);
      expect(service.knows('CT-02')).toBe(true);
    });

    it('is false for a name that only an object would inherit', async () => {
      const { service, boot } = build([CT_01]);
      await boot();

      expect(service.knows('constructor')).toBe(false);
      expect(service.knows('__proto__')).toBe(false);
      expect(service.knows('toString')).toBe(false);
    });
  });

  describe('snapshotOf', () => {
    it('gives the entry `latestState` gives, for the listed assets only', async () => {
      const { service, boot } = build([CT_01, CT_02]);
      await boot();
      service.ingest(reading('CT-01', { temp: 10, running: true }));
      service.ingest(reading('CT-02', { temp: 30 }));

      const snapshot = service.snapshotOf(['CT-02']);

      expect(Object.keys(snapshot)).toEqual(['CT-02']);
      expect(snapshot['CT-02']).toEqual(service.latestState()['CT-02']);
    });

    it('leaves out a listed asset that holds no reading, and an unknown one', async () => {
      const { service, boot } = build([CT_01, CT_02]);
      await boot();
      service.ingest(reading('CT-01', { temp: 10 }));

      expect(service.snapshotOf(['CT-01', 'CT-02', 'XX-99'])).toEqual({
        'CT-01': { online: true, receivedAt: iso(NOW), values: { temp: 10 } },
      });
    });

    it('is empty for no codes', async () => {
      const { service, boot } = build();
      await boot();
      service.ingest(reading('CT-01', { temp: 10 }));

      expect(service.snapshotOf([])).toEqual({});
    });

    it('reports an asset that went offline as offline', async () => {
      const { service, boot } = build();
      await boot();
      service.ingest(reading('CT-01', { temp: 10 }));
      service.markOnline('CT-01', false);

      expect(service.snapshotOf(['CT-01'])['CT-01'].online).toBe(false);
    });

    it('hands out copies: changing a result changes nothing held', async () => {
      const { service, boot } = build();
      await boot();
      service.ingest(reading('CT-01', { temp: 10 }));

      service.snapshotOf(['CT-01'])['CT-01'].values.temp = 99;

      expect(service.valuesOf('CT-01')).toEqual({ temp: 10 });
    });
  });

  describe('presence', () => {
    it('is online once an asset has a reading', async () => {
      const { service, boot } = build();
      await boot();

      service.ingest(reading('CT-01', { temp: 10 }));

      expect(service.latestState()['CT-01'].online).toBe(true);
    });

    it('goes offline on a status, and back on the next accepted reading', async () => {
      const { service, boot } = build();
      await boot();
      service.ingest(reading('CT-01', { temp: 10 }));

      service.markOnline('CT-01', false);
      expect(service.latestState()['CT-01'].online).toBe(false);
      expect(service.overview()['CT-01'].online).toBe(false);

      service.ingest(reading('CT-01', { temp: 11 }));
      expect(service.latestState()['CT-01'].online).toBe(true);
    });

    it('goes offline when the source reports a last will, and back on the next reading', async () => {
      const { service, source, boot } = build();
      await boot();
      source.emit(reading('CT-01', { temp: 10 }));

      source.status({ assetCode: 'CT-01', online: false });
      expect(service.latestState()['CT-01'].online).toBe(false);

      source.emit(reading('CT-01', { temp: 11 }));
      expect(service.latestState()['CT-01'].online).toBe(true);
    });

    it('ignores a status from the source for an asset it holds no reading of', async () => {
      const { service, source, boot } = build();
      await boot();

      source.status({ assetCode: 'CT-01', online: false });
      source.status({ assetCode: 'XX-99', online: false });

      expect(service.latestState()).toEqual({});
    });

    it('keeps the values of an offline asset: the server invents nothing', async () => {
      const { service, boot } = build();
      await boot();
      service.ingest(reading('CT-01', { temp: 10 }));

      service.markOnline('CT-01', false);

      expect(service.valuesOf('CT-01')).toEqual({ temp: 10 });
    });

    it('ignores a status for an asset with no reading or no place in the catalogue', async () => {
      const { service, boot } = build();
      await boot();

      service.markOnline('CT-01', false);
      service.markOnline('XX-99', false);

      expect(service.latestState()).toEqual({});
      service.ingest(reading('CT-01', { temp: 10 }));
      expect(service.latestState()['CT-01'].online).toBe(true);
    });
  });

  describe('upstream', () => {
    it('is `paused`, since the service was built, until the source says otherwise', () => {
      const { service } = build();

      expect(service.upstream()).toEqual({ upstream: 'paused', since: iso(NOW) });
    });

    it('follows the source, tells its listeners and logs once per change', async () => {
      const { service, source, log, warn, boot } = build();
      await boot();
      const heard: UpstreamState[] = [];
      service.onUpstream((state) => heard.push(state));

      const live = { upstream: 'live', since: iso(NOW + 1_000) } as const;
      source.report(live);
      source.report({ upstream: 'live', since: iso(NOW + 2_000) });
      const paused = { upstream: 'paused', since: iso(NOW + 3_000) } as const;
      source.report(paused);

      expect(service.upstream()).toEqual(paused);
      expect(heard).toEqual([live, paused]);
      expect(log).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('stops telling a listener that unsubscribed', async () => {
      const { service, source, boot } = build();
      await boot();
      const heard: UpstreamState[] = [];
      const unsubscribe = service.onUpstream((state) => heard.push(state));

      unsubscribe();
      source.report({ upstream: 'live', since: iso(NOW) });

      expect(heard).toEqual([]);
    });

    it('hands out a copy', () => {
      const { service } = build();

      service.upstream().upstream = 'live';

      expect(service.upstream().upstream).toBe('paused');
    });

    it('is what `telemetry_upstream_up` reads on scrape: 0 until the source is live', async () => {
      const { registry, source, boot } = build();
      const scrape = async () =>
        (await registry.getSingleMetric('telemetry_upstream_up')!.get()).values[0]?.value;
      await boot();

      expect(await scrape()).toBe(0);
      source.report({ upstream: 'live', since: iso(NOW) });
      expect(await scrape()).toBe(1);
      source.report({ upstream: 'paused', since: iso(NOW + 1_000) });
      expect(await scrape()).toBe(0);
    });
  });

  describe('life cycle', () => {
    it('registers its listeners, then loads the catalogue, then starts the source', async () => {
      const { service, events } = build();

      await service.onApplicationBootstrap();

      expect(events).toEqual(['onReading', 'onUpstream', 'onStatus', 'catalogue', 'start']);
    });

    it('ingests what the source emits', async () => {
      const { service, source, registry, boot } = build();
      await boot();

      source.emit(reading('CT-01', { temp: 10 }));

      expect(service.valuesOf('CT-01')).toEqual({ temp: 10 });
      expect((await counts(registry)).accepted).toBe(1);
    });

    it('does not fail boot when the source fails to start, and says so once', async () => {
      const { service, source, warn } = build();
      source.onStart = async () => {
        throw new Error('broker down');
      };

      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
      await jest.advanceTimersByTimeAsync(0);

      expect(warn).toHaveBeenCalledWith('Telemetry source failed to start: broker down');
      expect(service.upstream().upstream).toBe('paused');
    });

    it('does not wait for a source whose start never settles', async () => {
      const { service, source } = build();
      source.onStart = () => new Promise<void>(() => undefined);

      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    });

    it('does not fail boot when the first catalogue read fails, and fills in on the refresh', async () => {
      const { service, catalogue, warn } = build();
      catalogue.failure = new Error('db down');

      await service.onApplicationBootstrap();

      expect(warn).toHaveBeenCalledWith('Catalogue read failed, keeping the previous one: db down');
      expect(service.ingest(reading('CT-01', { temp: 10 }))).toEqual({});

      catalogue.failure = undefined;
      await jest.advanceTimersByTimeAsync(60_000);

      expect(service.ingest(reading('CT-01', { temp: 10 }))).toEqual({ temp: 10 });
    });

    it('stops the source, lets go of its listeners and clears its timer on shutdown', async () => {
      const { service, source, events, registry, boot } = build();
      await boot();
      expect(jest.getTimerCount()).toBe(1);

      await service.beforeApplicationShutdown();

      expect(events).toContain('stop');
      expect(source.listenerCount).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
      source.emit(reading('CT-01', { temp: 10 }));
      expect((await counts(registry)).accepted).toBe(0);
    });

    it('does not fail shutdown when the source fails to stop', async () => {
      const { service, source, warn, boot } = build();
      await boot();
      source.onStop = async () => {
        throw new Error('socket stuck');
      };

      await expect(service.beforeApplicationShutdown()).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledWith('Telemetry source failed to stop: socket stuck');
    });
  });

  describe('the catalogue', () => {
    it('picks up an asset that appears, on the next refresh', async () => {
      const { service, catalogue, registry, boot } = build([CT_01]);
      await boot();
      expect(service.ingest(reading('CT-02', { temp: 30 }))).toEqual({});

      catalogue.current = [CT_01, CT_02];
      await jest.advanceTimersByTimeAsync(60_000);

      expect(service.ingest(reading('CT-02', { temp: 30 }))).toEqual({ temp: 30 });
      expect(await counts(registry)).toMatchObject({ unknown_asset: 1, accepted: 1 });
    });

    it('keeps the previous catalogue when a refresh fails', async () => {
      const { service, catalogue, warn, boot } = build();
      await boot();
      catalogue.failure = new Error('db down');

      await jest.advanceTimersByTimeAsync(60_000);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(service.ingest(reading('CT-01', { temp: 10 }))).toEqual({ temp: 10 });
    });

    it('drops the state of an asset that left it, and of a key that left its class', async () => {
      const { service, catalogue, boot } = build([CT_01, CT_02]);
      await boot();
      service.ingest(reading('CT-01', { temp: 10, vibration: 3 }));
      service.ingest(reading('CT-02', { temp: 30 }));

      catalogue.current = [asset('CT-01', [point('temp', { headline: 1 })])];
      await jest.advanceTimersByTimeAsync(60_000);

      expect(Object.keys(service.latestState())).toEqual(['CT-01']);
      expect(service.valuesOf('CT-01')).toEqual({ temp: 10 });
      expect(service.valuesOf('CT-02')).toEqual({});
    });

    it('recomputes an asset’s `receivedAt` when its newest key leaves', async () => {
      const { service, catalogue, boot } = build();
      await boot();
      service.ingest(reading('CT-01', { temp: 10 }));
      jest.setSystemTime(NOW + 10_000);
      service.ingest(reading('CT-01', { vibration: 3 }));
      expect(service.latestState()['CT-01'].receivedAt).toBe(iso(NOW + 10_000));

      catalogue.current = [asset('CT-01', [point('temp', { headline: 1 })])];
      await jest.advanceTimersByTimeAsync(60_000);

      expect(service.latestState()['CT-01'].receivedAt).toBe(iso(NOW));
    });
  });

  describe('logging', () => {
    it('writes nothing for an accepted reading', async () => {
      const { service, log, debug, warn, boot } = build();
      await boot();

      for (let i = 0; i < 10; i++) service.ingest(reading('CT-01', { temp: i }));

      expect(log).not.toHaveBeenCalled();
      expect(debug).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });

    it('says once, at debug, that an asset is unknown, however often it sends', async () => {
      const { service, debug, warn, boot } = build();
      await boot();

      for (let i = 0; i < 5; i++) service.ingest(reading('XX-99', { temp: i }));

      expect(debug.mock.calls).toEqual([['Unknown asset in telemetry: XX-99']]);
      expect(warn).not.toHaveBeenCalled();
    });

    it('says once per unknown key of a known asset', async () => {
      const { service, debug, boot } = build();
      await boot();

      service.ingest(reading('CT-01', { voltage: 1, temp: 5 }));
      service.ingest(reading('CT-01', { voltage: 2, current: 3 }));

      expect(debug.mock.calls).toEqual([
        ['Unknown key in telemetry: CT-01/voltage'],
        ['Unknown key in telemetry: CT-01/current'],
      ]);
    });

    it('stops remembering past its cap, and keeps counting', async () => {
      const { service, registry, debug, boot } = build();
      await boot();

      for (let i = 0; i < 300; i++) service.ingest(reading(`XX-${i}`, { temp: 1 }));

      const messages = debug.mock.calls.map(([message]) => String(message));
      expect(messages.filter((m) => m.startsWith('Unknown asset'))).toHaveLength(256);
      expect(messages.filter((m) => m.includes('are not logged'))).toHaveLength(1);
      expect((await counts(registry)).unknown_asset).toBe(300);
    });

    it('cuts a long device-supplied code short', async () => {
      const { service, debug, boot } = build();
      await boot();

      service.ingest(reading('X'.repeat(500), { temp: 1 }));

      const [[message]] = debug.mock.calls;
      expect(String(message).length).toBeLessThan(120);
    });
  });
});
