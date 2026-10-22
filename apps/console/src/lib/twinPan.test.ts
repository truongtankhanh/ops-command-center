import { describe, expect, it } from 'vitest';
import {
  centreTargetOf,
  HOLD_FRACTION_PER_S,
  HOLD_MAX_DT_S,
  holdDelta,
  PAN_DIRECTIONS,
  padStep,
} from './twinPan';

describe('PAN_DIRECTIONS', () => {
  it('has eight directions with unique ids and names', () => {
    expect(PAN_DIRECTIONS).toHaveLength(8);
    expect(new Set(PAN_DIRECTIONS.map((d) => d.id)).size).toBe(8);
    expect(new Set(PAN_DIRECTIONS.map((d) => d.name)).size).toBe(8);
  });

  it('gives every vector length 1, so a diagonal is not faster than an axis', () => {
    for (const { dx, dy } of PAN_DIRECTIONS) expect(Math.hypot(dx, dy)).toBeCloseTo(1, 10);
  });

  it('makes opposite directions negatives of each other', () => {
    for (let i = 0; i < 4; i += 1) {
      const a = PAN_DIRECTIONS[i];
      const b = PAN_DIRECTIONS[i + 4];
      expect(a && b).toBeTruthy();
      expect(a!.dx + b!.dx).toBeCloseTo(0, 10);
      expect(a!.dy + b!.dy).toBeCloseTo(0, 10);
    }
  });

  it('puts up forward and right to the camera right', () => {
    const byId = Object.fromEntries(PAN_DIRECTIONS.map((d) => [d.id, d]));
    expect(byId['up']).toMatchObject({ dx: 0, dy: 1 });
    expect(byId['right']).toMatchObject({ dx: 1, dy: 0 });
    expect(byId['up-right']?.dx).toBeCloseTo(Math.SQRT1_2, 10);
    expect(byId['up-right']?.dy).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it('names directions in screen words, never compass points', () => {
    for (const { name } of PAN_DIRECTIONS) expect(name).not.toMatch(/north|south|east|west/i);
  });
});

describe('padStep', () => {
  it('is about a quarter of the distance for a 50° lens on a 16:9 stage', () => {
    expect(padStep(50, 16 / 9)).toBeCloseTo(0.2487, 3);
  });

  it('grows with the aspect and with the share', () => {
    expect(padStep(50, 2)).toBeGreaterThan(padStep(50, 1));
    expect(padStep(50, 1, 0.3)).toBeCloseTo(2 * padStep(50, 1, 0.15), 10);
  });

  it('gives no step for input that is not a positive finite number', () => {
    expect(padStep(50, 0)).toBe(0);
    expect(padStep(50, -1)).toBe(0);
    expect(padStep(50, Number.NaN)).toBe(0);
    expect(padStep(0, 1)).toBe(0);
    expect(padStep(180, 1)).toBe(0);
    expect(padStep(50, 1, 0)).toBe(0);
  });
});

describe('holdDelta', () => {
  const up = { dx: 0, dy: 1 };

  it('is proportional to the frame time up to the cap', () => {
    const one = holdDelta(up, 0.01);
    const two = holdDelta(up, 0.02);
    expect(two.dy).toBeCloseTo(2 * one.dy, 10);
    expect(one.dy).toBeCloseTo(HOLD_FRACTION_PER_S * 0.01, 10);
  });

  it('is constant beyond the cap, so a stall does not jump the view', () => {
    const capped = holdDelta(up, HOLD_MAX_DT_S);
    expect(holdDelta(up, 1).dy).toBeCloseTo(capped.dy, 10);
    expect(holdDelta(up, 60).dy).toBeCloseTo(capped.dy, 10);
  });

  it('moves a diagonal and an axis at the same speed', () => {
    const diagonal = holdDelta({ dx: Math.SQRT1_2, dy: Math.SQRT1_2 }, 0.016);
    const axis = holdDelta(up, 0.016);
    expect(Math.hypot(diagonal.dx, diagonal.dy)).toBeCloseTo(Math.hypot(axis.dx, axis.dy), 10);
  });

  it('moves nothing for a zero, negative or non-finite frame time', () => {
    expect(holdDelta(up, 0)).toEqual({ dx: 0, dy: 0 });
    expect(holdDelta(up, -0.01)).toEqual({ dx: 0, dy: 0 });
    expect(holdDelta(up, Number.NaN)).toEqual({ dx: 0, dy: 0 });
  });
});

describe('centreTargetOf', () => {
  it('centres a part, an asset and an incident with an asset on the asset', () => {
    expect(centreTargetOf({ kind: 'part', assetCode: 'CT-01', part: 'FanBlade' })).toEqual({
      kind: 'asset',
      code: 'CT-01',
    });
    expect(centreTargetOf({ kind: 'asset', assetCode: 'CT-01' })).toEqual({
      kind: 'asset',
      code: 'CT-01',
    });
    expect(centreTargetOf({ kind: 'incident-asset', assetCode: 'GEN-01' })).toEqual({
      kind: 'asset',
      code: 'GEN-01',
    });
  });

  it('centres an incident with no asset on its beacon', () => {
    expect(centreTargetOf({ kind: 'incident', incidentId: 'abc' })).toEqual({
      kind: 'incident',
      id: 'abc',
    });
  });

  it('gives nothing for no selection', () => {
    expect(centreTargetOf(null)).toBeNull();
  });
});
