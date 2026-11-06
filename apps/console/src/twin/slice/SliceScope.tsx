import { createContext, type ReactNode, useContext } from 'react';
import { SliceContext, type SliceFlags } from './sliceFlags';
import { type SliceTextures, useSliceTextures } from './useSliceTextures';

/*
 * SPIKE (V3-11.5): hands the slice's switches and its textures to everything under the canvas. Inside `<Canvas>`,
 * because the texture hook asks R3F for frames. The textures are loaded here once, so the ground and the shells share
 * one copy of each (the GPU memory V3-11.6 reads is the slice's, not a double load).
 */

const SliceTexturesContext = createContext<SliceTextures>({});

export const useSliceTextureSet = (): SliceTextures => useContext(SliceTexturesContext);

interface SliceScopeProps {
  flags: SliceFlags;
  children: ReactNode;
}

export function SliceScope({ flags, children }: SliceScopeProps) {
  const textures = useSliceTextures(flags);
  return (
    <SliceContext.Provider value={flags}>
      <SliceTexturesContext.Provider value={textures}>{children}</SliceTexturesContext.Provider>
    </SliceContext.Provider>
  );
}
