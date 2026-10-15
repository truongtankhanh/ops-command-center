import { SPARK_HEIGHT, SPARK_WIDTH, sparklineGeometry, type SparklineInput } from './sparkline';

const MINUTE = 60_000;
const WINDOW = 15 * MINUTE;

/** A 15-minute window starting at 0, so a time in ms is its offset into the window. */
const input = (overrides: Partial<SparklineInput>): SparklineInput => ({
  times: [],
  values: [],
  from: 0,
  to: WINDOW,
  ...overrides,
});

const ys = (g: ReturnType<typeof sparklineGeometry>): number[] => g.points.map(([, y]) => y);

describe('sparklineGeometry', () => {
  describe('scaling', () => {
    it('maps the window to the width and a higher value to a smaller y', () => {
      const g = sparklineGeometry(input({ times: [0, WINDOW / 2, WINDOW], values: [0, 5, 10] }));

      expect(g.points.map(([x]) => x)).toEqual([0, SPARK_WIDTH / 2, SPARK_WIDTH]);
      // Domain 0..10 padded by 10 % is -1..11 over the plot's 3..25.
      expect(g.points[0]?.[1]).toBeCloseTo(23.1667, 3);
      expect(g.points[2]?.[1]).toBeCloseTo(4.8333, 3);
      expect(g.dot).toEqual({ x: SPARK_WIDTH, y: g.points[2]?.[1] });
    });

    it('accepts the typed arrays a ring buffer hands over', () => {
      const g = sparklineGeometry(
        input({ times: Float64Array.of(0, WINDOW), values: Float32Array.of(1, 2) }),
      );

      expect(g.points).toHaveLength(2);
    });

    it('stays inside the height', () => {
      const g = sparklineGeometry(
        input({ times: [0, MINUTE, 2 * MINUTE], values: [-50, 400, 12], limit: 900 }),
      );

      for (const y of [...ys(g), g.limitY ?? 0]) {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(SPARK_HEIGHT);
      }
    });
  });

  describe('gaps', () => {
    it('stops at the last reading: a series ending 40 s before now ends before the right edge', () => {
      const g = sparklineGeometry(input({ times: [0, WINDOW - 40_000], values: [1, 2] }));

      const lastX = g.points[g.points.length - 1]?.[0] ?? SPARK_WIDTH;
      expect(lastX).toBeCloseTo(((WINDOW - 40_000) / WINDOW) * SPARK_WIDTH, 5);
      expect(lastX).toBeLessThan(SPARK_WIDTH);
      expect(g.dot?.x).toBe(lastX);
    });

    it('is blank before the first reading', () => {
      const g = sparklineGeometry(input({ times: [WINDOW / 2, WINDOW], values: [1, 2] }));

      expect(g.points[0]?.[0]).toBe(SPARK_WIDTH / 2);
    });

    it('joins readings across a gap instead of inventing an outage', () => {
      const g = sparklineGeometry(input({ times: [0, 1_000, 800_000], values: [1, 1, 1] }));

      expect(g.points).toHaveLength(3);
    });

    it('draws only the limit for an empty series', () => {
      const g = sparklineGeometry(input({ limit: 85 }));

      expect(g.points).toEqual([]);
      expect(g.dot).toBeNull();
      // A domain of limit ± 1 puts the limit at mid-plot.
      expect(g.limitY).toBeCloseTo(14, 5);
    });

    it('draws nothing for an empty series without a limit', () => {
      expect(sparklineGeometry(input({}))).toEqual({ points: [], dot: null, limitY: null });
    });

    it('gives a single reading a dot and no line to draw', () => {
      const g = sparklineGeometry(input({ times: [WINDOW / 2], values: [7] }));

      expect(g.points).toHaveLength(1);
      expect(g.dot).toEqual({ x: SPARK_WIDTH / 2, y: g.points[0]?.[1] });
    });
  });

  describe('steps', () => {
    const times = [0, 5 * MINUTE, 10 * MINUTE];
    const values = [0, 1, 0];

    it('holds the value until the next reading, then jumps', () => {
      const g = sparklineGeometry(input({ times, values, step: true }));

      expect(g.points).toHaveLength(5);
      for (let index = 1; index < g.points.length; index++) {
        const [x0, y0] = g.points[index - 1] ?? [0, 0];
        const [x1, y1] = g.points[index] ?? [0, 0];
        // Never a slope: each segment is horizontal or vertical.
        expect(x0 === x1 || y0 === y1).toBe(true);
      }
    });

    it('slopes without `step`', () => {
      const g = sparklineGeometry(input({ times, values }));

      expect(g.points).toHaveLength(3);
    });

    it('keeps the dot on the newest reading', () => {
      const g = sparklineGeometry(input({ times, values, step: true }));

      expect(g.dot).toEqual({ x: g.points[4]?.[0], y: g.points[4]?.[1] });
    });
  });

  describe('domain', () => {
    it('includes the limit, above and below the data', () => {
      const above = sparklineGeometry(input({ times: [0, MINUTE], values: [10, 11], limit: 50 }));
      const below = sparklineGeometry(input({ times: [0, MINUTE], values: [60, 61], limit: 20 }));

      expect(above.limitY).toBeLessThan(Math.min(...ys(above)));
      expect(below.limitY).toBeGreaterThan(Math.max(...ys(below)));
    });

    it('centres a flat series', () => {
      const g = sparklineGeometry(input({ times: [0, MINUTE], values: [5, 5] }));

      expect(ys(g)).toEqual([14, 14]);
    });

    it('ignores a range far wider than the data', () => {
      const wide = sparklineGeometry(
        input({ times: [0, MINUTE], values: [70, 72], range: { min: 0, max: 100_000 } }),
      );
      const none = sparklineGeometry(input({ times: [0, MINUTE], values: [70, 72] }));

      expect(ys(wide)).toEqual(ys(none));
    });

    it('widens to a range close to the data', () => {
      const tight = sparklineGeometry(
        input({ times: [0, MINUTE], values: [70, 72], range: { min: 69, max: 73 } }),
      );

      // Domain 69..73 padded by 10 % is 68.6..73.4.
      expect(tight.points[0]?.[1]).toBeCloseTo(18.5833, 3);
      expect(tight.points[1]?.[1]).toBeCloseTo(9.4167, 3);
    });

    it('always uses the range of a step series, its codomain', () => {
      const boolean = sparklineGeometry(
        input({ times: [0, MINUTE], values: [1, 1], step: true, range: { min: 0, max: 1 } }),
      );
      const flat = sparklineGeometry(
        input({ times: [0, MINUTE], values: [1, 1], range: { min: 0, max: 1 } }),
      );

      // Domain 0..1 padded by 10 % puts 1 near the top; a flat non-step series is centred.
      expect(boolean.points[0]?.[1]).toBeCloseTo(4.8333, 3);
      expect(flat.points[0]?.[1]).toBe(14);
    });

    it('ignores a range with an open bound', () => {
      const open = sparklineGeometry(
        input({ times: [0, MINUTE], values: [70, 72], step: true, range: { min: 0, max: null } }),
      );
      const none = sparklineGeometry(input({ times: [0, MINUTE], values: [70, 72], step: true }));

      expect(ys(open)).toEqual(ys(none));
    });
  });

  describe('bad input', () => {
    it('skips non-finite readings and readings outside the window', () => {
      const g = sparklineGeometry(
        input({
          times: [-1_000, 0, 100_000, WINDOW + 1, Number.NaN],
          values: [1, 2, Number.NaN, 3, 4],
        }),
      );

      expect(g.points).toHaveLength(1);
      expect(g.points[0]?.[0]).toBe(0);
    });

    it('never returns NaN', () => {
      const g = sparklineGeometry(
        input({
          times: [0, Number.POSITIVE_INFINITY, MINUTE],
          values: [Number.NaN, 1, 1],
          limit: Number.NaN,
          range: { min: Number.NaN, max: 1 },
        }),
      );

      expect(g.limitY).toBeNull();
      expect(g.points.flat().every(Number.isFinite)).toBe(true);
    });

    it('draws no readings for an empty or reversed window, but still the limit', () => {
      for (const bounds of [
        { from: 5, to: 5 },
        { from: 10, to: 5 },
        { from: 0, to: Number.NaN },
      ]) {
        const g = sparklineGeometry(input({ ...bounds, times: [5, 7], values: [1, 2], limit: 3 }));

        expect(g.points).toEqual([]);
        expect(g.dot).toBeNull();
        expect(g.limitY).toBeCloseTo(14, 5);
      }
    });

    it('uses the shorter of mismatched arrays', () => {
      const g = sparklineGeometry(input({ times: [0, MINUTE, 2 * MINUTE], values: [1, 2] }));

      expect(g.points).toHaveLength(2);
    });
  });
});
