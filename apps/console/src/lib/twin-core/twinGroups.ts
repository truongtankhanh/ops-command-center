/*
 * Which part of a merged mesh is drawn as it is and which is faded (V2-15.7), as plain data: no `three`, no
 * buffers, so it tests without them. A merged mesh (the shells, the boxes) draws one material over all its
 * triangles; to fade all but one thing in it, `twin/applyGroups.ts` hands three's `geometry.groups` the spans this
 * returns, with two materials on the mesh: index `0` as drawn, index `1` faded. Nothing is rebuilt; only the list of
 * groups changes, and the picking table of the mesh (triangle -> thing) stays as it was. Since V2-15.8 a span can also
 * be see-through (material `2`, the shells) or left out of every group (not drawn, not hit): `groupsForLooks`.
 */

/** A run of a buffer, in the unit the buffer is drawn in (indices for a faces mesh, vertices for a plain line). */
export interface Span {
  start: number;
  count: number;
}

/** A group of three's geometry: a run drawn with the material at `materialIndex`. */
export interface DrawGroup extends Span {
  /** `0` as drawn, `1` faded, `2` see-through (V2-15.8; only the shells have a third material). */
  materialIndex: 0 | 1 | 2;
}

/** How a span is drawn (V2-15.8): the same words as `Presence` in `lib/twin-core/twinLevel.ts`, which decides them. */
export type SpanLook = 'drawn' | 'faded' | 'xray' | 'hidden';

const MATERIAL_OF = { drawn: 0, faded: 1, xray: 2 } as const;

/**
 * The groups that draw each span with the material of its look (V2-15.8): `drawn` with material 0, `faded` with 1,
 * `xray` with 2, and a `hidden` span in **no** group, so it is not drawn and, because `three-mesh-bvh` only tests the
 * triangles inside a group of a multi-material mesh, not hit either. `looks[i]` is the look of `spans[i]`. Neighbours of
 * one material merge, which a hidden span between them prevents: a mesh costs one draw call per group.
 *
 * With every span `drawn` (and with no span) the answer is one group over all of `total`. With every span `hidden`
 * it is no group at all: nothing of the mesh is drawn or hit.
 */
export function groupsForLooks(
  spans: readonly Span[],
  looks: readonly SpanLook[],
  total: number,
): DrawGroup[] {
  if (looks.every((look) => look === 'drawn'))
    return [{ start: 0, count: total, materialIndex: 0 }];
  const groups: DrawGroup[] = [];
  spans.forEach(({ start, count }, index) => {
    const look = looks[index] ?? 'drawn';
    if (count <= 0 || look === 'hidden') return;
    const materialIndex = MATERIAL_OF[look];
    const last = groups.at(-1);
    if (last?.materialIndex === materialIndex && last.start + last.count === start) {
      last.count += count;
    } else {
      groups.push({ start, count, materialIndex });
    }
  });
  return groups;
}
