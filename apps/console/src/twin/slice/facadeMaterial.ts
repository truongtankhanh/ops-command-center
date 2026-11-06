import type { WebGLProgramParametersWithUniforms } from 'three';
import { CELL_SIZE } from './sliceFacades';

/*
 * SPIKE (V3-11.5, decision D3 (a)): the shells' material 0 samples one facade atlas and repeats a cell across a wall,
 * so the whole campus stays one draw call, as V3-14.1's "one image, cells per use" will need.
 *
 * three's stock `map` samples `vMapUv` directly; the patch samples `vCell + fract(vMapUv) * cell` instead. `fract`
 * jumps at every repeat, which would pick the smallest mip there (a seam), so the sample uses `textureGrad` with the
 * derivatives of the unwrapped coordinate (WebGL 2). The cell is inset by two texels so linear filtering never reads
 * a neighbouring cell. The vertex colour still multiplies the result (`color_fragment` is untouched), so the hover
 * and heat tints keep working over the facade.
 *
 * Material 1 (faded) and 2 (see-through) are not patched: V3-14.1's default keeps them flat.
 */

/** Two texels of the 1024² atlas, in texture space. */
const INSET = 2 / 1024;

const VERTEX_HEAD = 'attribute vec2 cell;\nvarying vec2 vCell;\n';
const FRAGMENT_HEAD = 'varying vec2 vCell;\n';

/**
 * three's `map_fragment` (0.186) with its one sample replaced; the chunk's video-texture branch is left out (no video
 * here).
 */
const MAP_FRAGMENT = `#ifdef USE_MAP
	vec2 facadeSpan = vec2( ${(CELL_SIZE - 2 * INSET).toFixed(6)} );
	vec2 facadeUv = vCell + vec2( ${INSET.toFixed(6)} ) + fract( vMapUv ) * facadeSpan;
	vec4 sampledDiffuseColor = textureGrad( map, facadeUv, dFdx( vMapUv ) * facadeSpan, dFdy( vMapUv ) * facadeSpan );
	diffuseColor *= sampledDiffuseColor;
#endif`;

/** For `onBeforeCompile` on a `MeshLambertMaterial` that has the atlas as its `map` and a geometry with `cell`. */
export function patchFacadeShader(shader: WebGLProgramParametersWithUniforms): void {
  shader.vertexShader =
    VERTEX_HEAD +
    shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvCell = cell;');
  shader.fragmentShader =
    FRAGMENT_HEAD + shader.fragmentShader.replace('#include <map_fragment>', MAP_FRAGMENT);
}

/** Keeps the patched program apart from the stock Lambert program in three's cache. */
export const FACADE_PROGRAM_KEY = 'slice-facade';
