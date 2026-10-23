import type { ScreenPoint } from './twinPicking';

/*
 * Where and when the 3D view's tooltip appears (V2-15.5), as plain data: no DOM, so the rule is tested without
 * one. `twin/TwinTooltip.tsx` measures the elements and calls this.
 */

/** How long the pointer rests on the same target before the tooltip shows (brief § Scene levels, Hover). */
export const TIP_DELAY_MS = 150;

/** How far the tooltip stands from the pointer, in CSS px, so it never sits under the cursor. */
export const TIP_OFFSET_PX = 18;

export interface Size {
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * The top-left corner of a tooltip of size `tip` for a pointer at `pointer`, in the stage's pixels: to the right
 * of and below the pointer by `TIP_OFFSET_PX`, on its left when there is no room on the right, and clamped
 * inside the stage. `insetRight` is the width the open sheet covers (the stage's `--sheet-inset`): the room
 * ends where the sheet starts, so the tooltip is never half under it (frame 02 puts it left of the part).
 * A tooltip larger than the room sits at the top-left of it.
 */
export function placeTip(
  pointer: ScreenPoint,
  tip: Size,
  stage: Size,
  insetRight = 0,
): { left: number; top: number } {
  const room = stage.width - insetRight;
  const right = pointer.x + TIP_OFFSET_PX;
  const left = right + tip.width > room ? pointer.x - TIP_OFFSET_PX - tip.width : right;
  return {
    left: clamp(left, 0, room - tip.width),
    top: clamp(pointer.y + TIP_OFFSET_PX, 0, stage.height - tip.height),
  };
}
