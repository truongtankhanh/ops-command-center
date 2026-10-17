import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Vector2,
} from 'three';
import { GROUND_LAYERS } from '../lib/twinGround';
import { type MarkerPlacement, spriteInstances } from '../lib/twinMarkers';
import type { SpriteAtlas } from './useMarkerAtlas';

/** After the ground (0 – 8) and the buildings (9, 10). */
const MARKERS_ORDER = GROUND_LAYERS.length + 2;

/**
 * Each instance is a unit quad (`position.xy` in 0 … 1) standing on its anchor: the anchor is projected,
 * then the quad is pushed out by the sprite's size **in pixels**, turned into clip space with the viewport
 * and multiplied by `clip.w` so the perspective divide gives back exactly that many pixels. The quad's
 * bottom-centre is the anchor, so the stem's foot stands on the ground point. The `v` runs up the atlas,
 * `aRect = (u0, v0, u1, v1)` with `v0` the sprite's bottom.
 */
const VERTEX = /* glsl */ `
  attribute vec3 aAnchor;
  attribute vec4 aRect;
  attribute vec2 aSize;
  uniform vec2 uViewport;
  varying vec2 vUv;

  void main() {
    vec4 clip = projectionMatrix * viewMatrix * vec4(aAnchor, 1.0);
    vec2 pixels = vec2((position.x - 0.5) * aSize.x, position.y * aSize.y);
    clip.xy += pixels / uViewport * 2.0 * clip.w;
    gl_Position = clip;
    vUv = vec2(mix(aRect.x, aRect.z, position.x), mix(aRect.y, aRect.w, position.y));
  }
`;

/**
 * The bitmap is sRGB and `SRGBColorSpace` makes the sampler hand back linear light; three's
 * `colorspace_fragment` turns it back into the output colour space, so the marker shows the 2D map's colours.
 */
const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;

  void main() {
    vec4 texel = texture2D(uMap, vUv);
    if (texel.a < 0.01) discard;
    gl_FragColor = texel;
    #include <colorspace_fragment>
  }
`;

interface MarkersProps {
  sprites: readonly MarkerPlacement[];
  atlas: SpriteAtlas;
  /** Off hides every marker without rebuilding the atlas or the buffers. */
  visible: boolean;
}

/**
 * A layer of screen-sized sprites (V2-12.8): however many markers, **one draw call**, and each keeps its pixel
 * size at every zoom (frame 01: a camera is a 12 px box on an 8 px stem whether the campus fills the screen or
 * a corner of it). Reusable: a sprite is any bitmap in the atlas with an anchor, so the incident beacons of
 * V2-16.3 add bitmaps, not code.
 *
 * - Always drawn over the scene (`depthTest` off, after the opaque objects): an operator has to see every
 *   camera, including one behind a building.
 * - Nothing here is pickable; hover and click are V2-15.4's, which hit-tests in screen space from the same
 *   pixel rules (`lib/twinMarkers.ts`).
 * - `frustumCulled` is off: the base quad's bounds say nothing about where the instances are.
 */
export function Markers({ sprites, atlas, visible }: MarkersProps) {
  const { width, height } = useThree((state) => state.size);

  const geometry = useMemo(() => {
    const { count, anchors, rects, sizes } = spriteInstances(sprites, atlas.layout, atlas.ratio);
    if (count === 0) return null;
    const quad = new InstancedBufferGeometry();
    quad.setAttribute(
      'position',
      new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3),
    );
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    quad.setAttribute('aAnchor', new InstancedBufferAttribute(new Float32Array(anchors), 3));
    quad.setAttribute('aRect', new InstancedBufferAttribute(new Float32Array(rects), 4));
    quad.setAttribute('aSize', new InstancedBufferAttribute(new Float32Array(sizes), 2));
    quad.instanceCount = count;
    return quad;
  }, [sprites, atlas]);

  useEffect(() => () => geometry?.dispose(), [geometry]);

  // Rebuilt, not mutated, when the texture or the canvas size changes (a hook's value is not edited).
  const uniforms = useMemo(
    () => ({ uMap: { value: atlas.texture }, uViewport: { value: new Vector2(width, height) } }),
    [atlas, width, height],
  );

  if (geometry === null) return null;
  return (
    <mesh geometry={geometry} frustumCulled={false} renderOrder={MARKERS_ORDER} visible={visible}>
      {/*
        The `key` makes a new uniforms object a new material: three reads `material.uniforms` when it builds
        the program, so swapping the object on a live material would keep drawing with the old viewport.
      */}
      <shaderMaterial
        key={`${width}x${height}`}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        uniforms={uniforms}
        transparent
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}
