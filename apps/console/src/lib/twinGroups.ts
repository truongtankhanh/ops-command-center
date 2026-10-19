/*
 * Which part of a merged mesh is drawn as it is and which is faded (V2-15.7), as plain data: no `three`, no
 * buffers, so it tests without them. A merged mesh (the shells, the boxes) draws one material over all its
 * triangles; to fade all but one thing in it, `twin/applyGroups.ts` hands three's `geometry.groups` the spans this
 * returns, with two materials on the mesh: index `0` as drawn, index `1` faded. Nothing is rebuilt; only the list of
 * groups changes, and the picking table of the mesh (triangle -> thing) stays as it was.
 */

/** A run of a buffer, in the unit the buffer is drawn in (indices for a faces mesh, vertices for a plain line). */
export interface Span {
  start: number;
  count: number;
}

/** A group of three's geometry: a run drawn with the material at `materialIndex`. */
export interface DrawGroup extends Span {
  /** `0` as drawn, `1` faded. */
  materialIndex: 0 | 1;
}

/** Which span is drawn as it is: one by its index, `'none'` when everything is faded, `null` when nothing is. */
export type Keep = number | 'none' | null;

/**
 * The groups that draw the span at index `keep` as it is and every other span faded. `spans` are the runs of the
 * things in the mesh, in buffer order, and are expected to tile the buffer; neighbours of one material merge, so the
 * thing kept costs at most three groups (before it, itself, after it). A span with nothing in it is skipped.
 *
 * With `keep` of `null`, or a number that is not a span, nothing is faded: one group over all of `total`. With
 * `'none'` everything is: one faded group (an asset outside every building isolates, and no building is its own).
 */
export function groupsFor(spans: readonly Span[], keep: Keep, total: number): DrawGroup[] {
  if (keep === 'none') return [{ start: 0, count: total, materialIndex: 1 }];
  if (keep === null || keep < 0 || keep >= spans.length) {
    return [{ start: 0, count: total, materialIndex: 0 }];
  }
  const groups: DrawGroup[] = [];
  spans.forEach(({ start, count }, index) => {
    if (count <= 0) return;
    const materialIndex = index === keep ? 0 : 1;
    const last = groups.at(-1);
    if (last?.materialIndex === materialIndex && last.start + last.count === start) {
      last.count += count;
    } else {
      groups.push({ start, count, materialIndex });
    }
  });
  return groups;
}

/**
 * Which of `items` (the things in a merged mesh, in buffer order) is the one drawn as it is while `isolating`: its
 * index, `'none'` when all of them are faded, `null` when nothing is isolated and so nothing is faded. `isFaded` is
 * the scene's rule (`lib/twinLevel.ts`) for one item; the first item it leaves alone is kept.
 */
export function keepIndex<T>(
  items: readonly T[],
  isolating: boolean,
  isFaded: (item: T) => boolean,
): Keep {
  if (!isolating) return null;
  const index = items.findIndex((item) => !isFaded(item));
  return index === -1 ? 'none' : index;
}
