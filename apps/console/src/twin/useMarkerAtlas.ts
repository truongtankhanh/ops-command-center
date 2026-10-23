import { useEffect, useState } from 'react';
import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';
import { type MarkerForm, renderMarkerImages } from '../lib/map/mapImages';
import {
  type AtlasLayout,
  atlasLayout,
  MARKER_MARGIN_PX,
  type SpriteSize,
  STEM_PX,
} from '../lib/twin-core/twinMarkers';
import { mapColors } from '../styles/tokens';

/** The marker bitmaps of the stage in one texture, and where each one is in it. */
export interface SpriteAtlas {
  texture: CanvasTexture;
  layout: AtlasLayout;
  /** Device pixels per CSS pixel of the bitmaps, as `renderMarkerImages` drew them. */
  ratio: number;
}

/**
 * Draws each bitmap with its stem under it into one canvas. A cell is the bitmap plus the stem, which
 * runs `STEM_PX` from the marker's drawn edge to the cell's bottom, the sprite's anchor: the bitmap leaves
 * `MARKER_MARGIN_PX` around its box, so the stem starts inside that margin and touches the box. The stem
 * is 1 CSS px wide, in the camera marker's own edge colour.
 */
function drawAtlas(
  images: readonly (readonly [id: string, image: HTMLImageElement])[],
  ratio: number,
): SpriteAtlas | null {
  const sizes = images.map(([id, image]): SpriteSize => ({
    id,
    width: image.naturalWidth,
    height: image.naturalHeight + (STEM_PX - MARKER_MARGIN_PX) * ratio,
  }));
  // A device pixel between cells, so linear filtering never blends one cell's edge with the next.
  const layout = atlasLayout(sizes, 1);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext('2d');
  if (context === null) return null;

  context.fillStyle = mapColors.textTertiary;
  images.forEach(([, image], index) => {
    const cell = layout.cells[index]!;
    context.drawImage(image, cell.x, cell.y);
    const top = cell.y + image.naturalHeight - MARKER_MARGIN_PX * ratio;
    const left = cell.x + Math.floor((cell.width - ratio) / 2);
    context.fillRect(left, top, ratio, cell.y + cell.height - top);
  });

  const texture = new CanvasTexture(canvas);
  // The bitmaps are sRGB. Sampled at 1 – 1.5× their size, so a mip chain would only blur them.
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  return { texture, layout, ratio };
}

/**
 * The atlas of `forms`' bitmaps, or `null` until they have decoded (and for good if the browser cannot
 * draw them: the markers are a convenience, the 2D map and the camera strip still show every camera).
 * `forms` must be a stable list. The texture is disposed when the forms change or the stage goes away,
 * and nothing is set for a stage that has already gone.
 */
export function useMarkerAtlas(forms: readonly MarkerForm[]): SpriteAtlas | null {
  const [atlas, setAtlas] = useState<SpriteAtlas | null>(null);

  useEffect(() => {
    let current = true;
    let built: SpriteAtlas | null = null;
    renderMarkerImages(forms)
      .then(({ ratio, images }) => {
        if (!current) return;
        built = drawAtlas(images, ratio);
        setAtlas(built);
      })
      .catch(() => {
        // A bitmap that does not decode leaves the stage without markers, not without a scene.
      });
    return () => {
      current = false;
      built?.texture.dispose();
    };
  }, [forms]);

  return atlas;
}
