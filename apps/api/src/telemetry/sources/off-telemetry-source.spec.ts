import { OffTelemetrySource } from './off-telemetry-source';
import type { RawReading, UpstreamState } from './telemetry-source';

const NOW = Date.parse('2026-10-13T08:00:00.000Z');

describe('OffTelemetrySource', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  it('is the off source', () => {
    expect(new OffTelemetrySource().kind).toBe('off');
  });

  it('reports upstream live once, at start, and never emits a reading', async () => {
    const source = new OffTelemetrySource();
    const readings: RawReading[] = [];
    const upstream: UpstreamState[] = [];
    source.onReading((reading) => readings.push(reading));
    source.onUpstream((state) => upstream.push(state));

    await source.start();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(upstream).toEqual([{ upstream: 'live', since: new Date(NOW).toISOString() }]);
    expect(readings).toEqual([]);
  });

  it('holds no timer, started or stopped', async () => {
    const source = new OffTelemetrySource();

    await source.start();
    expect(jest.getTimerCount()).toBe(0);

    await source.stop();
    await source.stop();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('stops calling a listener that unsubscribed', async () => {
    const source = new OffTelemetrySource();
    const listener = jest.fn();

    const unsubscribe = source.onUpstream(listener);
    unsubscribe();
    await source.start();

    expect(listener).not.toHaveBeenCalled();
  });

  it('has no presence to report: an `onStatus` listener is never called', async () => {
    const source = new OffTelemetrySource();
    const listener = jest.fn();

    const unsubscribe = source.onStatus(listener);
    await source.start();

    expect(listener).not.toHaveBeenCalled();
    expect(() => {
      unsubscribe();
      unsubscribe();
    }).not.toThrow();
  });

  it('hands out an unsubscribe for readings that is safe to call', () => {
    const unsubscribe = new OffTelemetrySource().onReading(jest.fn());

    expect(() => {
      unsubscribe();
      unsubscribe();
    }).not.toThrow();
  });
});
