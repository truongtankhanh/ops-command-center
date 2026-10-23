import {
  ageMs,
  isStale,
  type ServerClock,
  serverNow,
  STALE_FLOOR_MS,
  staleAfterMs,
} from './telemetryFreshness';

const headline = (...seconds: number[]) =>
  seconds.map((expectedIntervalS) => ({ expectedIntervalS }));

describe('staleAfterMs', () => {
  // The worked examples of asset-classes.md, question 6 (V2-08.1).
  it.each([
    ['cooling tower CT-01 (1 s, 5 s): the floor', [1, 5], 5_000],
    ['lift LFT-B1 (2 s, 30 s)', [2, 30], 6_000],
    ['UPS UPS-01 (5 s, 30 s)', [5, 30], 15_000],
    ['gas detector GAS-L1 (5 s)', [5], 15_000],
    ['indoor climate ICS-DC (60 s, 60 s)', [60, 60], 180_000],
    ['standby generator GEN-01 (60 s, 60 s)', [60, 60], 180_000],
    ['leak sensor LKS-B3 (300 s, 3600 s): the shortest, not the slowest', [300, 3600], 900_000],
  ])('%s', (_name, intervals, expected) => {
    expect(staleAfterMs(headline(...intervals))).toBe(expected);
  });

  it('never goes below the floor', () => {
    expect(staleAfterMs(headline(0.5))).toBe(STALE_FLOOR_MS);
    expect(staleAfterMs(headline(1.6))).toBe(STALE_FLOOR_MS);
  });

  it('is an integer number of milliseconds', () => {
    expect(staleAfterMs(headline(2.001))).toBe(6_003);
  });

  it('is null when no interval is known', () => {
    expect(staleAfterMs([])).toBeNull();
    expect(staleAfterMs(headline(0, -1, Number.NaN))).toBeNull();
  });

  it('ignores an unusable interval next to a usable one', () => {
    expect(staleAfterMs(headline(0, 10))).toBe(30_000);
  });
});

describe('ageMs', () => {
  const receivedAt = '2026-10-15T08:00:00.000Z';
  const at = Date.parse(receivedAt);

  it('is the time since the reading, on the clock it is given', () => {
    expect(ageMs(receivedAt, at + 72_000)).toBe(72_000);
  });

  it('is never negative', () => {
    expect(ageMs(receivedAt, at - 2_000)).toBe(0);
  });
});

describe('isStale', () => {
  const receivedAt = '2026-10-15T08:00:00.000Z';
  const at = Date.parse(receivedAt);
  const tenSeconds = staleAfterMs(headline(10, 30)); // 30 s: clear of the floor

  it('is false at 2.9 intervals and true at 3.0', () => {
    expect(tenSeconds).toBe(30_000);
    expect(isStale(receivedAt, tenSeconds, at + 29_000)).toBe(false);
    expect(isStale(receivedAt, tenSeconds, at + 30_000)).toBe(true);
    expect(isStale(receivedAt, tenSeconds, at + 31_000)).toBe(true);
  });

  it('waits for the floor on a fast point', () => {
    const fast = staleAfterMs(headline(1, 5));
    expect(isStale(receivedAt, fast, at + 4_999)).toBe(false);
    expect(isStale(receivedAt, fast, at + 5_000)).toBe(true);
  });

  it('is false when the threshold is unknown', () => {
    expect(isStale(receivedAt, null, at + 3_600_000)).toBe(false);
  });

  it('depends on the server time it is given, never on the browser clock', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(at + 10 * 60_000); // a browser ten minutes ahead of the API
      expect(isStale(receivedAt, tenSeconds, at + 5_000)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('serverNow', () => {
  const clock: ServerClock = { at: Date.parse('2026-10-15T08:00:00.000Z'), mono: 1_000 };

  it('adds the monotonic time since the anchor arrived', () => {
    expect(serverNow(clock, 1_000)).toBe(clock.at);
    expect(serverNow(clock, 4_500)).toBe(clock.at + 3_500);
  });

  it('is null before any message has anchored it', () => {
    expect(serverNow(null, 4_500)).toBeNull();
  });
});
