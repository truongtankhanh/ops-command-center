import type { FitBox, Pose, Vec3 } from './twinCamera';

/*
 * The 3D camera's command API (V2-12.9): what the on-screen buttons (V2-12.10), the keys (V2-18), the toast
 * (V2-16.5) and the incident sheet call to move the view, without any of them needing the canvas. The rig
 * (`twin/Rig.tsx`) registers its implementation when it mounts and unregisters it when it goes; with no rig
 * (the 2D view, a stage that has not loaded, one that lost its context) every command does nothing and
 * `current()` is `null`, so a caller never has to know whether a 3D view exists. The one exception is `showAsset`
 * (V2-16.6): its caller switches to the 3D view first, whose stage does not exist yet, so the request waits for the
 * rig (see `PENDING_SHOW_MS`).
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
  /**
   * Flies to the beacon of the incident `id` (V2-16.5, "Fly to"): looking at the foot of its stem from the camera's
   * own yaw and tilt, from the current distance but no farther than 120 m (`incidentView`), within the camera's
   * limits. The rig resolves the beacon from the ones the stage draws, because a caller outside the canvas has the
   * incident and not its place in the scene. An incident with no beacon (not drawn, or not known) does nothing;
   * it is asked for after the selection, so the flight replaces the one a change of level starts.
   */
  flyToIncident(id: string): void;
  /**
   * Frames the asset `code` (V2-16.6, "Show in 3D"): looking at the middle of its box from the camera's own yaw and
   * tilt, as the isolated fit does, but with no selection and no level change, so the level's limits apply and it is
   * shown from at least 60 m. The rig resolves the box from the stage's placed assets. An asset it does not hold does
   * nothing. With no rig yet the request is kept for one (see `PENDING_SHOW_MS`).
   */
  showAsset(code: string): void;
  /** Where the camera is going: its end values, so a command issued while it eases is relative to that. */
  current(): Pose | null;
}

let registered: TwinCommands | null = null;

/**
 * How long a `showAsset` request waits for a rig, in ms. "Show in 3D" from the 2D map switches the view and asks for
 * the flight in the same tick, but the 3D stage is a lazy chunk, then a scene, then the rig: the request is kept and
 * run when the rig registers. It expires so that a switch that never finished (the chunk failed, the operator went
 * back to 2D) cannot fly a camera at some later, unrelated mount. `unverified`: long enough for a slow chunk.
 */
export const PENDING_SHOW_MS = 15_000;

/** The one `showAsset` request waiting for a rig: the latest wins. */
let pendingShow: { code: string; at: number } | null = null;

/**
 * Makes `commands` the implementation, and runs the `showAsset` request that was waiting for a rig if it has not
 * expired (it is dropped either way, so it runs once). Returns what to call to take it away again; that clears the
 * registration **only if it is still this one**, so a rig that was replaced (a stage that remounted) does
 * not undo its successor when its own cleanup runs late.
 */
export function registerTwinCommands(commands: TwinCommands): () => void {
  registered = commands;
  const waiting = pendingShow;
  pendingShow = null;
  if (waiting !== null && Date.now() - waiting.at <= PENDING_SHOW_MS) {
    commands.showAsset(waiting.code);
  }
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
  flyToIncident: (id) => registered?.flyToIncident(id),
  showAsset: (code) => {
    if (registered) registered.showAsset(code);
    else pendingShow = { code, at: Date.now() };
  },
  zoomBy: (factor) => registered?.zoomBy(factor),
  rotateBy: (degrees) => registered?.rotateBy(degrees),
  faceNorth: () => registered?.faceNorth(),
  current: () => registered?.current() ?? null,
};
