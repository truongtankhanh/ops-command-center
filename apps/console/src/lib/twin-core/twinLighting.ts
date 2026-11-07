/*
 * The scene's light set as plain numbers, and what it does to a face (ADR-0020 "Settled in V3-12.1", refined in
 * V3-12.3). No `three`, so the rule is a test (`twinLighting.test.ts`) and not a comment. `twin/Lights.tsx` draws it.
 *
 * The rule. A building or a part is one albedo, `--tw-top`, and the lights make the three faces the home view shows
 * (top, south, east): each must land within 6 of 255 per channel of its token (`--tw-top`, `--tw-south`, `--tw-east`).
 * The same holds for the other neutral materials that are one albedo lit by these lights (steel, concrete, stale).
 * Hover and alarm are not held to it: their face tokens are `color-mix` of each face separately, so no single light
 * set can match them; the scene mixes into the top colour and lets the light shade it, and only their top is a contrast
 * pair (`scripts/contrast.ts`).
 *
 * The maths is in linear light. The canvas renders with colour management on (`flat`: no tone mapping): a token's hex is
 * decoded to linear, lit, and encoded back to sRGB. A face of albedo `c` gets, in the Lambert model,
 *
 *   encode(decode(c) × (BASE + KEY × max(0, L·n)))
 *
 * per channel, where `L` is the unit vector towards the light and `n` the face's normal. V2 fitted the intensities by
 * multiplying the sRGB bytes, and V3-02 then darkened `--tw-top` without moving `--tw-south` / `--tw-east`, so V2's
 * 0.60 / 0.53 missed the rule by up to 12.6 of 255 (steel's east face, computed); these are refitted (V3-12.3).
 *
 * The key light comes from the west, about 30° south of west and 49° above the ground. It cannot come from the
 * north-west as frame 00's prose says: seen from the south-east (the home view, V2-12.9) the south and east walls both
 * face away from such a light and would get the base alone, the same shade. The walls turned away from the camera are
 * lit from the side (west) or not at all (north). The lights stay neutral in hue (V3-12.1): the cool look is the
 * tokens', so what is drawn stays what the contrast check reads.
 */

/** The share of a material's colour every face gets, whatever it looks at (the hemisphere light, sky = ground). */
export const BASE_LIGHT = 0.44;
/** What a face looking straight at the key light gets on top of the base. */
export const KEY_LIGHT = 0.72;
/**
 * Towards the key light, in scene axes (`x` east, `y` up, `z` = −north): west, a little south, and above. Only the
 * direction matters: a directional light aims at the origin, and its intensity does not depend on how far away it is.
 */
export const TOWARDS_LIGHT: [x: number, y: number, z: number] = [-0.57, 0.75, 0.34];

export interface LightSet {
  base: number;
  key: number;
  towards: readonly [x: number, y: number, z: number];
}

/** The scene's lights. */
export const SCENE_LIGHTS: LightSet = { base: BASE_LIGHT, key: KEY_LIGHT, towards: TOWARDS_LIGHT };

export type Face = 'top' | 'south' | 'east' | 'west' | 'north';

/** Each face's outward normal in scene axes (south is +z, because `z` = −north). */
const NORMALS: Record<Face, readonly [number, number, number]> = {
  top: [0, 1, 0],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
  north: [0, 0, -1],
};

/** The share of its albedo each face gets, in linear light: the base, plus the key where the face looks towards it. */
export function faceShares({ base, key, towards }: LightSet): Record<Face, number> {
  const length = Math.hypot(...towards);
  const shares = {} as Record<Face, number>;
  for (const [face, [nx, ny, nz]] of Object.entries(NORMALS) as [
    Face,
    readonly [number, number, number],
  ][]) {
    const facing = (towards[0] * nx + towards[1] * ny + towards[2] * nz) / length;
    shares[face] = base + key * Math.max(0, facing);
  }
  return shares;
}

/** The sRGB transfer function's inverse, as three's `ColorManagement` applies it: an sRGB channel (0 – 1) to linear. */
export function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** The sRGB transfer function: a linear channel (0 – 1) to sRGB. */
export function linearToSrgb(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

const channelsOf = (hex: string): number[] =>
  [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);

const hexOf = (channels: readonly number[]): string =>
  `#${channels
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/** The colour a face of albedo `hex` (`#rrggbb`) is drawn with when it gets `share` of the light. */
export function litColour(hex: string, share: number): string {
  return hexOf(channelsOf(hex).map((c) => linearToSrgb(srgbToLinear(c) * share)));
}

/** The colours the top, south and east faces of one albedo (`#rrggbb`) are drawn with under `lights`. */
export function faceTones(
  topHex: string,
  lights: LightSet = SCENE_LIGHTS,
): { top: string; south: string; east: string } {
  const shares = faceShares(lights);
  return {
    top: litColour(topHex, shares.top),
    south: litColour(topHex, shares.south),
    east: litColour(topHex, shares.east),
  };
}
