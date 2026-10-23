import { type BufferAttribute, Color, type Float32BufferAttribute } from 'three';
import type { ShellRange } from '../lib/twin-core/twinBuildings';
import { HOVER_MIX, mixInto } from '../lib/twin-core/twinMaterials';
import { mapColors, twinColors } from '../styles/tokens';
import { filled } from './vertexColours';

/*
 * The look of the buildings' shells, painted without React (V2-15.5): the faces are one mesh with a colour per
 * vertex, every building idle (`--tw-top`), and the building of a hovered `inside` asset takes the hover tint,
 * because nothing of that asset is drawn at campus level (ADR-0020, V2-15.1). The ranges (`ShellRange`, which
 * `twin/Buildings.tsx` keeps beside the geometry) say which vertices are a building's, so the paint touches
 * those and no other. Since V2-17.3 the heat overlay writes to the same attribute: with it shown a building's own
 * colour is its ramp colour (`HeatScene.colours`) instead of the idle top, and the hover tint is laid over whichever
 * it is and gives it back on leaving. The see-through and the faded looks (V2-15.8) are not colours but materials, per
 * group, so they do not touch it. Three but not WebGL, so it is tested without a context.
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
 * What a building looks like with nothing on it: its ramp colour while the heat overlay gives it one, else the idle
 * top. A silent building has no ramp colour and so stays idle (it is faded by its group, not by its colour).
 */
const ownColour = (heat: ReadonlyMap<string, string> | null, zoneId: string): string =>
  heat?.get(zoneId) ?? twinColors.idle.top;

/**
 * Moves the hover tint from the building of zone `previous` to the one of zone `zoneId`: the first goes back to
 * its own colour and the second takes the tint. Either may be `null` (none), and a zone with no range (a shell too
 * small to have one) is left alone. `heat` is the overlay's colours (`HeatScene.colours`) or `null` for none: the
 * building left goes back to its ramp colour, not to idle, while the overlay is shown. A function of its own and not
 * a block of the frame callback: it writes to objects a hook's memo made, which the React Compiler rules would not
 * let a hook body do.
 */
export function paintShell(
  colours: BufferAttribute,
  ranges: readonly ShellRange[],
  zoneId: string | null,
  previous: string | null,
  heat: ReadonlyMap<string, string> | null = null,
): void {
  const rangeOf = (zone: string | null) =>
    zone === null ? undefined : ranges.find((range) => range.zoneId === zone);
  const left = rangeOf(previous);
  if (left !== undefined) fill(colours, left, ownColour(heat, left.zoneId));
  const entered = rangeOf(zoneId);
  if (entered !== undefined) fill(colours, entered, SHELL_HOVER_COLOUR);
}

/**
 * Paints every building its own colour (V2-17.3): the ramp colour from `heat`, or the idle top for a building with
 * none and for no overlay at all, which is how the overlay is switched off. `hovered` is the building the hover tint
 * is on, which keeps the tint over its colour. Run when the overlay changes (and for a shell just built), not per
 * frame; no geometry is touched, only the attribute, which is uploaded once.
 */
export function paintHeat(
  colours: BufferAttribute,
  ranges: readonly ShellRange[],
  heat: ReadonlyMap<string, string> | null,
  hovered: string | null = null,
): void {
  for (const range of ranges) {
    fill(
      colours,
      range,
      range.zoneId === hovered ? SHELL_HOVER_COLOUR : ownColour(heat, range.zoneId),
    );
  }
}
