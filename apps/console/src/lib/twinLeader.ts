import type { StagePoint } from './twinLabels';

/*
 * The line from the part callout to its part (V2-15.10, frames 03, 08 and 17), as plain arithmetic with no `three`
 * and no DOM, so it tests without WebGL (ADR-0020). The leader is an SVG overlay over the stage;
 * `twin/LeaderProjector.tsx` projects the part's anchor through the camera on every drawn frame (`stagePoint`, the
 * zone labels' own maths) and writes the line's attributes through refs, with no React render. Rounding to 0.1 px
 * and comparing (`sameLine`) are what let a camera that has settled touch the DOM not at all.
 */

/** Where the line starts: the card's right edge, in pixels from the stage's top left. */
export interface LeaderStart {
  x: number;
  y: number;
}

/** The line's attributes. `visible` is false when there is nothing to draw (the coordinates are then zero). */
export interface LeaderLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  visible: boolean;
}

export const NO_LINE: LeaderLine = Object.freeze({ x1: 0, y1: 0, x2: 0, y2: 0, visible: false });

const tenth = (value: number) => Math.round(value * 10) / 10;

/**
 * The line from `start` to the projected anchor `end`, rounded to 0.1 px. Hidden when the card has not been measured
 * yet (`start` is `null`) or the anchor is not on the stage: behind the camera, beyond its depth range, or farther
 * outside the stage than `stagePoint`'s margin.
 */
export function leaderLine(start: LeaderStart | null, end: StagePoint | null): LeaderLine {
  if (start === null || end === null || !end.visible) return NO_LINE;
  return {
    x1: tenth(start.x),
    y1: tenth(start.y),
    x2: tenth(end.x),
    y2: tenth(end.y),
    visible: true,
  };
}

/** Whether writing `next` over `last` would change nothing. */
export function sameLine(last: LeaderLine, next: LeaderLine): boolean {
  if (!last.visible && !next.visible) return true;
  return (
    last.visible === next.visible &&
    last.x1 === next.x1 &&
    last.y1 === next.y1 &&
    last.x2 === next.x2 &&
    last.y2 === next.y2
  );
}
