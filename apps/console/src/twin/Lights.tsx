/*
 * The scene's lighting (ADR-0020, brief § Model contract): one hemisphere light and one directional
 * light, no shadow maps (`castShadow` stays false and the Canvas has no `shadows`). Contact shadows are
 * a baked decal under each asset, and ambient occlusion is baked into textures.
 *
 * A part is one material, `--tw-top`, and the lights make its three visible faces. The tokens give the
 * targets as shares of the top face (per channel, `--tw-south` over `--tw-top` is 0.74 – 0.82, mean 0.78,
 * and `--tw-east` over it 0.55 – 0.66, mean 0.60), and a face of unit albedo gets, in the Lambert model,
 *
 *   top = BASE + KEY·Ly,   south (normal +z) = BASE + KEY·Lz,   east (normal +x) = BASE + KEY·Lx
 *
 * where `L` is the unit vector towards the light and a face turned away from it gets the base only.
 * BASE = 0.60 and KEY = 0.53 with L = (−0.57, 0.75, 0.34) give 1.00, 0.78 and 0.60: every face within
 * 6 of 255 per channel of its token.
 *
 * The key light therefore comes from the west, 30° south of west, 49° above the ground. It cannot come
 * from the north-west as frame 00's prose says: seen from the south-east (the home view, V2-12.9) the
 * south and east walls both face away from such a light and would get the base alone, the same shade.
 * The walls turned away from the camera are lit from the side (west 0.90) or not at all (north 0.60).
 *
 * In three.js (r155 and later) a punctual light of intensity π gives a Lambert surface its full colour,
 * so both intensities carry a factor of π. The face colours are calculated, not yet read from a render
 * (`unverified`): the developer reads one building's top, south and east face in the browser and the
 * constants are adjusted from that.
 */

/** The share of a material's colour every face gets, whatever it looks at. */
const BASE_LIGHT = 0.6;
/** What a face looking straight at the light gets on top of the base. */
const KEY_LIGHT = 0.53;
/**
 * Towards the light, in scene axes (`x` east, `y` up, `z` = −north): west, a little south, and above.
 * Only the direction matters: a directional light aims at the origin, and its intensity does not
 * depend on how far away it is placed.
 */
const TOWARDS_LIGHT: [x: number, y: number, z: number] = [-0.57, 0.75, 0.34];

export function Lights() {
  return (
    <>
      {/* Sky and ground the same, so the base is the same on every face. */}
      <hemisphereLight color="#ffffff" groundColor="#ffffff" intensity={BASE_LIGHT * Math.PI} />
      <directionalLight color="#ffffff" position={TOWARDS_LIGHT} intensity={KEY_LIGHT * Math.PI} />
    </>
  );
}
