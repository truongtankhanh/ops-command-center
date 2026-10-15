import { createRingBuffer, encodeReading, RING_CAPACITY } from './ringBuffer';

describe('createRingBuffer', () => {
  describe('push', () => {
    it('keeps one point per second, the latest winning', () => {
      const ring = createRingBuffer();

      expect(ring.push(10_000, 1)).toBe(true);
      expect(ring.push(10_400, 2)).toBe(true);
      expect(ring.push(10_999, 3)).toBe(true);

      const { t, v } = ring.toArrays();
      expect(ring.size).toBe(1);
      expect([...t]).toEqual([10_999]);
      expect([...v]).toEqual([3]);
    });

    it('appends a point in a later second', () => {
      const ring = createRingBuffer();

      ring.push(10_000, 1);
      ring.push(11_000, 2);

      const { t, v } = ring.toArrays();
      expect([...t]).toEqual([10_000, 11_000]);
      expect([...v]).toEqual([1, 2]);
    });

    it('never reorders: a point in an earlier second is ignored', () => {
      const ring = createRingBuffer();
      ring.push(10_000, 1);
      ring.push(12_000, 2);

      expect(ring.push(11_000, 99)).toBe(false);

      expect([...ring.toArrays().v]).toEqual([1, 2]);
    });

    it('ignores a non-finite time or value', () => {
      const ring = createRingBuffer();

      expect(ring.push(Number.NaN, 1)).toBe(false);
      expect(ring.push(10_000, Number.POSITIVE_INFINITY)).toBe(false);

      expect(ring.size).toBe(0);
    });

    it('holds at most its capacity and drops the oldest', () => {
      const ring = createRingBuffer();

      for (let second = 0; second <= RING_CAPACITY; second++) ring.push(second * 1000, second);

      const { t, v } = ring.toArrays();
      expect(RING_CAPACITY).toBe(900);
      expect(ring.size).toBe(RING_CAPACITY);
      expect(t[0]).toBe(1000);
      expect(v[0]).toBe(1);
      expect(t[RING_CAPACITY - 1]).toBe(RING_CAPACITY * 1000);
    });

    it('reads in time order after wrapping around', () => {
      const ring = createRingBuffer(3);

      for (let second = 1; second <= 5; second++) ring.push(second * 1000, second);

      expect([...ring.toArrays().v]).toEqual([3, 4, 5]);
    });

    it('replaces the newest point of a full buffer in place', () => {
      const ring = createRingBuffer(3);
      for (let second = 1; second <= 3; second++) ring.push(second * 1000, second);

      ring.push(3_500, 30);

      expect([...ring.toArrays().v]).toEqual([1, 2, 30]);
    });
  });

  describe('seed', () => {
    it('fills the time before the live points, in order', () => {
      const ring = createRingBuffer();
      ring.push(20_000, 7);

      ring.seed([
        { t: 10_000, v: 1 },
        { t: 15_000, v: 2 },
      ]);

      const { t, v } = ring.toArrays();
      expect([...t]).toEqual([10_000, 15_000, 20_000]);
      expect([...v]).toEqual([1, 2, 7]);
    });

    it('never overwrites a live point of the same second', () => {
      const ring = createRingBuffer();
      ring.push(10_000, 7);

      ring.seed([
        { t: 5_000, v: 1 },
        { t: 10_400, v: 99 },
      ]);

      const { t, v } = ring.toArrays();
      expect([...t]).toEqual([5_000, 10_000]);
      expect([...v]).toEqual([1, 7]);
    });

    it('sorts an unordered seed and keeps the newest points when it is larger than the capacity', () => {
      const ring = createRingBuffer(3);

      ring.seed([
        { t: 4_000, v: 4 },
        { t: 1_000, v: 1 },
        { t: 3_000, v: 3 },
        { t: 2_000, v: 2 },
      ]);

      expect([...ring.toArrays().v]).toEqual([2, 3, 4]);
    });

    it('merges into a buffer that has wrapped, and keeps accepting live points', () => {
      const ring = createRingBuffer(4);
      for (let second = 10; second <= 15; second++) ring.push(second * 1000, second);

      ring.seed([{ t: 9_000, v: 9 }]);
      ring.push(16_000, 16);

      expect([...ring.toArrays().v]).toEqual([13, 14, 15, 16]);
    });

    it('is a no-op for an empty or non-finite seed', () => {
      const ring = createRingBuffer();
      ring.push(10_000, 1);

      ring.seed([]);
      ring.seed([{ t: Number.NaN, v: 1 }]);

      expect([...ring.toArrays().v]).toEqual([1]);
    });
  });

  describe('toArrays', () => {
    it('returns typed arrays, empty for an empty buffer', () => {
      const { t, v } = createRingBuffer().toArrays();

      expect(t).toBeInstanceOf(Float64Array);
      expect(v).toBeInstanceOf(Float32Array);
      expect(t).toHaveLength(0);
      expect(v).toHaveLength(0);
    });

    it('keeps the millisecond of an epoch time', () => {
      const ring = createRingBuffer();
      const at = Date.parse('2026-10-15T08:00:00.123Z');

      ring.push(at, 1);

      expect(ring.toArrays().t[0]).toBe(at);
    });

    it('returns copies: changing them leaves the buffer alone', () => {
      const ring = createRingBuffer();
      ring.push(10_000, 5);

      const first = ring.toArrays();
      first.t.fill(-1);
      first.v.fill(-1);
      const second = ring.toArrays();

      expect(first.t.buffer).not.toBe(second.t.buffer);
      expect([...second.t]).toEqual([10_000]);
      expect([...second.v]).toEqual([5]);
    });
  });

  it('clear empties it and it can be used again', () => {
    const ring = createRingBuffer();
    ring.push(10_000, 1);

    ring.clear();
    ring.push(5_000, 2);

    expect(ring.size).toBe(1);
    expect([...ring.toArrays().v]).toEqual([2]);
  });
});

describe('encodeReading', () => {
  const states = ['up', 'down', 'moving'];

  it.each([
    [71.5, null, 71.5],
    [0, null, 0],
    [true, null, 1],
    [false, null, 0],
    ['up', states, 0],
    ['moving', states, 2],
  ])('encodes %s with %j as %s', (value, enumValues, expected) => {
    expect(encodeReading(value, enumValues)).toBe(expected);
  });

  it.each([
    ['a value the enum does not list', 'sideways', states],
    ['an enum value with no enumValues', 'up', null],
    ['a non-finite number', Number.NaN, null],
    ['an infinite number', Number.POSITIVE_INFINITY, null],
  ])('has no number for %s', (_name, value, enumValues) => {
    expect(encodeReading(value, enumValues)).toBeNull();
  });
});
