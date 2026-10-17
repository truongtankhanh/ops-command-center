/*
 * The scene's lighting (ADR-0020, brief § Model contract): one hemisphere light and one directional
 * light, no shadow maps (`castShadow` stays false and the Canvas has no `shadows`). Contact shadows are
 * a baked decal under each asset, and ambient occlusion is baked into textures.
 *
 * The starting values are the prototype's shading, `TwinScene.dc.html` `shade()`: a base of 0.55 of the
 * material everywhere, plus 0.45 on a face that looks straight at the light, which is the top. In
 * three.js (r155 and later) a punctual light of intensity π gives a Lambert surface its full colour, so
 * both intensities carry a factor of π (`unverified` until read from a lit mesh in the browser;
 * V2-12.7 has the first one, and the final tuning is there).
 *
 * Known limit: with a single light from the north-west the south and east faces both receive only the
 * hemisphere, so they come out equal (about 0.55 of the top), while the tokens' south tone is lighter
 * (0.74 – 0.82 of the top) than the east (0.55 – 0.66). The prototype's shading has a small extra
 * south-west term that one directional light cannot express.
 */

/** The share of a material's colour every face gets, whatever it looks at. */
const BASE_LIGHT = 0.55;
/** What a face looking straight at the light gets on top of the base (`shade()`: 0.45). */
const KEY_LIGHT = 0.45;
/**
 * Towards the light, in scene axes (`x` east, `y` up, `z` = −north): the prototype's vector
 * `(−0.45, −0.55, 0.7)` with its `y` pointing south and `z` up, so the light is to the north-west
 * and above the campus.
 */
const TOWARDS_LIGHT: [x: number, y: number, z: number] = [-0.45, 0.7, -0.55];
/** The cosine between the top face's normal and the light: the share of the key light the top gets. */
const TOP_COSINE = 0.7 / Math.hypot(...TOWARDS_LIGHT);

export function Lights() {
  return (
    <>
      {/* Sky and ground the same, so the base is the same on every face. */}
      <hemisphereLight color="#ffffff" groundColor="#ffffff" intensity={BASE_LIGHT * Math.PI} />
      {/* The target is the origin: only the direction of the position matters. */}
      <directionalLight
        color="#ffffff"
        position={TOWARDS_LIGHT}
        intensity={(KEY_LIGHT / TOP_COSINE) * Math.PI}
      />
    </>
  );
}
