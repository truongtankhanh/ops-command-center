import { formatClockTime } from '../shared/time';
import { barGeometry, CHART_HEIGHT, CHART_WIDTH, chartLabel, peakBucket } from './alarmChart';
import { ALARM_RATE_WINDOW_MS, RAISED_BUCKETS } from './alarmLoad';

/** Thirty seconds past a minute, as the model's own spec: the chart is anchored at `now`, not on the wall clock. */
const NOW = Date.parse('2026-10-01T12:00:30.000Z');

const quiet = (): number[] => Array.from({ length: RAISED_BUCKETS }, () => 0);
const withCounts = (counts: Record<number, number>): number[] => {
  const buckets = quiet();
  for (const [index, count] of Object.entries(counts)) buckets[Number(index)] = count;
  return buckets;
};

describe('peakBucket', () => {
  it('is null when nothing was raised: there is no peak to say', () => {
    expect(peakBucket(quiet(), NOW)).toBeNull();
    expect(peakBucket([], NOW)).toBeNull();
  });

  it('finds the busiest bucket and the time its 10 minutes began', () => {
    // Bucket 13 is the fifth from the end: it began five windows before `now`.
    const peak = peakBucket(withCounts({ 13: 6, 15: 2 }), NOW);

    expect(peak).toEqual({ count: 6, startedAt: NOW - 5 * ALARM_RATE_WINDOW_MS });
  });

  it('puts the last bucket one window before now, and the first one 3 hours before', () => {
    expect(peakBucket(withCounts({ [RAISED_BUCKETS - 1]: 1 }), NOW)?.startedAt).toBe(
      NOW - ALARM_RATE_WINDOW_MS,
    );
    expect(peakBucket(withCounts({ 0: 1 }), NOW)?.startedAt).toBe(
      NOW - RAISED_BUCKETS * ALARM_RATE_WINDOW_MS,
    );
  });

  it('takes the most recent bucket on a tie', () => {
    const peak = peakBucket(withCounts({ 3: 5, 9: 5, 12: 4 }), NOW);

    expect(peak).toEqual({
      count: 5,
      startedAt: NOW - (RAISED_BUCKETS - 9) * ALARM_RATE_WINDOW_MS,
    });
  });
});

describe('barGeometry', () => {
  it('draws one bar per bucket, left to right, inside the chart', () => {
    const bars = barGeometry(withCounts({ 0: 1, 17: 4 }));

    expect(bars).toHaveLength(RAISED_BUCKETS);
    expect(bars[0]?.x).toBe(0);
    const xs = bars.map((bar) => bar.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    const last = bars[RAISED_BUCKETS - 1]!;
    expect(last.x + last.width).toBeCloseTo(CHART_WIDTH, 1);
  });

  it('gives the busiest bucket the whole height, from the baseline up', () => {
    const [bar] = barGeometry(withCounts({ 0: 8 }));

    expect(bar).toMatchObject({ height: CHART_HEIGHT, y: 0 });
  });

  it('scales the others to it and draws nothing for an empty bucket', () => {
    const bars = barGeometry(withCounts({ 0: 8, 1: 4 }));

    expect(bars[1]?.height).toBe(CHART_HEIGHT / 2);
    expect(bars[2]).toMatchObject({ height: 0, y: CHART_HEIGHT });
  });

  it('never draws an occupied bucket thinner than a visible minimum', () => {
    const [, one] = barGeometry(withCounts({ 0: 200, 1: 1 }));

    expect(one!.height).toBeGreaterThanOrEqual(2);
    expect(one!.y + one!.height).toBeCloseTo(CHART_HEIGHT, 1);
  });

  it('draws nothing for a quiet list or an empty one', () => {
    expect(barGeometry(quiet()).every((bar) => bar.height === 0)).toBe(true);
    expect(barGeometry([])).toEqual([]);
  });
});

describe('chartLabel', () => {
  it('states the window and the peak, which no row repeats', () => {
    const label = chartLabel(withCounts({ 13: 6 }), NOW);

    expect(label).toBe(
      `Raised per 10 minutes over the last 3 hours, peak 6 at ${formatClockTime(NOW - 5 * ALARM_RATE_WINDOW_MS)}`,
    );
  });

  it('says the window alone when nothing was raised', () => {
    expect(chartLabel(quiet(), NOW)).toBe('Raised per 10 minutes over the last 3 hours');
  });
});
