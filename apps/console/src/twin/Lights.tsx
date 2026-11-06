import { useLayoutEffect, useMemo, useRef } from 'react';
import { type DirectionalLight, Object3D } from 'three';
import type { Bounds } from '../lib/twin-core/twinScene';

/*
 * The scene's lighting (ADR-0020, brief § Model contract): one hemisphere light and one directional
 * light. Outside the spike below, no shadow map (`castShadow` stays false and the Canvas has no
 * `shadows`): ADR-0020 as amended in V3-11.7 allows one directional shadow in the High tier only, which
 * V3-12.4 casts. Contact shadows are a baked decal under each asset, and ambient occlusion is baked into
 * textures.
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
 *
 * SPIKE (V3-11.5, branch only): with `shadow` the key light casts the realism slice's one shadow. That is the spike's,
 * not ADR-0020's: on `main` there is still no shadow map.
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

/** SPIKE (V3-11.5): the shadow's map size (V3-12.1's placeholder) and its margin round the campus, in metres. */
const SHADOW_MAP_SIZE = 2048;
const SHADOW_MARGIN_M = 40;

/**
 * SPIKE (V3-11.5): where the shadow-casting key light stands and what its shadow camera covers, fitted to the campus
 * once per stage (V3-12.1: not per frame). The light moves out along the same direction, so the faces are lit exactly
 * as without the shadow; its orthographic camera is a square round the campus's circle, deep enough for the tallest
 * building on either side.
 */
function shadowFit({ minX, maxX, minZ, maxZ }: Bounds) {
  const centre: [number, number, number] = [(minX + maxX) / 2, 0, (minZ + maxZ) / 2];
  const radius = Math.hypot(maxX - minX, maxZ - minZ) / 2 + SHADOW_MARGIN_M;
  const length = Math.hypot(...TOWARDS_LIGHT);
  const distance = radius * 2;
  const position: [number, number, number] = [
    centre[0] + (TOWARDS_LIGHT[0] / length) * distance,
    centre[1] + (TOWARDS_LIGHT[1] / length) * distance,
    centre[2] + (TOWARDS_LIGHT[2] / length) * distance,
  ];
  return { centre, position, radius, near: distance - radius, far: distance + radius };
}

interface LightsProps {
  /** SPIKE (V3-11.5): the campus bounds when the slice's shadow is on; without it, the lights of `main`. */
  shadow?: Bounds;
}

export function Lights({ shadow }: LightsProps) {
  return (
    <>
      {/* Sky and ground the same, so the base is the same on every face. */}
      <hemisphereLight color="#ffffff" groundColor="#ffffff" intensity={BASE_LIGHT * Math.PI} />
      {shadow ? (
        <ShadowKey bounds={shadow} />
      ) : (
        <directionalLight
          color="#ffffff"
          position={TOWARDS_LIGHT}
          intensity={KEY_LIGHT * Math.PI}
        />
      )}
    </>
  );
}

/** SPIKE (V3-11.5): the key light with the slice's shadow. Bias values are placeholders, tuned by eye (`unverified`). */
function ShadowKey({ bounds }: { bounds: Bounds }) {
  const light = useRef<DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);
  const fit = useMemo(() => shadowFit(bounds), [bounds]);
  // R3F sets the shadow camera's planes but three does not recompute its projection by itself.
  useLayoutEffect(() => {
    light.current?.shadow.camera.updateProjectionMatrix();
  }, [fit]);
  return (
    <>
      <primitive object={target} position={fit.centre} />
      <directionalLight
        ref={light}
        color="#ffffff"
        position={fit.position}
        target={target}
        intensity={KEY_LIGHT * Math.PI}
        castShadow
        shadow-mapSize={[SHADOW_MAP_SIZE, SHADOW_MAP_SIZE]}
        shadow-bias={-0.0005}
        shadow-normalBias={0.4}
        shadow-camera-left={-fit.radius}
        shadow-camera-right={fit.radius}
        shadow-camera-top={fit.radius}
        shadow-camera-bottom={-fit.radius}
        shadow-camera-near={fit.near}
        shadow-camera-far={fit.far}
      />
    </>
  );
}
