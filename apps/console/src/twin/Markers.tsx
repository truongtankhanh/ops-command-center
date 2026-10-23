import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Vector2,
} from 'three';
import { PULSE_OPACITY_FROM, PULSE_SCALE_FROM, PULSE_SCALE_TO } from '../lib/map/mapPulse';
import { GROUND_LAYERS } from '../lib/twin-core/twinGround';
import { type MarkerPlacement, spriteInstances } from '../lib/twin-core/twinMarkers';
import { mapMotion } from '../styles/tokens';
import { useMarkerScale } from './markerScale';
import type { SpriteAtlas } from './useMarkerAtlas';

/** After the ground (0 – 8) and the buildings (9, 10). */
const MARKERS_ORDER = GROUND_LAYERS.length + 2;

/** A number as a GLSL float literal: it needs its decimal point (`1` would be an `int` and fail to compile). */
const glsl = (value: number): string => value.toFixed(4);

/** The clock of a layer with nothing that pulses (the cameras): nothing reads it. */
const NO_CLOCK = { value: 0 };

/**
 * Each instance is a unit quad (`position.xy` in 0 … 1) standing on its anchor: the anchor is projected,
 * then the quad is pushed out by the sprite's size **in pixels**, turned into clip space with the viewport
 * and multiplied by `clip.w` so the perspective divide gives back exactly that many pixels. The quad's
 * bottom-centre is the anchor, so the stem's foot stands on the ground point. The `v` runs up the atlas,
 * `aRect = (u0, v0, u1, v1)` with `v0` the sprite's bottom.
 *
 * Two optional per-sprite attributes serve the incident beacons (V2-16.3), and a camera's are zero and `-1`, which
 * change nothing: `aOffset` moves the sprite's anchor by that many pixels (a ring round a disc, a tag beside it), and
 * `aPhase` makes it a repeating pulse (`-1` is a still sprite). A pulse is the map's wave (`lib/map/mapPulse.ts`): about
 * its **centre** it grows from 0.7× to 1.8× of its size while it fades from 0.9 to 0, with a quadratic ease-out,
 * once every `uPeriodMs` of the shared clock `uTime`.
 */
const VERTEX = /* glsl */ `
  attribute vec3 aAnchor;
  attribute vec4 aRect;
  attribute vec2 aSize;
  attribute vec2 aOffset;
  attribute float aPhase;
  uniform vec2 uViewport;
  uniform float uScale;
  uniform float uTime;
  uniform float uPeriodMs;
  varying vec2 vUv;
  varying float vFade;

  void main() {
    vec4 clip = projectionMatrix * viewMatrix * vec4(aAnchor, 1.0);
    vec2 size = aSize * uScale;
    vec2 pixels = vec2((position.x - 0.5) * size.x, position.y * size.y);
    float fade = 1.0;
    if (aPhase >= 0.0) {
      float t = fract(uTime / uPeriodMs + aPhase);
      float eased = 1.0 - (1.0 - t) * (1.0 - t);
      float scale = ${glsl(PULSE_SCALE_FROM)} + (${glsl(PULSE_SCALE_TO)} - ${glsl(PULSE_SCALE_FROM)}) * eased;
      vec2 centre = vec2(0.0, size.y * 0.5);
      pixels = (pixels - centre) * scale + centre;
      fade = ${glsl(PULSE_OPACITY_FROM)} * (1.0 - eased);
    }
    pixels += aOffset * uScale;
    clip.xy += pixels / uViewport * 2.0 * clip.w;
    gl_Position = clip;
    vUv = vec2(mix(aRect.x, aRect.z, position.x), mix(aRect.y, aRect.w, position.y));
    vFade = fade;
  }
`;

/**
 * The bitmap is sRGB and `SRGBColorSpace` makes the sampler hand back linear light; three's
 * `colorspace_fragment` turns it back into the output colour space, so the marker shows the 2D map's colours.
 */
const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vFade;

  void main() {
    vec4 texel = texture2D(uMap, vUv);
    if (texel.a < 0.01) discard;
    gl_FragColor = vec4(texel.rgb, texel.a * uOpacity * vFade);
    #include <colorspace_fragment>
  }
`;

interface MarkersProps {
  sprites: readonly MarkerPlacement[];
  atlas: SpriteAtlas;
  /** Off hides every marker without rebuilding the atlas or the buffers. */
  visible: boolean;
  /**
   * How opaque every marker is, 0 – 1 (V2-15.7: `--tw-ghost-opacity` while an asset is isolated). Part of the
   * material's uniforms, so a change builds the material again; it changes with the level, not per frame.
   */
  opacity?: number;
  /**
   * The shared clock of the pulsing sprites (V2-16.3), in ms: an object the **caller owns and advances** from its
   * frame loop, so a running clock renders nothing in React. Without one nothing pulses, and a sprite with a phase
   * would stand at the start of its cycle.
   */
  clock?: { value: number };
  /** The length of a pulse cycle in ms; the map's (`mapMotion.pulseMs`) unless a layer says otherwise. */
  periodMs?: number;
  /** Where the layer is painted among the transparent objects; the cameras' unless a layer is to go over them. */
  renderOrder?: number;
}

/**
 * A layer of screen-sized sprites (V2-12.8): however many markers, **one draw call**, and each keeps its pixel
 * size at every zoom (frame 01: a camera is a 12 px box on an 8 px stem whether the campus fills the screen or
 * a corner of it). Reusable: a sprite is any bitmap in the atlas with an anchor. The incident beacons of V2-16.3 add
 * bitmaps, and for their rings and tags a pixel offset and, for the pulse, a phase and a clock (see `VERTEX`): the
 * camera markers use none of these and render as before.
 *
 * - Always drawn over the scene (`depthTest` off, after the opaque objects): an operator has to see every
 *   camera, including one behind a building.
 * - **Bigger on the video wall** (V2-21.6): every size and offset is multiplied by the marker scale the canvas provides
 *   (`markerScale.ts`), `1` outside a wall. It is a uniform, so the bitmaps and the buffers are the same at any scale.
 * - Nothing here is pickable; hover and click are V2-15.4's, which hit-tests in screen space from the same
 *   pixel rules (`lib/twin-core/twinMarkers.ts`).
 * - `frustumCulled` is off: the base quad's bounds say nothing about where the instances are.
 */
export function Markers({
  sprites,
  atlas,
  visible,
  opacity = 1,
  clock = NO_CLOCK,
  periodMs = mapMotion.pulseMs,
  renderOrder = MARKERS_ORDER,
}: MarkersProps) {
  const { width, height } = useThree((state) => state.size);
  const scale = useMarkerScale();

  const geometry = useMemo(() => {
    const { count, anchors, rects, sizes, offsets, phases } = spriteInstances(
      sprites,
      atlas.layout,
      atlas.ratio,
    );
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
    quad.setAttribute('aOffset', new InstancedBufferAttribute(new Float32Array(offsets), 2));
    quad.setAttribute('aPhase', new InstancedBufferAttribute(new Float32Array(phases), 1));
    quad.instanceCount = count;
    return quad;
  }, [sprites, atlas]);

  useEffect(() => () => geometry?.dispose(), [geometry]);

  // Rebuilt, not mutated, when the texture or the canvas size changes (a hook's value is not edited).
  const uniforms = useMemo(
    () => ({
      uMap: { value: atlas.texture },
      uViewport: { value: new Vector2(width, height) },
      uScale: { value: scale },
      uOpacity: { value: opacity },
      uTime: clock,
      uPeriodMs: { value: periodMs },
    }),
    [atlas, width, height, scale, opacity, clock, periodMs],
  );

  if (geometry === null) return null;
  return (
    <mesh geometry={geometry} frustumCulled={false} renderOrder={renderOrder} visible={visible}>
      {/*
        The `key` makes a new uniforms object a new material: three reads `material.uniforms` when it builds
        the program, so swapping the object on a live material would keep drawing with the old viewport.
      */}
      <shaderMaterial
        key={`${width}x${height}x${opacity}x${scale}`}
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
