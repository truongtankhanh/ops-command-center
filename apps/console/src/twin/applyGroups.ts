import type { BufferGeometry } from 'three';
import type { DrawGroup } from '../lib/twin-core/twinGroups';

/**
 * Sets the groups of a merged geometry (V2-15.7): which runs are drawn with the mesh's first material (as they are)
 * and which with its second (faded). Only the list of groups changes; the buffers, the index and the picking table
 * built on them are not touched. A function of its own and not a block of an effect or a memo, like `paintBox`,
 * because it writes to an object a hook's memo made.
 */
export function applyGroups(geometry: BufferGeometry, groups: readonly DrawGroup[]): void {
  geometry.clearGroups();
  for (const { start, count, materialIndex } of groups) {
    geometry.addGroup(start, count, materialIndex);
  }
}
