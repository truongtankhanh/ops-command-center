import type { LngLat } from '@occ/contracts';
import { circle, isInPolygon, offset, randomPointIn, rectangle, roundedRectangle } from './geo';

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

  it('builds a closed rounded rectangle inside the plain one', () => {
    const ring = roundedRectangle(center, 100, 50, 10, 6);
    // Four corners of 6 segments (7 points each), closed by repeating the first point.
    expect(ring).toHaveLength(29);
    expect(ring.at(-1)).toEqual(ring[0]);
    // Starts where the south-east corner meets the south edge.
    const [lng, lat] = offset(center, 40, -25);
    expect(ring[0]![0]).toBeCloseTo(lng, 6);
    expect(ring[0]![1]).toBeCloseTo(lat, 6);
    const box = rectangle(center, 100, 50);
    for (const point of ring) expect(isInPolygon(point, box)).toBe(true);
  });

  it('builds a closed circle at the requested radius, starting due east', () => {
    const ring = circle(center, 9, 24);
    expect(ring).toHaveLength(25);
    expect(ring.at(-1)).toEqual(ring[0]);
    expect(ring[0]).toEqual(offset(center, 9, 0));
    // A quarter turn later it is due north.
    expect(ring[6]![1] - center[1]).toBeCloseTo(9 / 111_320, 6);
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

  describe('isInPolygon', () => {
    const ring = rectangle(center, 100, 50);
    const [southWest, southEast, northEast] = ring as [LngLat, LngLat, LngLat];

    it('accepts the centre and any simulator point', () => {
      expect(isInPolygon(center, ring)).toBe(true);
      for (const roll of [0, 0.5, 0.999]) {
        const point = randomPointIn(ring, () => roll);
        expect(isInPolygon(point, ring)).toBe(true);
      }
    });

    it('rejects points outside, including ones beside the ring', () => {
      expect(isInPolygon(offset(center, 0, 40), ring)).toBe(false);
      expect(isInPolygon(offset(center, 60, 0), ring)).toBe(false);
      expect(isInPolygon(offset(northEast, 1, 1), ring)).toBe(false);
    });

    it('counts a vertex or a point on an edge as inside', () => {
      expect(isInPolygon(southWest, ring)).toBe(true);
      const midSouthEdge: LngLat = [(southWest[0] + southEast[0]) / 2, southWest[1]];
      expect(isInPolygon(midSouthEdge, ring)).toBe(true);
    });

    it('handles a concave ring', () => {
      // An L shape: the notch at the top right is outside.
      const l: LngLat[] = [
        [0, 0],
        [2, 0],
        [2, 1],
        [1, 1],
        [1, 2],
        [0, 2],
        [0, 0],
      ];
      expect(isInPolygon([0.5, 1.5], l)).toBe(true);
      expect(isInPolygon([1.5, 0.5], l)).toBe(true);
      expect(isInPolygon([1.5, 1.5], l)).toBe(false);
    });
  });
});
