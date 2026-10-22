import type { SelectionTarget } from './twinSelection';

/*
 * What the 3D stage's pad means (V3-29, brief V3 § "Pan tool and the 8-direction pad"): the eight screen directions, how
 * far one press moves, how fast a held press moves and what the centre button looks at. Pure, with no React, no `three`
 * and no store, like `lib/twinKeys.ts`, so the rule tests without WebGL; moving the camera is `twin/Rig.tsx`, reached
 * through `lib/twinCommands.ts`.
 *
 * Directions are **screen** directions along the ground: "up" is away from the viewer whatever the camera's azimuth,
 * which is what `Shift` and the arrows already do (`panBy`: `dx` to the camera's right, `dy` forward, each a fraction of
 * the camera's distance, so a step feels the same at 60 m and at 900 m).
 */

export type PanDirectionId =
  'up' | 'up-right' | 'right' | 'down-right' | 'down' | 'down-left' | 'left' | 'up-left';

export interface PanDirection {
  id: PanDirectionId;
  /** The accessible name of its button: screen words, because "north" is wrong as soon as the view is turned. */
  name: string;
  /** To the camera's right, as a unit component. */
  dx: number;
  /** Forward along the ground, as a unit component. */
  dy: number;
}

/** A diagonal is a unit vector too: it is not faster than an axis. */
const DIAGONAL = Math.SQRT1_2;

/** Clockwise from the top, the order the pad draws them in. */
export const PAN_DIRECTIONS: readonly PanDirection[] = [
  { id: 'up', name: 'Pan up', dx: 0, dy: 1 },
  { id: 'up-right', name: 'Pan up and right', dx: DIAGONAL, dy: DIAGONAL },
  { id: 'right', name: 'Pan right', dx: 1, dy: 0 },
  { id: 'down-right', name: 'Pan down and right', dx: DIAGONAL, dy: -DIAGONAL },
  { id: 'down', name: 'Pan down', dx: 0, dy: -1 },
  { id: 'down-left', name: 'Pan down and left', dx: -DIAGONAL, dy: -DIAGONAL },
  { id: 'left', name: 'Pan left', dx: -1, dy: 0 },
  { id: 'up-left', name: 'Pan up and left', dx: -DIAGONAL, dy: DIAGONAL },
];

/** How much of the visible ground width one press moves the view. `unverified`: the feel, by eye on the reference laptop. */
export const PAD_STEP_SHARE = 0.15;

/**
 * The fraction of the camera's distance that equals `share` of the visible ground width, so a step is the same share
 * of the screen on a wide stage and a narrow one, and zoomed in and out. The view is `2 · d · tan(fov / 2)` high and
 * `aspect` times that wide, so the width over `d` is `2 · tan(fov / 2) · aspect`. A field of view or an aspect that is
 * not a positive finite number gives `0` (no step), never `NaN`.
 */
export function padStep(fovDeg: number, aspect: number, share: number = PAD_STEP_SHARE): number {
  if (![fovDeg, aspect, share].every((value) => Number.isFinite(value) && value > 0)) return 0;
  if (fovDeg >= 180) return 0;
  return share * 2 * Math.tan((fovDeg * Math.PI) / 360) * aspect;
}

/** How far a held press moves the view each second, as a fraction of the camera's distance. `unverified`, by eye. */
export const HOLD_FRACTION_PER_S = 0.4;

/** A frame longer than this counts as this long, so a stall (a hidden tab, a long task) does not jump the view. */
export const HOLD_MAX_DT_S = 0.05;

/** How long a press is held before one step turns into a continuous move, in ms. */
export const HOLD_START_MS = 300;

/**
 * What a held press moves in one frame of `dtSeconds`: `dx` and `dy` as fractions of the camera's distance, from a unit
 * `direction`. A zero, negative or non-finite `dt` moves nothing.
 */
export function holdDelta(
  direction: { dx: number; dy: number },
  dtSeconds: number,
): { dx: number; dy: number } {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return { dx: 0, dy: 0 };
  const scale = HOLD_FRACTION_PER_S * Math.min(dtSeconds, HOLD_MAX_DT_S);
  return { dx: direction.dx * scale, dy: direction.dy * scale };
}

/** What the centre button looks at. */
export type CentreTarget = { kind: 'asset'; code: string } | { kind: 'incident'; id: string };

/**
 * The centre button's target for what is selected (the same selection `F` reads, `selectionTargetOf`): a part, an asset or
 * an incident's asset centres on the **asset** (a part is centred by its asset's box: `unverified`, the part's own middle
 * is not held outside the scene); an incident with no asset centres on its beacon; nothing selected is `null`, and the
 * button is disabled.
 */
export function centreTargetOf(selection: SelectionTarget | null): CentreTarget | null {
  if (selection === null) return null;
  if (selection.kind === 'incident') return { kind: 'incident', id: selection.incidentId };
  return { kind: 'asset', code: selection.assetCode };
}
