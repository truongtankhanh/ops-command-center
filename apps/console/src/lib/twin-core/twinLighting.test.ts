import { mapColors, twinColors } from '../../styles/tokens';
import {
  BASE_LIGHT,
  faceShares,
  faceTones,
  KEY_LIGHT,
  type LightSet,
  linearToSrgb,
  litColour,
  SCENE_LIGHTS,
  srgbToLinear,
} from './twinLighting';

/** The largest distance between two `#rrggbb` colours on any channel, in 1/255. */
function channelDistance(a: string, b: string): number {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [channels(a), channels(b)];
  return Math.max(...x.map((value, i) => Math.abs(value - y[i]!)));
}

/** The rule's tolerance: a face within 6 of 255 per channel of its token (ADR-0020 "Settled in V3-12.1"). */
const TOLERANCE = 6;

describe('faceTones', () => {
  // The neutral materials: one albedo, the top, lit by the scene's lights (hover and alarm are mixes per face, not held).
  const neutral = {
    idle: twinColors.idle,
    steel: twinColors.steel,
    concrete: twinColors.concrete,
    stale: twinColors.stale,
  };

  it.each(Object.entries(neutral))(
    'draws the %s top, south and east faces within 6 of 255 of their tokens',
    (_, faces) => {
      const drawn = faceTones(faces.top);
      expect(channelDistance(drawn.top, faces.top)).toBeLessThanOrEqual(TOLERANCE);
      expect(channelDistance(drawn.south, faces.south)).toBeLessThanOrEqual(TOLERANCE);
      expect(channelDistance(drawn.east, faces.east)).toBeLessThanOrEqual(TOLERANCE);
    },
  );

  it('uses the scene lights when none are given', () => {
    expect(faceTones(twinColors.idle.top)).toEqual(faceTones(twinColors.idle.top, SCENE_LIGHTS));
  });

  it('draws the south face darker than the top and the east face darker than the south', () => {
    const [top, south, east] = Object.values(faceTones(twinColors.idle.top)).map((hex) =>
      parseInt(hex.slice(3, 5), 16),
    );
    expect(south).toBeLessThan(top!);
    expect(east).toBeLessThan(south!);
  });
});

describe('the lit ground', () => {
  // The ground's fill layers are Lambert (V3-12.3): a face looking up must still read as its token.
  const fills: [string, string][] = [
    ['the boundary', twinColors.ground],
    ['a road', twinColors.road],
    ...Object.entries(mapColors.zoneFill).map(([kind, hex]): [string, string] => [
      `the ${kind} zone fill`,
      hex,
    ]),
  ];

  it.each(fills)('draws %s within 1 of 255 of its colour', (_, hex) => {
    expect(channelDistance(litColour(hex, faceShares(SCENE_LIGHTS).top), hex)).toBeLessThanOrEqual(
      1,
    );
  });
});

describe('faceShares', () => {
  const shares = faceShares(SCENE_LIGHTS);

  it('lights the south and east faces above the base, so the home view shows them apart', () => {
    expect(shares.south).toBeGreaterThan(BASE_LIGHT);
    // East faces away from a key in the west: the base only, darker than the south.
    expect(shares.east).toBe(BASE_LIGHT);
    expect(shares.south).toBeGreaterThan(shares.east);
  });

  it('lights the west face from the side and leaves the north at the base', () => {
    expect(shares.west).toBeGreaterThan(shares.south);
    expect(shares.north).toBe(BASE_LIGHT);
  });

  it('gives the top nearly its full colour', () => {
    expect(shares.top).toBeGreaterThan(0.95);
    expect(shares.top).toBeLessThanOrEqual(1);
  });

  it('depends on the direction only, not on its length', () => {
    const far: LightSet = { ...SCENE_LIGHTS, towards: [-5.7, 7.5, 3.4] };
    expect(faceShares(far).top).toBeCloseTo(shares.top, 10);
  });

  it('gives a face turned away from the key the base alone', () => {
    const overhead: LightSet = { base: 0.3, key: KEY_LIGHT, towards: [0, 1, 0] };
    expect(faceShares(overhead)).toMatchObject({ south: 0.3, east: 0.3, west: 0.3, north: 0.3 });
    expect(faceShares(overhead).top).toBeCloseTo(0.3 + KEY_LIGHT, 10);
  });
});

describe('the sRGB transfer functions', () => {
  it('keep black and white', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 10);
    expect(linearToSrgb(0)).toBe(0);
    expect(linearToSrgb(1)).toBeCloseTo(1, 10);
  });

  it('decode mid grey to about a fifth of the light', () => {
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214, 3);
  });

  it('round-trip every byte', () => {
    for (let byte = 0; byte <= 255; byte += 1) {
      expect(Math.round(linearToSrgb(srgbToLinear(byte / 255)) * 255)).toBe(byte);
    }
  });

  it('draws a face that gets all the light as its own colour', () => {
    expect(litColour(twinColors.idle.top, 1)).toBe(twinColors.idle.top);
  });
});
