import type { Zone } from '@occ/contracts';
import type { ShellGeometry } from '../../lib/twin-core/twinBuildings';

/*
 * SPIKE (V3-11.5): the facades' texture coordinates for the merged shell geometry, as plain data (no `three`).
 *
 * One atlas of 2 × 2 cells (V3-14.1's default is one image with cells per use; the slice needs three families and a
 * blank). Each vertex gets two attributes:
 *
 * - `uv`, in **repeats**: metres along the wall and up it divided by the family's bay size, so the windows have the
 *   same size on every building (V3-14.1: "the wall's UV is in metres");
 * - `cell`, the atlas cell's lower-left corner in texture space.
 *
 * The shader (`facadeMaterial.ts`) samples `cell + fract(uv) * CELL_SIZE`, so the repeat happens inside one cell
 * and the whole campus stays one draw call. Roofs and every building outside the slice take the blank cell, which is
 * white: multiplied with the vertex colour, they look as they do on `main`.
 */

export type FacadeFamily = 'glass' | 'louvred' | 'brick';

/** The slice's three buildings by code (V3-11.1's facade substitution: the quarter's Lab, Data Center and Library). */
export const FACADE_BY_CODE: Readonly<Record<string, FacadeFamily>> = {
  'BLD-LAB': 'glass',
  'BLD-DC': 'louvred',
  'BLD-LIB': 'brick',
};

/** One cell's share of the atlas on each axis. */
export const CELL_SIZE = 0.5;

const CELLS: Record<FacadeFamily | 'blank', readonly [u: number, v: number]> = {
  glass: [0, CELL_SIZE],
  louvred: [CELL_SIZE, CELL_SIZE],
  brick: [0, 0],
  blank: [CELL_SIZE, 0],
};

/**
 * The bay one cell draws, in metres: width along the wall and height (one storey). Placeholders, chosen by eye
 * (`unverified`); V3-14.1 sets the real ones.
 */
const BAY_M: Record<FacadeFamily, readonly [width: number, height: number]> = {
  glass: [3.6, 3.6],
  louvred: [4, 4.5],
  brick: [3, 3.5],
};

export interface FacadeAttributes {
  /** Two numbers per vertex, in repeats. */
  uv: number[];
  /** Two numbers per vertex: the cell's corner in the atlas. */
  cell: number[];
}

/**
 * The attributes for every vertex of `geometry`. A building's range holds `n` wall quads (four vertices each: the
 * edge's start and end on the ground, then the end and the start at the top) followed by its `n` roof vertices
 * (`buildShellGeometry`), so `n` is a fifth of the range.
 */
export function facadeAttributes(
  geometry: ShellGeometry,
  zones: readonly Pick<Zone, 'id' | 'code'>[],
): FacadeAttributes {
  const vertices = geometry.positions.length / 3;
  // The middle of a cell for every vertex that is not a slice wall: `fract(0.5)` lands on the blank cell's centre, far
  // from the texels it shares with its neighbours (a `uv` of 0 would sit on the seam and blend brick in).
  const uv = new Array<number>(vertices * 2).fill(0.5);
  const cell: number[] = [];
  for (let v = 0; v < vertices; v += 1) cell.push(...CELLS.blank);

  const familyById = new Map<string, FacadeFamily>();
  for (const zone of zones) {
    const family = FACADE_BY_CODE[zone.code];
    if (family) familyById.set(zone.id, family);
  }

  const { positions } = geometry;
  for (const { zoneId, firstVertex, vertexCount } of geometry.ranges) {
    const family = familyById.get(zoneId);
    if (family === undefined) continue;
    const [bayW, bayH] = BAY_M[family];
    const walls = vertexCount / 5;
    for (let wall = 0; wall < walls; wall += 1) {
      const base = firstVertex + wall * 4;
      const ax = positions[base * 3]!;
      const az = positions[base * 3 + 2]!;
      const bx = positions[(base + 1) * 3]!;
      const bz = positions[(base + 1) * 3 + 2]!;
      const top = positions[(base + 2) * 3 + 1]!;
      const along = Math.hypot(bx - ax, bz - az) / bayW;
      const up = top / bayH;
      // Start bottom, end bottom, end top, start top.
      const corners: [number, number][] = [
        [0, 0],
        [along, 0],
        [along, up],
        [0, up],
      ];
      corners.forEach(([u, v], k) => {
        uv[(base + k) * 2] = u;
        uv[(base + k) * 2 + 1] = v;
        cell[(base + k) * 2] = CELLS[family][0];
        cell[(base + k) * 2 + 1] = CELLS[family][1];
      });
    }
  }
  return { uv, cell };
}
