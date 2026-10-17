import type { Camera } from '@occ/contracts';
import { imageIdOf } from './mapImages';
import type { Frame } from './twinScene';

/*
 * The 3D stage's screen-sized markers as plain data (V2-12.8): where each one stands in the scene, how
 * their bitmaps are laid out in one atlas texture, and the per-instance numbers the shader reads. No
 * `three`, no WebGL and no DOM, so what the shader and the canvas cannot be checked for here (a flipped
 * `y`, a wrong cell, a skipped marker) is tested without them (ADR-0020).
 *
 * A **sprite** is a marker's bitmap with a stem under it, one cell of the atlas. Its **anchor** is the cell's
 * bottom-centre: the stem's foot is the ground point the marker stands on. The shader keeps the cell's
 * size in CSS pixels at every distance, which is what "screen-sized" means. Incident beacons (V2-16.3)
 * add cells with their own bitmaps; V2-15.4 hit-tests a camera in screen space from the same numbers.
 */

/** From the marker's drawn edge down to the ground point: frame 01's stem (TwinScene `8 · ui`). */
export const STEM_PX = 8;

/**
 * The transparent margin a camera bitmap leaves around its 12 px box (`mapImages.ts` draws it in 14),
 * which the stem starts inside of so it touches the box instead of leaving a gap.
 */
export const MARKER_MARGIN_PX = 1;

/** A marker to draw: where it stands (metres, `y` up) and which bitmap it uses. */
export interface MarkerPlacement {
  id: string;
  position: [x: number, y: number, z: number];
  /** The id of a bitmap in the atlas (`imageIdOf`). */
  image: string;
}

/** A marker for each camera, at the camera's ground point, online or offline as the 2D map draws it. */
export function cameraMarkers(cameras: readonly Camera[], frame: Frame): MarkerPlacement[] {
  return cameras.map(({ id, position, online }) => {
    const [x, z] = frame.toLocal(position);
    return { id, position: [x, 0, z], image: imageIdOf({ kind: 'camera', online }) };
  });
}

/** What the atlas needs of a bitmap: its id and its size in device pixels. */
export interface SpriteSize {
  id: string;
  width: number;
  height: number;
}

/** A cell of the atlas, in device pixels from the atlas's top-left corner. */
export interface AtlasCell extends SpriteSize {
  x: number;
  y: number;
}

export interface AtlasLayout {
  width: number;
  height: number;
  cells: AtlasCell[];
}

/**
 * One row of cells, left to right, `padding` device pixels between them (and none around): a texture
 * sampled with linear filtering blends a cell's edge with its neighbour's, and the padding keeps the two apart.
 */
export function atlasLayout(sizes: readonly SpriteSize[], padding: number = 1): AtlasLayout {
  let x = 0;
  const cells = sizes.map((size): AtlasCell => {
    const cell = { ...size, x, y: 0 };
    x += size.width + padding;
    return cell;
  });
  return {
    width: cells.length === 0 ? 0 : x - padding,
    height: Math.max(0, ...sizes.map(({ height }) => height)),
    cells,
  };
}

/** The per-instance numbers of the markers, as flat arrays for the shader's instance attributes. */
export interface SpriteInstances {
  count: number;
  /** `x, y, z` of each anchor, in metres. */
  anchors: number[];
  /** `u0, v0, u1, v1` of each cell: `v0` is the cell's bottom and `v1` its top, with `v` measured up from the atlas's bottom edge. */
  rects: number[];
  /** `width, height` of each sprite in CSS pixels: its cell divided by the bitmap ratio. */
  sizes: number[];
}

/**
 * The instance data of `placements`, in order. The atlas is drawn top-down and uploaded as a texture whose
 * `v` runs up, so a cell's `v` is flipped. A placement whose image is not in the atlas is skipped, never
 * thrown: an image a build does not know is not a reason to lose every other marker.
 */
export function spriteInstances(
  placements: readonly MarkerPlacement[],
  atlas: AtlasLayout,
  ratio: number,
): SpriteInstances {
  const cells = new Map(atlas.cells.map((cell) => [cell.id, cell]));
  const instances: SpriteInstances = { count: 0, anchors: [], rects: [], sizes: [] };
  for (const { position, image } of placements) {
    const cell = cells.get(image);
    if (cell === undefined) continue;
    instances.count += 1;
    instances.anchors.push(...position);
    instances.rects.push(
      cell.x / atlas.width,
      1 - (cell.y + cell.height) / atlas.height,
      (cell.x + cell.width) / atlas.width,
      1 - cell.y / atlas.height,
    );
    instances.sizes.push(cell.width / ratio, cell.height / ratio);
  }
  return instances;
}
