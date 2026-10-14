import type { TelemetryPoint } from '@occ/contracts';
import type { CatalogueAsset } from '../assets/assets.service';
import type { DemoScenarioEntry } from './mock-scenario';
import { MockTelemetrySource, type MockTelemetryOptions } from './mock-telemetry-source';
import type { RawReading, UpstreamState } from './telemetry-source';

/** A multiple of 5 s, 60 s and an hour, so every interval below has a boundary right at `NOW`. */
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

const started: MockTelemetrySource[] = [];

/** A source over a fake catalogue read, its logger silenced and read through the spies. */
function build(load: () => Promise<readonly CatalogueAsset[]>, options: MockTelemetryOptions = {}) {
  const source = new MockTelemetrySource(load, options);
  started.push(source);
  const logger = source['logger'];
  jest.spyOn(logger, 'log').mockImplementation(() => undefined);
  const debug = jest.spyOn(logger, 'debug').mockImplementation(() => undefined);
  const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

  const readings: RawReading[] = [];
  const upstream: UpstreamState[] = [];
  source.onReading((reading) => readings.push(reading));
  source.onUpstream((state) => upstream.push(state));
  return { source, readings, upstream, debug, warn };
}

describe('MockTelemetrySource', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));

  afterEach(async () => {
    await Promise.all(started.splice(0).map((source) => source.stop()));
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('is the mock source', () => {
    expect(build(async () => []).source.kind).toBe('mock');
  });

  describe('what it emits', () => {
    it('gives the whole state at start: one reading per asset, every point due', async () => {
      const { source, readings } = build(async () => [
        asset('CT-01', [point('a'), point('b', { expectedIntervalS: 60 })]),
        asset('CT-02', [point('a')]),
      ]);

      await source.start();

      expect(readings.map((r) => [r.assetCode, r.at, Object.keys(r.values).sort()])).toEqual([
        ['CT-01', iso(NOW), ['a', 'b']],
        ['CT-02', iso(NOW), ['a']],
      ]);
    });

    it('stamps a reading with its interval boundary, not the moment of the tick', async () => {
      jest.setSystemTime(NOW + 2_000);
      const { source, readings } = build(async () => [
        asset('CT-01', [
          point('a', { expectedIntervalS: 1 }),
          point('b', { expectedIntervalS: 5 }),
        ]),
      ]);

      await source.start();

      // `a` has a boundary every second, `b` every five: two boundaries, two readings.
      expect(readings.map((r) => [r.at, Object.keys(r.values)])).toEqual([
        [iso(NOW + 2_000), ['a']],
        [iso(NOW), ['b']],
      ]);
    });

    it('emits a point at its interval and not between', async () => {
      const { source, readings } = build(async () => [asset('CT-01', [point('a')])]);
      await source.start();
      expect(readings).toHaveLength(1);

      await jest.advanceTimersByTimeAsync(4_000);
      expect(readings).toHaveLength(1);

      await jest.advanceTimersByTimeAsync(1_000);
      expect(readings.map((r) => r.at)).toEqual([iso(NOW), iso(NOW + 5_000)]);
    });

    it('emits only the latest boundary when several are behind: latest wins', async () => {
      let clock = NOW;
      const { source, readings } = build(async () => [asset('CT-01', [point('a')])], {
        now: () => clock,
      });
      await source.start();

      clock = NOW + 30_000;
      await jest.advanceTimersByTimeAsync(1_000);

      expect(readings.map((r) => r.at)).toEqual([iso(NOW), iso(NOW + 30_000)]);
    });

    it('gives a value that respects the range of its point', async () => {
      const { source, readings } = build(async () => [
        asset('CT-01', [point('a', { min: 10, max: 20, expectedIntervalS: 1 })]),
      ]);

      await source.start();
      await jest.advanceTimersByTimeAsync(300_000);

      const values = readings.map((r) => r.values.a as number);
      expect(values.length).toBeGreaterThan(100);
      expect(Math.min(...values)).toBeGreaterThanOrEqual(10);
      expect(Math.max(...values)).toBeLessThanOrEqual(20);
    });
  });

  describe('replicas', () => {
    it('emit the same readings whatever the offset of their timers', async () => {
      const catalogue = [
        asset('CT-01', [point('a'), point('running', { kind: 'boolean', min: null, max: null })]),
        asset('CT-02', [point('a', { expectedIntervalS: 1 })]),
      ];
      let clockA = NOW + 100;
      let clockB = NOW + 900;
      const a = build(async () => catalogue, { now: () => clockA });
      const b = build(async () => catalogue, { now: () => clockB });
      await a.source.start();
      await b.source.start();

      clockA = NOW + 5_300;
      clockB = NOW + 5_900;
      await jest.advanceTimersByTimeAsync(1_000);

      expect(a.readings.length).toBeGreaterThanOrEqual(4);
      expect(b.readings).toEqual(a.readings);
    });
  });

  describe('upstream', () => {
    it('is live, reported once at start', async () => {
      const { source, upstream } = build(async () => [asset('CT-01', [point('a')])]);

      await source.start();
      await jest.advanceTimersByTimeAsync(10_000);

      expect(upstream).toEqual([{ upstream: 'live', since: iso(NOW) }]);
    });
  });

  describe('the catalogue', () => {
    it('emits nothing and does not fail while it is empty', async () => {
      const { source, readings } = build(async () => []);

      await expect(source.start()).resolves.toBeUndefined();
      await jest.advanceTimersByTimeAsync(10_000);

      expect(readings).toEqual([]);
    });

    it('is read again every minute, so assets seeded after boot are picked up', async () => {
      let current: CatalogueAsset[] = [];
      const { source, readings, debug } = build(async () => current);
      await source.start();
      expect(readings).toEqual([]);

      current = [asset('CT-01', [point('a')])];
      await jest.advanceTimersByTimeAsync(62_000);

      expect(readings.length).toBeGreaterThan(0);
      expect(readings[0].assetCode).toBe('CT-01');
      expect(debug).toHaveBeenCalledWith(expect.stringContaining('1 assets, 1 points'));
    });

    it('does not fail the start when the first read fails, and recovers on the next', async () => {
      let failing = true;
      const load = jest.fn(async () => {
        if (failing) throw new Error('database down');
        return [asset('CT-01', [point('a')])];
      });
      const { source, readings, warn } = build(load);

      await expect(source.start()).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('database down'));
      expect(readings).toEqual([]);

      failing = false;
      await jest.advanceTimersByTimeAsync(62_000);
      expect(readings.length).toBeGreaterThan(0);
    });

    it('keeps the previous catalogue when a later read fails', async () => {
      let failing = false;
      const load = jest.fn(async () => {
        if (failing) throw new Error('database down');
        return [asset('CT-01', [point('a')])];
      });
      const { source, readings, warn } = build(load);
      await source.start();

      failing = true;
      await jest.advanceTimersByTimeAsync(65_000);

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('database down'));
      expect(readings[readings.length - 1].at).toBe(iso(NOW + 65_000));
    });
  });

  describe('lifecycle', () => {
    it('holds a tick timer and a refresh timer, neither keeping the process alive', async () => {
      const { source } = build(async () => [asset('CT-01', [point('a')])]);

      await source.start();

      expect(jest.getTimerCount()).toBe(2);
      expect(source['tickTimer']?.hasRef()).toBe(false);
      expect(source['refreshTimer']?.hasRef()).toBe(false);
    });

    it('leaves no timer after stop, which can be repeated, and emits nothing more', async () => {
      const { source, readings } = build(async () => [asset('CT-01', [point('a')])]);
      await source.start();

      await source.stop();
      await source.stop();
      const seen = readings.length;
      await jest.advanceTimersByTimeAsync(10_000);

      expect(jest.getTimerCount()).toBe(0);
      expect(readings).toHaveLength(seen);
    });

    it('can start again after a stop, with the whole state again', async () => {
      const { source, readings } = build(async () => [asset('CT-01', [point('a')])]);
      await source.start();
      await source.stop();
      readings.length = 0;

      await source.start();

      expect(readings.map((r) => r.at)).toEqual([iso(NOW)]);
      expect(jest.getTimerCount()).toBe(2);
    });

    it('ignores a second start while running', async () => {
      const { source, readings } = build(async () => [asset('CT-01', [point('a')])]);

      await source.start();
      await source.start();

      expect(readings).toHaveLength(1);
      expect(jest.getTimerCount()).toBe(2);
    });

    it('leaves one set of timers when stop and start come while the first read is in flight', async () => {
      const { source } = build(async () => [asset('CT-01', [point('a')])]);

      const first = source.start();
      await source.stop();
      await source.start();
      await first;

      expect(jest.getTimerCount()).toBe(2);
    });
  });

  it('has no presence to report: an `onStatus` listener is never called', async () => {
    const { source } = build(async () => [asset('CT-01', [point('a')])]);
    const listener = jest.fn();

    const unsubscribe = source.onStatus(listener);
    await source.start();
    await jest.advanceTimersByTimeAsync(10_000);

    expect(listener).not.toHaveBeenCalled();
    expect(() => {
      unsubscribe();
      unsubscribe();
    }).not.toThrow();
  });

  describe('the demo scenario', () => {
    // 60 s into every 10 minutes the window opens for for_s 60 + two 5 s intervals + 10 s: 80 s.
    // `NOW` is a multiple of 600 s, so the cycle opens at `NOW + 60 s`.
    const SCENARIO: DemoScenarioEntry[] = [
      { assetCode: 'CT-01', key: 'a', cycleS: 600, offsetS: 60 },
    ];
    const OVER_TEMPERATURE = {
      id: 'rule-1',
      assetId: null,
      enabled: true,
      name: 'Over-temperature',
      key: 'a',
      comparator: 'above',
      limit: 85,
      clear: 80,
      forS: 60,
      severity: 'critical',
      incidentType: 'equipment_fault',
    } as unknown as CatalogueAsset['rules'][number];

    const ct01 = (): CatalogueAsset => ({
      ...asset('CT-01', [point('a', { min: 0, max: 150 }), point('b')]),
      rules: [OVER_TEMPERATURE],
    });
    const ct02 = (): CatalogueAsset => ({
      ...asset('CT-02', [point('a', { min: 0, max: 150 })]),
      rules: [OVER_TEMPERATURE],
    });

    /** The value of `key` of one asset at one boundary, or `undefined` if none was emitted. */
    const valueOf = (readings: RawReading[], code: string, key: string, atMs: number) =>
      readings.find((r) => r.assetCode === code && r.at === iso(atMs))?.values[key];

    it('holds the scripted key past its limit for the window, and the waveform outside it', async () => {
      const { source, readings } = build(async () => [ct01()], { scenario: SCENARIO });

      await source.start();
      await jest.advanceTimersByTimeAsync(150_000);

      // Before the window and after it: the healthy waveform, on the safe side of `clear`.
      expect(valueOf(readings, 'CT-01', 'a', NOW + 55_000)).toBeLessThanOrEqual(80);
      expect(valueOf(readings, 'CT-01', 'a', NOW + 140_000)).toBeLessThanOrEqual(80);
      // Inside it: 85 + 7, at every boundary of the window and no other.
      for (let boundary = NOW + 60_000; boundary < NOW + 140_000; boundary += 5_000) {
        expect(valueOf(readings, 'CT-01', 'a', boundary)).toBe(92);
      }
    });

    it('changes nothing else: other keys and other assets read as without a scenario', async () => {
      const plain = build(async () => [ct01(), ct02()]);
      const scripted = build(async () => [ct01(), ct02()], { scenario: SCENARIO });
      await plain.source.start();
      await scripted.source.start();

      await jest.advanceTimersByTimeAsync(150_000);

      // Everything but the one scripted value is the same reading.
      const unscripted = (reading: RawReading) => ({
        ...reading,
        values: Object.fromEntries(
          Object.entries(reading.values).filter(
            ([key]) => !(reading.assetCode === 'CT-01' && key === 'a'),
          ),
        ),
      });
      expect(scripted.readings.map(unscripted)).toEqual(plain.readings.map(unscripted));
      expect(valueOf(plain.readings, 'CT-01', 'a', NOW + 60_000)).toBeLessThanOrEqual(80);
      expect(valueOf(scripted.readings, 'CT-01', 'a', NOW + 60_000)).toBe(92);
    });

    it('is the same on two replicas whatever the offset of their timers', async () => {
      let clockA = NOW + 60_100;
      let clockB = NOW + 60_900;
      const a = build(async () => [ct01()], { scenario: SCENARIO, now: () => clockA });
      const b = build(async () => [ct01()], { scenario: SCENARIO, now: () => clockB });
      await a.source.start();
      await b.source.start();

      clockA = NOW + 65_300;
      clockB = NOW + 65_900;
      await jest.advanceTimersByTimeAsync(1_000);

      expect(a.readings.map((reading) => reading.values.a)).toEqual([92, 92]);
      expect(b.readings).toEqual(a.readings);
    });

    it('says so once at start, and not at all without a scenario', async () => {
      const scripted = build(async () => [ct01()], { scenario: SCENARIO });
      const plain = build(async () => [ct01()], { scenario: [] });
      const scriptedLog = jest.spyOn(scripted.source['logger'], 'log');
      const plainLog = jest.spyOn(plain.source['logger'], 'log');

      await scripted.source.start();
      await plain.source.start();
      await jest.advanceTimersByTimeAsync(10_000);

      const scenarioLines = (spy: typeof scriptedLog) =>
        spy.mock.calls.filter(([message]) => String(message).startsWith('Demo scenario on'));
      expect(scenarioLines(scriptedLog)).toEqual([['Demo scenario on: CT-01/a every 600 s']]);
      expect(scenarioLines(plainLog)).toEqual([]);
    });
  });

  it('keeps emitting when a listener throws, and tells the log once', async () => {
    const { source, readings, warn } = build(async () => [asset('CT-01', [point('a')])]);
    source.onReading(() => {
      throw new Error('consumer bug');
    });

    await source.start();
    await jest.advanceTimersByTimeAsync(10_000);

    expect(readings.length).toBeGreaterThan(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
