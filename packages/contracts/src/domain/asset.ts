import type { LngLat } from './geo';
import type { TelemetryPoint, TelemetryRule } from './telemetry';

/**
 * The point that says whether a piece of equipment is running: `running` for most classes,
 * `armPosition` for barrier arms. A class has at most one of them. The telemetry overview carries
 * it for every asset whatever its headline rank, so a list can draw Running / Standby for an asset
 * the console does not watch (asset-classes.md § Console presentation; the class's other points
 * are not on the wire until it is watched).
 */
export const ASSET_STATE_POINT_KEYS = ['running', 'armPosition'] as const;
export type AssetStatePointKey = (typeof ASSET_STATE_POINT_KEYS)[number];

/** The box a neutral placeholder is drawn from, in metres: all three are > 0. */
export interface AssetFootprint {
  width: number;
  depth: number;
  height: number;
}

export interface AssetClass {
  id: string;
  /** Lower snake case: `cooling_tower`. */
  code: string;
  name: string;
  /**
   * `/models/<model_key>` of the class's 3D model file (ADR-0020). `null` when the class has no
   * model: clients draw a neutral box from `footprintM`.
   */
  modelUrl: string | null;
  footprintM: AssetFootprint;
}

/** A piece of equipment or a sensor at a fixed place on the site. Its readings are not here. */
export interface Asset {
  id: string;
  /** The operators' tag: `CT-01`, `AHU-C1`, `ICS-DC`. */
  code: string;
  name: string;
  class: AssetClass;
  zoneId: string;
  position: LngLat;
  /** Metres of the asset's base above ground: ≥ 0. A roof is the building's `heightM`. */
  elevationM: number;
  /**
   * Degrees clockwise from true north, 0 ≤ heading < 360, as `CameraFieldOfView.heading`. For a
   * model, the direction its front faces.
   */
  headingDeg: number;
  /**
   * The `code` of one of its zone's `levels` (ADR-0023); `null` when the asset has no level. A
   * client reads a missing `levelCode` as `null`: an API before `asset.level_code` never sends it.
   */
  levelCode?: string | null;
  /** The class's headline points, ordered by `headline` rank: at most two. */
  headline: TelemetryPoint[];
}

export interface AssetDetail extends Asset {
  /** Every point of the class, headline or not. */
  points: TelemetryPoint[];
  rules: TelemetryRule[];
}
