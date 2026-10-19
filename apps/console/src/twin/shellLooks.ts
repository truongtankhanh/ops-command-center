import { type BufferAttribute, Color, type Float32BufferAttribute } from 'three';
import type { ShellRange } from '../lib/twinBuildings';
import { HOVER_MIX, mixInto } from '../lib/twinMaterials';
import { mapColors, twinColors } from '../styles/tokens';
import { filled } from './vertexColours';

/*
 * The look of the buildings' shells, painted without React (V2-15.5): the faces are one mesh with a colour per
 * vertex, every building idle (`--tw-top`), and the building of a hovered `inside` asset takes the hover tint,
 * because nothing of that asset is drawn at campus level (ADR-0020, V2-15.1). The ranges (`ShellRange`, which
 * `twin/Buildings.tsx` keeps beside the geometry) say which vertices are a building's, so the paint touches
 * those and no other. V2-15.8 (see-through, faded) and V2-17.3 (heat) are the next to write to the same
 * attribute. Three but not WebGL, so it is tested without a context.
 */

/** The hover tint of a building: the accent mixed into the idle top at the hover weight, as `--tw-hover-top`. */
export const SHELL_HOVER_COLOUR = mixInto(twinColors.idle.top, mapColors.accent, HOVER_MIX);

/** The faces' colour attribute for `vertexCount` vertices, every building idle. */
export function createShellColours(vertexCount: number): Float32BufferAttribute {
  return filled(vertexCount, twinColors.idle.top);
}

const scratch = new Color();

/** Writes `hex` into every vertex of `range`. */
function fill(colours: BufferAttribute, range: ShellRange, hex: string): void {
  scratch.set(hex);
  for (let v = range.firstVertex; v < range.firstVertex + range.vertexCount; v += 1) {
    colours.setXYZ(v, scratch.r, scratch.g, scratch.b);
  }
  colours.needsUpdate = true;
}

/**
 * Moves the hover tint from the building of zone `previous` to the one of zone `zoneId`: the first goes back to
 * idle and the second takes the tint. Either may be `null` (none), and a zone with no range (a shell too small to
 * have one) is left alone. A function of its own and not a block of the frame callback: it writes to objects a
 * hook's memo made, which the React Compiler rules would not let a hook body do.
 */
export function paintShell(
  colours: BufferAttribute,
  ranges: readonly ShellRange[],
  zoneId: string | null,
  previous: string | null,
): void {
  const rangeOf = (zone: string | null) =>
    zone === null ? undefined : ranges.find((range) => range.zoneId === zone);
  const left = rangeOf(previous);
  if (left !== undefined) fill(colours, left, twinColors.idle.top);
  const entered = rangeOf(zoneId);
  if (entered !== undefined) fill(colours, entered, SHELL_HOVER_COLOUR);
}
