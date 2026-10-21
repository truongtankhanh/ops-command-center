/*
 * The video wall's scale (V2-21.3, ADR-0020 "Settled in V2-21.1"). The console's sizes are laptop pixels times
 * `--ui-scale`; a wall sets its own factor from the window's width, starting at the frame's own: the 3D labels of
 * frame 18 are drawn at `ui: 1.35` on a 1920 px screen, and its text is of the same order. So 1.35 at 1920 and 2.7 at
 * 3840, not UI-17's 1.125 and 1.75, which are for a console people still operate. `unverified` until it is looked at on
 * a wall.
 */

/** The width frame 18 is drawn at. */
export const WALL_DESIGN_WIDTH = 1920;
/** The factor at that width. */
export const WALL_SCALE_AT_DESIGN = 1.35;
/** The factor moves in steps, so a window being dragged does not restyle the page on every pixel. */
export const WALL_SCALE_STEP = 0.05;

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

/** The `--ui-scale` for a window `width` px wide. */
export function wallScale(width: number): number {
  const raw = (WALL_SCALE_AT_DESIGN * width) / WALL_DESIGN_WIDTH;
  const stepped = Math.round(raw / WALL_SCALE_STEP) * WALL_SCALE_STEP;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(stepped.toFixed(2))));
}
