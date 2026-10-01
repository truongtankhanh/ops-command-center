import { offset, randomPointIn, rectangle } from './geo';

describe('geo helpers', () => {
  const center: [number, number] = [108.4415, 11.953];

  it('offsets by roughly the requested distance', () => {
    const [, lat] = offset(center, 0, 111.32);
    expect(lat - center[1]).toBeCloseTo(0.001, 6);
  });

  it('builds a closed rectangle around the centre', () => {
    const ring = rectangle(center, 100, 50);
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
  });

  it('keeps random points inside the inset bounding box', () => {
    const ring = rectangle(center, 100, 50);
    const lngs = ring.map(([lng]) => lng);
    for (const roll of [0, 0.5, 0.999]) {
      const [lng] = randomPointIn(ring, () => roll);
      const span = Math.max(...lngs) - Math.min(...lngs);
      expect(lng).toBeGreaterThanOrEqual(Math.min(...lngs) + span * 0.2 - 1e-7);
      expect(lng).toBeLessThanOrEqual(Math.max(...lngs) - span * 0.2 + 1e-7);
    }
  });
});
