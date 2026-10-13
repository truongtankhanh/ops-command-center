import { SlidingWindowLimiter } from './sliding-window-limiter';

const PER_SECOND = { ttl: 1_000, limit: 5 };

describe('SlidingWindowLimiter', () => {
  it('admits `limit` calls at once and refuses the next', () => {
    const limiter = new SlidingWindowLimiter(PER_SECOND);

    const results = Array.from({ length: 6 }, () => limiter.tryTake(0));

    expect(results).toEqual([true, true, true, true, true, false]);
  });

  it('admits again once the oldest call is a whole window old, and not a moment before', () => {
    const limiter = new SlidingWindowLimiter(PER_SECOND);
    for (let i = 0; i < 5; i++) limiter.tryTake(0);

    expect(limiter.tryTake(999)).toBe(false);
    expect(limiter.tryTake(1_000)).toBe(true);
  });

  it('counts a refused call for nothing: it does not push the window forward', () => {
    const limiter = new SlidingWindowLimiter(PER_SECOND);
    for (let i = 0; i < 5; i++) limiter.tryTake(0);

    for (let t = 100; t < 1_000; t += 100) expect(limiter.tryTake(t)).toBe(false);

    expect(limiter.tryTake(1_000)).toBe(true);
  });

  it('never admits more than `limit` in any rolling window, a window boundary included', () => {
    const limiter = new SlidingWindowLimiter(PER_SECOND);
    const admitted: number[] = [];

    // A call every 50 ms for five seconds: four times what the limit lets through.
    for (let t = 0; t <= 5_000; t += 50) {
      if (limiter.tryTake(t)) admitted.push(t);
    }

    for (const t of admitted) {
      const inWindow = admitted.filter((other) => other > t - 1_000 && other <= t);
      expect(inWindow.length).toBeLessThanOrEqual(5);
    }
    // And it is a limit, not a lockout: about five a second keep getting through.
    expect(admitted.length).toBeGreaterThanOrEqual(25);
  });

  it('spreads the admitted calls: five in the first second leave the sixth for a full window later', () => {
    const limiter = new SlidingWindowLimiter(PER_SECOND);
    const at = [0, 200, 400, 600, 800];
    for (const t of at) expect(limiter.tryTake(t)).toBe(true);

    expect(limiter.tryTake(900)).toBe(false);
    expect(limiter.tryTake(1_000)).toBe(true);
    expect(limiter.tryTake(1_100)).toBe(false);
    expect(limiter.tryTake(1_200)).toBe(true);
  });

  it('refuses rather than throws when the clock goes backwards', () => {
    const limiter = new SlidingWindowLimiter(PER_SECOND);
    for (let i = 0; i < 5; i++) limiter.tryTake(10_000);

    expect(() => limiter.tryTake(5_000)).not.toThrow();
    expect(limiter.tryTake(5_000)).toBe(false);
  });

  it('admits nothing with a limit of 0', () => {
    const limiter = new SlidingWindowLimiter({ ttl: 1_000, limit: 0 });

    expect(limiter.tryTake(0)).toBe(false);
    expect(limiter.tryTake(5_000)).toBe(false);
  });

  it('keeps one history per instance', () => {
    const a = new SlidingWindowLimiter(PER_SECOND);
    const b = new SlidingWindowLimiter(PER_SECOND);
    for (let i = 0; i < 5; i++) a.tryTake(0);

    expect(a.tryTake(0)).toBe(false);
    expect(b.tryTake(0)).toBe(true);
  });
});
