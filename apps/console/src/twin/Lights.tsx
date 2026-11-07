import { useLayoutEffect, useMemo, useRef } from 'react';
import { type DirectionalLight, Object3D } from 'three';
import { BASE_LIGHT, KEY_LIGHT, TOWARDS_LIGHT } from '../lib/twin-core/twinLighting';
import type { Bounds } from '../lib/twin-core/twinScene';

/*
 * The scene's lighting (ADR-0020, brief § Model contract): one hemisphere light and one directional
 * light. Outside the spike below, no shadow map (`castShadow` stays false and the Canvas has no
 * `shadows`): ADR-0020 as amended in V3-11.7 allows one directional shadow in the High tier only, which
 * V3-12.4 casts. Contact shadows are a baked decal under each asset, and ambient occlusion is baked into
 * textures.
 *
 * A part or a building is one albedo, `--tw-top`, and the two lights make the three faces the home view shows read as
 * `--tw-top`, `--tw-south` and `--tw-east`. The light set, the maths (in linear light, per channel) and the test that
 * holds every face within 6 of 255 of its token are in `lib/twin-core/twinLighting.ts`, with why the key light comes
 * from the west-south-west. The lights stay white (ADR-0020 "Settled in V3-12.1"): the cool look is the tokens'.
 *
 * In three.js (r155 and later) a punctual light of intensity π gives a Lambert surface its full colour, and so does a
 * hemisphere light, so both intensities carry a factor of π. The face colours are calculated, not yet read from a render
 * (`unverified`): the developer reads one building's top, south and east face in the browser.
 *
 * SPIKE (V3-11.5, merged to `main` in #246): with `?slice=shadow` the key light casts the realism slice's one shadow.
 * That is the spike's, not the product's: without the switch there is no shadow map. V3-12.4 replaces it by the rules
 * of ADR-0020 "Settled in V3-12.1" (the key's direction is unchanged there; the intensities are V3-12.3's).
 */

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
