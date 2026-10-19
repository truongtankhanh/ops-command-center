import type { FitBox, Pose, Vec3 } from './twinCamera';

/*
 * The 3D camera's command API (V2-12.9): what the on-screen buttons (V2-12.10), the keys (V2-18), the toast
 * and the incident sheet call to move the view, without any of them needing the canvas. The rig
 * (`twin/Rig.tsx`) registers its implementation when it mounts and unregisters it when it goes; with no rig
 * (the 2D view, a stage that has not loaded, one that lost its context) every command does nothing and
 * `current()` is `null`, so a caller never has to know whether a 3D view exists.
 *
 * Plain module state, like the other `lib/` helpers: nothing renders from it, so it is not in the store.
 */

/** Where to fly: a target, and any of the rest; what is missing stays as the camera has it. */
export interface FlyTarget {
  target: Vec3;
  distance?: number;
  yaw?: number;
  tilt?: number;
}

export interface TwinCommands {
  /** Moves to `target` in 600 ms (at once under reduced motion), within the camera's limits. */
  flyTo(target: FlyTarget): void;
  /** Flies to the home view. */
  home(): void;
  /**
   * Flies to the fit of `box`, a building (V2-15.6): the camera looks at the middle of it from the home angles,
   * from as close as shows it whole, beside the open sheet. The rig does the fit because only it knows the
   * stage's shape; a caller outside the canvas has the box and nothing more.
   */
  fit(box: FitBox): void;
  /**
   * Flies to the fit of `box`, an isolated asset (V2-15.7): from the camera's own yaw and tilt, from as close as
   * shows it whole within the asset limits (4 – 40 m), and centred in the part of the stage the inspector will
   * leave visible. Separate from `fit` because a building is looked at from fixed angles and within the campus
   * limits.
   */
  fitAsset(box: FitBox): void;
  /** Dollies by `factor` of the current distance: above 1 moves away, below 1 comes closer. */
  zoomBy(factor: number): void;
  /** Turns round the target by `degrees` (positive turns the camera towards the east). */
  rotateBy(degrees: number): void;
  /** Turns until north is up, keeping the target and the distance. */
  faceNorth(): void;
  /** Where the camera is going: its end values, so a command issued while it eases is relative to that. */
  current(): Pose | null;
}

let registered: TwinCommands | null = null;

/**
 * Makes `commands` the implementation. Returns what to call to take it away again; that clears the
 * registration **only if it is still this one**, so a rig that was replaced (a stage that remounted) does
 * not undo its successor when its own cleanup runs late.
 */
export function registerTwinCommands(commands: TwinCommands): () => void {
  registered = commands;
  return () => {
    if (registered === commands) registered = null;
  };
}

/** The registered commands, or nothing: see the file comment. */
export const twinCommands: TwinCommands = {
  flyTo: (target) => registered?.flyTo(target),
  home: () => registered?.home(),
  fit: (box) => registered?.fit(box),
  fitAsset: (box) => registered?.fitAsset(box),
  zoomBy: (factor) => registered?.zoomBy(factor),
  rotateBy: (degrees) => registered?.rotateBy(degrees),
  faceNorth: () => registered?.faceNorth(),
  current: () => registered?.current() ?? null,
};
