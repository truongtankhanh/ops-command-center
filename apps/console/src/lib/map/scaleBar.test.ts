import { metresToPixels } from './geo';
import {
  formatLength,
  mapMetresPerPixel,
  niceLength,
  SCALE_BAR_MAX_PX,
  scaleReading,
} from './scaleBar';

describe('niceLength', () => {
  it('picks the largest 1 / 2 / 5 × 10ⁿ metres that fits the width', () => {
    expect(niceLength(1, 120)).toEqual({ metres: 100, px: 100 });
    expect(niceLength(0.5, 120)).toEqual({ metres: 50, px: 100 });
    expect(niceLength(2.5, 120)).toEqual({ metres: 200, px: 80 });
    expect(niceLength(0.9, 120)?.metres).toBe(100);
    expect(niceLength(0.8, 120)?.metres).toBe(50);
  });

  it('walks the ladder 1, 2, 5 through every decade from a centimetre to a kilometre', () => {
    const ladder = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    // The room for a bar at 1 m/px is 120 m; each ladder step at its own scale lands on exactly itself.
    for (const metres of ladder) {
      expect(niceLength(metres / 100, 120)?.metres).toBe(metres);
    }
  });

  it('keeps the bar between a 2.5th of the width and the width at every scale', () => {
    for (let exponent = -3; exponent <= 3; exponent += 0.05) {
      const nice = niceLength(10 ** exponent, SCALE_BAR_MAX_PX);
      expect(nice).not.toBeNull();
      expect(nice!.px).toBeLessThanOrEqual(SCALE_BAR_MAX_PX + 1e-6);
      expect(nice!.px).toBeGreaterThanOrEqual(SCALE_BAR_MAX_PX / 2.5 - 1e-6);
    }
  });

  it('answers a length that fits exactly, at the boundary of a power of ten and of a 2× or 5× step', () => {
    expect(niceLength(1, 100)).toEqual({ metres: 100, px: 100 });
    expect(niceLength(1, 200)).toEqual({ metres: 200, px: 200 });
    expect(niceLength(1, 500)).toEqual({ metres: 500, px: 500 });
    expect(niceLength(0.001, 100)?.metres).toBe(0.1);
    expect(niceLength(0.1, 120)?.metres).toBe(10);
  });

  it('returns exact figures, not floating-point neighbours of them', () => {
    expect(niceLength(0.003, 120)?.metres).toBe(0.2);
    expect(niceLength(0.0007, 120)?.metres).toBe(0.05);
  });

  it('never exceeds the width it was given', () => {
    for (const metresPerPixel of [0.0062, 0.073, 0.29, 0.8855, 2.34, 17, 123]) {
      const nice = niceLength(metresPerPixel, 120)!;
      expect(nice.px).toBeLessThanOrEqual(120 + 1e-6);
    }
  });

  it('draws nothing when there is no usable scale', () => {
    for (const bad of [0, -1, Number.NaN, Infinity, -Infinity]) {
      expect(niceLength(bad, 120)).toBeNull();
    }
    expect(niceLength(1, 0)).toBeNull();
    expect(niceLength(1, -5)).toBeNull();
    expect(niceLength(1, Number.NaN)).toBeNull();
  });
});

describe('formatLength', () => {
  it('writes centimetres below a metre, metres below a kilometre and kilometres from a thousand', () => {
    expect(formatLength(0.5)).toBe('50 cm');
    expect(formatLength(0.05)).toBe('5 cm');
    expect(formatLength(0.01)).toBe('1 cm');
    expect(formatLength(1)).toBe('1 m');
    expect(formatLength(50)).toBe('50 m');
    expect(formatLength(500)).toBe('500 m');
    expect(formatLength(1000)).toBe('1 km');
    expect(formatLength(2000)).toBe('2 km');
    expect(formatLength(5000)).toBe('5 km');
  });

  it('puts "≈ " in front of an approximation', () => {
    expect(formatLength(50, true)).toBe('≈ 50 m');
    expect(formatLength(0.2, true)).toBe('≈ 20 cm');
    expect(formatLength(1000, true)).toBe('≈ 1 km');
    expect(formatLength(50, false)).toBe('50 m');
  });
});

describe('scaleReading', () => {
  it('carries the label and the width of the same round length', () => {
    expect(scaleReading(1)).toEqual({ label: '100 m', widthPx: 100 });
    expect(scaleReading(0.5)).toEqual({ label: '50 m', widthPx: 100 });
  });

  it('marks the 3D view’s figure as approximate', () => {
    expect(scaleReading(1, { approximate: true })).toEqual({ label: '≈ 100 m', widthPx: 100 });
  });

  it('is the maximum width of the frame', () => {
    expect(SCALE_BAR_MAX_PX).toBe(120);
  });

  it('is null where there is no scale to draw', () => {
    expect(scaleReading(0)).toBeNull();
    expect(scaleReading(Infinity)).toBeNull();
    expect(scaleReading(Number.NaN)).toBeNull();
  });

  it('changes its label only when the length changes, while the width follows every step', () => {
    const near = scaleReading(0.8855)!;
    const closer = scaleReading(0.855)!;
    expect(closer.label).toBe(near.label);
    expect(closer.widthPx).toBeGreaterThan(near.widthPx);
  });
});

describe('mapMetresPerPixel', () => {
  it('is the inverse of the map’s metres-to-pixels', () => {
    for (const [zoom, lat] of [
      [15, 11.953],
      [16.4, 11.953],
      [20, 11.953],
      [16.4, 60],
    ] as const) {
      expect(mapMetresPerPixel(zoom, lat)).toBeCloseTo(1 / metresToPixels(1, zoom, lat), 12);
    }
  });

  it('is MapLibre’s resolution: the equator at zoom 0 spans the world in 512 px', () => {
    expect(mapMetresPerPixel(0, 0)).toBeCloseTo(78271.517, 2);
    expect(mapMetresPerPixel(0, 60)).toBeCloseTo(39135.758, 2);
  });

  it('halves with each zoom level', () => {
    expect(mapMetresPerPixel(17, 11.953)).toBeCloseTo(mapMetresPerPixel(16, 11.953) / 2, 12);
  });

  it('gives the campus its labels from "200 m" at the wide limit to "5 m" at the close one', () => {
    expect(scaleReading(mapMetresPerPixel(15, 11.953))?.label).toBe('200 m');
    expect(scaleReading(mapMetresPerPixel(16.4, 11.953))?.label).toBe('100 m');
    expect(scaleReading(mapMetresPerPixel(20, 11.953))?.label).toBe('5 m');
  });
});
