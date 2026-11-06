import { useThree } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import {
  ClampToEdgeWrapping,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
} from 'three';
import type { SliceFlags } from './sliceFlags';
import { GROUND_MATERIALS, type GroundMaterial } from './sliceQuarter';

/*
 * SPIKE (V3-11.5): the slice's placeholder textures (`scripts/slice-textures.ts`), served from `public/environment/`
 * and fetched only after the twin chunk has run, and only the files the switches need: the five ground textures
 * with `textures`, the facade atlas with `facades`. Nothing is fetched without a switch, so "none" is `main`.
 *
 * Every texture is disposed when the stage unmounts (or the switches change), so V3-11.1's S7 (Geometries and
 * Textures flat over 20 level trips) measures the slice, not a leak of the spike.
 *
 * Frame demand: one-shot. Each texture asks for one frame when it arrives, so a sleeping on-demand canvas draws it;
 *   nothing here keeps the canvas drawing.
 */

export type SliceTextureName = GroundMaterial | 'facades';

export type SliceTextures = Partial<Record<SliceTextureName, Texture>>;

const NONE: SliceTextures = {};

const urlOf = (name: SliceTextureName) => `/environment/${name}.webp`;

function prepare(texture: Texture, name: SliceTextureName): void {
  texture.colorSpace = SRGBColorSpace;
  // The ground repeats by itself; the atlas repeats inside a cell in the shader, so its edges must not wrap.
  const wrap = name === 'facades' ? ClampToEdgeWrapping : RepeatWrapping;
  texture.wrapS = wrap;
  texture.wrapT = wrap;
  texture.needsUpdate = true;
}

/** The textures the switches need, each present once it has arrived; a failed file stays absent and is logged. */
export function useSliceTextures({ textures, facades }: SliceFlags): SliceTextures {
  const invalidate = useThree((state) => state.invalidate);
  const [loaded, setLoaded] = useState<SliceTextures>(NONE);

  useEffect(() => {
    const names: SliceTextureName[] = [
      ...(textures ? GROUND_MATERIALS : []),
      ...(facades ? (['facades'] as const) : []),
    ];
    if (names.length === 0) return;
    const loader = new TextureLoader();
    const owned: Texture[] = [];
    let live = true;
    for (const name of names) {
      loader.load(
        urlOf(name),
        (texture) => {
          if (!live) {
            texture.dispose();
            return;
          }
          prepare(texture, name);
          owned.push(texture);
          setLoaded((current) => ({ ...current, [name]: texture }));
          invalidate();
        },
        undefined,
        () => console.warn(`[slice] ${urlOf(name)} did not load`),
      );
    }
    return () => {
      live = false;
      for (const texture of owned) texture.dispose();
      setLoaded(NONE);
    };
  }, [textures, facades, invalidate]);

  return loaded;
}
