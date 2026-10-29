import type { TelemetryPoint } from '@occ/contracts';
import { SPARKLINE_WINDOW_MS } from './assetInspector';
import { FLAT_BELOW, MIN_DELTA_SPAN_MS, readingDelta } from './readingDelta';

const NOW = Date.parse('2026-10-15T08:00:00.000Z');

const MINUTE = 60_000;

const NUMBER: Pick<TelemetryPoint, 'kind'> = { kind: 'number' };

/**
 * A ring series from `[msBeforeNow, value]` samples, oldest first. Values are stored as float32 as
 * the ring does, so the cases use values float32 holds exactly unless they are about float32.
 */
const ring = (...samples: [number, number][]) => ({
  t: Float64Array.from(samples.map(([msAgo]) => NOW - msAgo)),
  v: Float32Array.from(samples.map(([, value]) => value)),
});

describe('readingDelta', () => {
  describe('the change', () => {
    it('rises: up, with the signed amount over the oldest point in the window', () => {
      const series = ring([10 * MINUTE, 10], [5 * MINUTE, 11], [MINUTE, 12]);

      expect(readingDelta(NUMBER, series, 12.5, NOW)).toEqual({ direction: 'up', amount: 2.5 });
    });

    it('falls: down, with a negative amount', () => {
      const series = ring([10 * MINUTE, 10], [5 * MINUTE, 9]);

      expect(readingDelta(NUMBER, series, 7.5, NOW)).toEqual({ direction: 'down', amount: -2.5 });
    });

    it('is flat, with an amount of exactly 0, when the reading did not move', () => {
      const series = ring([10 * MINUTE, 10], [5 * MINUTE, 10]);

      expect(readingDelta(NUMBER, series, 10, NOW)).toEqual({ direction: 'flat', amount: 0 });
    });

    it('is flat for a reading that only differs by float32 rounding', () => {
      // 12.8 is not exact in float32: the ring holds 12.800000190734863.
      const series = ring([10 * MINUTE, 12.8], [5 * MINUTE, 12.8]);

      expect(readingDelta(NUMBER, series, 12.8, NOW)).toEqual({ direction: 'flat', amount: 0 });
    });

    it('is flat below the display precision and not flat at it', () => {
      const series = ring([10 * MINUTE, 10], [5 * MINUTE, 10]);

      expect(FLAT_BELOW).toBe(0.05);
      expect(readingDelta(NUMBER, series, 10.049, NOW)).toEqual({ direction: 'flat', amount: 0 });
      expect(readingDelta(NUMBER, series, 10.05, NOW)?.direction).toBe('up');
    });

    it('compares with the oldest point inside the window, not the first of the series', () => {
      // 20 minutes ago is outside the 15-minute window: the reference is the 10 minute-old 10.
      const series = ring([20 * MINUTE, 100], [10 * MINUTE, 10], [5 * MINUTE, 11]);

      expect(readingDelta(NUMBER, series, 12, NOW)).toEqual({ direction: 'up', amount: 2 });
    });

    it('counts a point exactly at the edge of the window', () => {
      const series = ring([SPARKLINE_WINDOW_MS, 10], [5 * MINUTE, 11]);

      expect(readingDelta(NUMBER, series, 12, NOW)).toEqual({ direction: 'up', amount: 2 });
    });

    it('reads a window the caller gives', () => {
      const series = ring([10 * MINUTE, 1], [100_000, 5], [70_000, 6]);

      expect(readingDelta(NUMBER, series, 7, NOW)).toEqual({ direction: 'up', amount: 6 });
      expect(readingDelta(NUMBER, series, 7, NOW, 2 * MINUTE)).toEqual({
        direction: 'up',
        amount: 2,
      });
    });
  });

  describe('nothing to compare ("—")', () => {
    it('has no series', () => {
      expect(readingDelta(NUMBER, undefined, 12, NOW)).toBeNull();
      expect(readingDelta(NUMBER, ring(), 12, NOW)).toBeNull();
    });

    it('has fewer than two points in the window', () => {
      expect(readingDelta(NUMBER, ring([5 * MINUTE, 10]), 12, NOW)).toBeNull();
      // The earlier point is outside the window, so one is left inside.
      expect(readingDelta(NUMBER, ring([20 * MINUTE, 10], [5 * MINUTE, 11]), 12, NOW)).toBeNull();
    });

    it('has only points older than the window', () => {
      const series = ring([20 * MINUTE, 10], [16 * MINUTE, 11]);

      expect(readingDelta(NUMBER, series, 12, NOW)).toBeNull();
    });

    it('has a reference too close to now to mean a change', () => {
      const enough = ring([MIN_DELTA_SPAN_MS, 10], [30_000, 11]);
      const tooShort = ring([MIN_DELTA_SPAN_MS - 1, 10], [30_000, 11]);

      expect(readingDelta(NUMBER, enough, 12, NOW)).toEqual({ direction: 'up', amount: 2 });
      expect(readingDelta(NUMBER, tooShort, 12, NOW)).toBeNull();
    });

    it('has no latest reading, or one that is not a number', () => {
      const series = ring([10 * MINUTE, 10], [5 * MINUTE, 11]);

      expect(readingDelta(NUMBER, series, null, NOW)).toBeNull();
      expect(readingDelta(NUMBER, series, Number.NaN, NOW)).toBeNull();
      expect(readingDelta(NUMBER, series, Number.POSITIVE_INFINITY, NOW)).toBeNull();
    });

    it('has no clock yet', () => {
      const series = ring([10 * MINUTE, 10], [5 * MINUTE, 11]);

      expect(readingDelta(NUMBER, series, 12, null)).toBeNull();
      expect(readingDelta(NUMBER, series, 12, Number.NaN)).toBeNull();
    });

    // The ring stores a boolean as 0 / 1 and an enum as its index: a flip is not a change of 1.
    it.each(['boolean', 'enum'] as const)('has no change for a %s point', (kind) => {
      const series = ring([10 * MINUTE, 0], [5 * MINUTE, 0]);

      expect(readingDelta({ kind }, series, 1, NOW)).toBeNull();
    });

    it('has no change for a kind a newer API sends', () => {
      const series = ring([10 * MINUTE, 0], [5 * MINUTE, 0]);

      expect(readingDelta({ kind: 'text' as TelemetryPoint['kind'] }, series, 1, NOW)).toBeNull();
    });
  });

  it('only reads the series', () => {
    const series = ring([10 * MINUTE, 10], [5 * MINUTE, 11]);
    const times = Array.from(series.t);
    const values = Array.from(series.v);

    readingDelta(NUMBER, series, 12, NOW);

    expect(Array.from(series.t)).toEqual(times);
    expect(Array.from(series.v)).toEqual(values);
  });
});
