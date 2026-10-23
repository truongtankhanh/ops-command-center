import type { AtlasCell, AtlasLayout, SpriteSize } from './twinMarkers';

/*
 * A texture atlas that grows (V2-16.3): the incident beacons' bitmaps are not a fixed list, a form (severity, status
 * and type) is drawn the first time an incident needs it. So the layout has to take new cells **without moving the
 * ones already placed** (the instance buffers hold their rectangles) and without a fixed size. Pure: no canvas, no
 * `three`, so what the texture cannot be checked for here (a cell on top of another, one past the edge) is tested
 * without WebGL. `atlasLayout` (one row, `lib/twin-core/twinMarkers.ts`) stays for the cameras, whose list is fixed.
 */

export interface PackOptions {
  /** The widest the atlas may grow, in device pixels. A cell wider than this cannot be placed. */
  maxWidth: number;
  /** Device pixels between neighbouring cells (and between shelves): linear filtering blends an edge with the next cell. */
  padding?: number;
}

export interface PackResult {
  /** The layout with the new cells; the very same object when nothing was added. */
  layout: AtlasLayout;
  /** The cells placed by this call, in the order they were given. */
  added: AtlasCell[];
  /** The sizes that could not be placed (wider than `maxWidth`). A caller skips them; nothing is thrown. */
  skipped: SpriteSize[];
}

/**
 * Appends the cells of `sizes` that `layout` does not have yet, in shelf rows: left to right until the next cell
 * would pass `maxWidth`, then a new row under the tallest cell of the last one. The rows of `layout` are read back
 * from its cells (the last shelf is the one with the greatest `y`), so a layout built by an earlier call continues
 * where it stopped. An id already in the layout, or given twice, is placed once. The result's width and height are
 * the extent the cells use, which is the canvas the caller draws them on.
 */
export function packCells(
  layout: AtlasLayout,
  sizes: readonly SpriteSize[],
  { maxWidth, padding = 1 }: PackOptions,
): PackResult {
  const known = new Set(layout.cells.map((cell) => cell.id));
  const added: AtlasCell[] = [];
  const skipped: SpriteSize[] = [];

  // Where the last shelf stands: its top, its height so far and the first free column.
  let shelfY = layout.cells.reduce((top, cell) => Math.max(top, cell.y), 0);
  let shelfHeight = 0;
  let cursor = 0;
  for (const cell of layout.cells) {
    if (cell.y !== shelfY) continue;
    shelfHeight = Math.max(shelfHeight, cell.height);
    cursor = Math.max(cursor, cell.x + cell.width + padding);
  }

  for (const size of sizes) {
    if (known.has(size.id)) continue;
    known.add(size.id);
    if (size.width > maxWidth) {
      skipped.push(size);
      continue;
    }
    if (cursor > 0 && cursor + size.width > maxWidth) {
      shelfY += shelfHeight + padding;
      shelfHeight = 0;
      cursor = 0;
    }
    added.push({ ...size, x: cursor, y: shelfY });
    cursor += size.width + padding;
    shelfHeight = Math.max(shelfHeight, size.height);
  }

  if (added.length === 0) return { layout, added, skipped };
  const cells = [...layout.cells, ...added];
  return {
    layout: {
      width: Math.max(...cells.map((cell) => cell.x + cell.width)),
      height: Math.max(...cells.map((cell) => cell.y + cell.height)),
      cells,
    },
    added,
    skipped,
  };
}
