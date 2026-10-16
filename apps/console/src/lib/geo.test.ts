import type { Camera, LngLat } from '@occ/contracts';
import { bearingDeg, isInView, offsetM } from './geo';

const APEX: LngLat = [108.44, 11.95];

/** The point `metres` from the camera along `bearing` (degrees clockwise from north). */
const at = (bearing: number, metres: number): LngLat => {
  const radians = (bearing * Math.PI) / 180;
  return offsetM(APEX, metres * Math.sin(radians), metres * Math.cos(radians));
};

const camera = (
  fieldOfView: Camera['fieldOfView'],
  position: LngLat = APEX,
): Pick<Camera, 'position' | 'fieldOfView'> => ({ position, fieldOfView });

/** Facing east, 60° wide, 100 m. */
const EAST = camera({ heading: 90, angle: 60, range: 100 });

describe('bearingDeg', () => {
  it.each([
    ['north', at(0, 50), 0],
    ['east', at(90, 50), 90],
    ['south', at(180, 50), 180],
    ['west', at(270, 50), 270],
    ['north-east', at(45, 50), 45],
  ])('is %s from the camera', (_name, to, expected) => {
    expect(bearingDeg(APEX, to)).toBeCloseTo(expected, 3);
  });

  it('stays in [0, 360): just west of north is just under 360', () => {
    const bearing = bearingDeg(APEX, at(359.5, 50));

    expect(bearing).toBeGreaterThan(359);
    expect(bearing).toBeLessThan(360);
  });

  it('gives 0 for two equal points', () => {
    expect(bearingDeg(APEX, APEX)).toBe(0);
  });
});

describe('isInView', () => {
  it('sees a point in the sector', () => {
    expect(isInView(at(90, 50), EAST)).toBe(true);
    expect(isInView(at(110, 80), EAST)).toBe(true);
  });

  it('does not see a point beyond the range, and sees one just inside it', () => {
    expect(isInView(at(90, 99), EAST)).toBe(true);
    expect(isInView(at(90, 101), EAST)).toBe(false);
  });

  it('does not see a point outside the angle', () => {
    // Half the angle is 30°: 25° off is inside, 35° off is not, behind is not.
    expect(isInView(at(115, 50), EAST)).toBe(true);
    expect(isInView(at(125, 50), EAST)).toBe(false);
    expect(isInView(at(270, 50), EAST)).toBe(false);
  });

  it('wraps at north', () => {
    const north = camera({ heading: 350, angle: 40, range: 100 });

    expect(isInView(at(5, 50), north)).toBe(true);
    expect(isInView(at(355, 50), north)).toBe(true);
    expect(isInView(at(335, 50), north)).toBe(true);
    expect(isInView(at(40, 50), north)).toBe(false);
    expect(isInView(at(300, 50), north)).toBe(false);
  });

  it('wraps at north the other way, from a heading just past it', () => {
    const north = camera({ heading: 10, angle: 40, range: 100 });

    expect(isInView(at(355, 50), north)).toBe(true);
    expect(isInView(at(30, 50), north)).toBe(true);
    expect(isInView(at(60, 50), north)).toBe(false);
  });

  it('sees all round with a 360° view, up to the range', () => {
    const round = camera({ heading: 0, angle: 360, range: 100 });

    expect(isInView(at(180, 50), round)).toBe(true);
    expect(isInView(at(270, 99), round)).toBe(true);
    expect(isInView(at(270, 101), round)).toBe(false);
  });

  it('sees a point on the camera, which has no direction', () => {
    expect(isInView(APEX, camera({ heading: 90, angle: 10, range: 100 }))).toBe(true);
  });

  it('sees nothing when its orientation is not known, or the field is missing altogether', () => {
    expect(isInView(at(90, 10), camera(null))).toBe(false);
    // An API replica from before IMP-24 omits the field; the contract type does not model it.
    const old = { position: APEX } as Pick<Camera, 'position' | 'fieldOfView'>;
    expect(isInView(at(90, 10), old)).toBe(false);
  });

  it('measures from the camera, not from the origin', () => {
    const elsewhere = offsetM(APEX, 300, -200);
    const view = camera({ heading: 0, angle: 90, range: 50 }, elsewhere);
    const ahead = offsetM(elsewhere, 0, 30);

    expect(isInView(ahead, view)).toBe(true);
    expect(isInView(APEX, view)).toBe(false);
  });
});
