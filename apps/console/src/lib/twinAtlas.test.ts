import { packCells } from './twinAtlas';
import type { AtlasCell, AtlasLayout, SpriteSize } from './twinMarkers';

const EMPTY: AtlasLayout = { width: 0, height: 0, cells: [] };
const size = (id: string, width: number, height: number): SpriteSize => ({ id, width, height });

/** Whether two cells share any pixel. */
const overlap = (a: AtlasCell, b: AtlasCell): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('packCells', () => {
  it('places the first cells in a row from the top-left corner, a pixel apart', () => {
    const { layout, added, skipped } = packCells(EMPTY, [size('a', 10, 20), size('b', 12, 8)], {
      maxWidth: 100,
    });

    expect(added).toEqual([
      { id: 'a', width: 10, height: 20, x: 0, y: 0 },
      { id: 'b', width: 12, height: 8, x: 11, y: 0 },
    ]);
    expect(layout).toEqual({ width: 23, height: 20, cells: added });
    expect(skipped).toEqual([]);
  });

  it('starts a new shelf under the tallest cell of the last one when a cell would pass the width', () => {
    const { added, layout } = packCells(
      EMPTY,
      [size('a', 40, 10), size('b', 40, 30), size('c', 40, 5)],
      { maxWidth: 90 },
    );

    expect(added.map(({ id, x, y }) => [id, x, y])).toEqual([
      ['a', 0, 0],
      ['b', 41, 0],
      // 82 (the first free column) + 40 = 122 > 90: the next shelf starts under the 30 px cell, with the padding.
      ['c', 0, 31],
    ]);
    expect(layout.width).toBe(81);
    expect(layout.height).toBe(36);
  });

  it('adds to a layout without moving the cells it already holds', () => {
    const first = packCells(EMPTY, [size('a', 40, 10), size('b', 40, 30)], { maxWidth: 90 });

    const second = packCells(first.layout, [size('c', 40, 5), size('d', 20, 5)], { maxWidth: 90 });

    expect(second.layout.cells.slice(0, 2)).toEqual(first.layout.cells);
    expect(second.added.map(({ id, x, y }) => [id, x, y])).toEqual([
      ['c', 0, 31],
      ['d', 41, 31],
    ]);
  });

  it('continues on the last shelf of a layout when the next cell fits there', () => {
    const first = packCells(EMPTY, [size('a', 30, 10)], { maxWidth: 100 });

    const second = packCells(first.layout, [size('b', 30, 40)], { maxWidth: 100 });

    expect(second.added).toEqual([{ id: 'b', width: 30, height: 40, x: 31, y: 0 }]);
    expect(second.layout.height).toBe(40);
  });

  it('grows the next shelf from the tallest cell of the last shelf, whichever call placed it', () => {
    const first = packCells(EMPTY, [size('a', 60, 10), size('b', 60, 25)], { maxWidth: 70 });
    // `a` is on the first shelf (height 10), `b` on the second (y 11).
    const second = packCells(first.layout, [size('c', 60, 5)], { maxWidth: 70 });

    expect(first.layout.cells.find((cell) => cell.id === 'b')).toMatchObject({ x: 0, y: 11 });
    expect(second.added[0]).toMatchObject({ id: 'c', x: 0, y: 37 });
  });

  it('honours the padding', () => {
    const { added } = packCells(EMPTY, [size('a', 10, 10), size('b', 10, 10)], {
      maxWidth: 100,
      padding: 4,
    });

    expect(added.map(({ x }) => x)).toEqual([0, 14]);
  });

  it('places an id once: one already in the layout, or given twice', () => {
    const first = packCells(EMPTY, [size('a', 10, 10)], { maxWidth: 100 });

    const second = packCells(first.layout, [size('a', 10, 10), size('b', 5, 5), size('b', 5, 5)], {
      maxWidth: 100,
    });

    expect(second.added.map(({ id }) => id)).toEqual(['b']);
    expect(second.layout.cells.map(({ id }) => id)).toEqual(['a', 'b']);
  });

  it('skips a cell wider than the atlas may be, and still packs the rest', () => {
    const wide = size('wide', 200, 10);

    const { added, skipped, layout } = packCells(
      EMPTY,
      [size('a', 10, 10), wide, size('b', 10, 10)],
      {
        maxWidth: 100,
      },
    );

    expect(skipped).toEqual([wide]);
    expect(added.map(({ id }) => id)).toEqual(['a', 'b']);
    expect(layout.cells.map(({ id }) => id)).toEqual(['a', 'b']);
  });

  it('puts a cell exactly as wide as the atlas alone on its shelf', () => {
    const { added } = packCells(EMPTY, [size('a', 10, 10), size('full', 100, 10)], {
      maxWidth: 100,
    });

    expect(added.map(({ id, x, y }) => [id, x, y])).toEqual([
      ['a', 0, 0],
      ['full', 0, 11],
    ]);
  });

  it('returns the very same layout when nothing is added', () => {
    const first = packCells(EMPTY, [size('a', 10, 10)], { maxWidth: 100 });

    expect(packCells(first.layout, [size('a', 10, 10)], { maxWidth: 100 }).layout).toBe(
      first.layout,
    );
    expect(packCells(first.layout, [], { maxWidth: 100 }).layout).toBe(first.layout);
    expect(packCells(EMPTY, [], { maxWidth: 100 }).layout).toBe(EMPTY);
  });

  it('never lets two cells share a pixel and keeps every cell inside the extent', () => {
    const sizes = Array.from({ length: 40 }, (_, i) =>
      size(`c${i}`, 8 + (i % 7) * 5, 10 + (i % 5) * 9),
    );

    const { layout } = packCells(EMPTY, sizes, { maxWidth: 120 });

    expect(layout.cells).toHaveLength(40);
    for (const cell of layout.cells) {
      expect(cell.x + cell.width).toBeLessThanOrEqual(layout.width);
      expect(cell.y + cell.height).toBeLessThanOrEqual(layout.height);
      expect(cell.x + cell.width).toBeLessThanOrEqual(120);
    }
    layout.cells.forEach((a, i) => {
      for (const b of layout.cells.slice(i + 1)) expect(overlap(a, b)).toBe(false);
    });
  });

  it('changes nothing in its arguments', () => {
    const first = packCells(EMPTY, [size('a', 10, 10)], { maxWidth: 100 });
    const before = structuredClone(first.layout);
    const sizes = [size('b', 10, 10)];
    const sizesBefore = structuredClone(sizes);

    packCells(first.layout, sizes, { maxWidth: 100 });

    expect(first.layout).toEqual(before);
    expect(sizes).toEqual(sizesBefore);
  });
});
