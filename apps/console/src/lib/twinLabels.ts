/*
 * Where a zone label goes on the stage, as plain arithmetic with no `three` and no DOM, so it is tested
 * without WebGL (ADR-0020). The labels are DOM elements over the canvas; `twin/ZoneLabels.tsx` projects
 * each anchor through the camera on every drawn frame and turns the result into a style with these.
 */

/**
 * A label whose anchor is this far outside the stage still shows, so one that is half over the edge is
 * not cut short by the anchor leaving. About half the width of a long zone name.
 */
export const LABEL_MARGIN_PX = 64;

/** A point in normalised device coordinates, as `Vector3.project` returns it: x, y and z in −1 … 1 on screen. */
export type Ndc = readonly [x: number, y: number, z: number];

export interface StagePoint {
  /** Pixels from the stage's left edge. */
  x: number;
  /** Pixels from the stage's top edge. */
  y: number;
  /** In front of the camera, inside its depth range, and not farther than `margin` outside the stage. */
  visible: boolean;
}

/**
 * The anchor on the stage, in pixels. A point behind the camera comes out of the projection with
 * `z > 1` (the perspective divide flips its sign), so the depth test hides it as it hides one beyond
 * the far plane; `z < −1` is nearer than the near plane.
 */
export function stagePoint(
  [ndcX, ndcY, ndcZ]: Ndc,
  width: number,
  height: number,
  margin: number = LABEL_MARGIN_PX,
): StagePoint {
  const x = (ndcX * 0.5 + 0.5) * width;
  // NDC's y points up, the stage's down.
  const y = (0.5 - ndcY * 0.5) * height;
  const visible =
    ndcZ >= -1 &&
    ndcZ <= 1 &&
    x >= -margin &&
    x <= width + margin &&
    y >= -margin &&
    y <= height + margin;
  return { x, y, visible };
}

const tenth = (value: number) => Math.round(value * 10) / 10;

/**
 * The CSS `transform` that puts the middle of a label on `(x, y)`. The position is rounded to 0.1 px,
 * so a camera that has settled writes the same string and the style is left alone.
 */
export function labelTransform(x: number, y: number): string {
  return `translate(${tenth(x)}px, ${tenth(y)}px) translate(-50%, -50%)`;
}
