import type { Asset, AssetFootprint, LngLat, Zone } from '@occ/contracts';
import { isInRing } from './geo';
import { fanOutAssets } from './mapFeatures';
import { footprintRing } from './sitePlan';
import { type Frame, heightOf } from './twinScene';

/*
 * Where each asset stands in the 3D scene and how big its box is, as plain data: no `three` and no WebGL,
 * so it is tested without either (ADR-0020 § Testing). `twin/AssetBoxes.tsx` draws what this returns.
 *
 * Axes are the scene's (`twinScene.ts`): origin at the site plan's centre, `x` east, `y` up, `z` = −north.
 * An asset's `position` is its footprint's centre and `elevationM` the height of its base, so a box
 * stands on `y` and is centred on `x`, `z`.
 */

/**
 * Where an asset is, as the campus view needs it (V2-12.1, ADR-0020 § Scene): `inside` a building, on its
 * `roof`, or `outdoor`. Campus level draws the last two; `inside` assets appear with their building in focus.
 */
export type Placement = 'outdoor' | 'roof' | 'inside';

/** A pose in scene metres; `rotationY` in radians, counter-clockwise seen from above (three.js). */
export interface AssetPose {
  x: number;
  y: number;
  z: number;
  rotationY: number;
}

/** A box's size along the scene's axes, in metres: `x` east–west at heading 0, `z` north–south. */
export interface BoxSize {
  x: number;
  y: number;
  z: number;
}

/** An asset ready to draw: everything the canvas needs, and nothing it would have to look up. */
export interface PlacedAsset {
  code: string;
  /** `AssetClass.code`: which model, if the class has one, replaces the box (V2-14.7). */
  classCode: string;
  /** The zone it stands in; a building in focus shows the `inside` assets of this zone (V2-15.8). */
  zoneId: string;
  placement: Placement;
  pose: AssetPose;
  size: BoxSize;
}

/**
 * V2-12.1's rule, from catalogue data alone. In a `building` zone an asset is `roof` when its base is at
 * the shell's height (the height the shell is drawn at, `DEFAULT_BUILDING_HEIGHT_M` when the zone has
 * none) and `inside` when its position is in the footprint below that height. Anything else is `outdoor`:
 * a zone that is not a building (`GEN-01` stands 3 m outside its zone; the utility plant is `utility`), a
 * building too small to have a footprint, a position in the inset band, a base above the shell.
 *
 * `zone` is `undefined` when the asset's zone is not in the list: the reference data arrives together, so
 * that is a transient or a catalogue ahead of the zones, and the type has no "unknown" to put it in.
 */
export function placementOf(
  asset: Pick<Asset, 'position' | 'elevationM'>,
  zone: Zone | undefined,
): Placement {
  if (zone === undefined || zone.kind !== 'building') return 'outdoor';
  const height = heightOf(zone);
  if (asset.elevationM === height) return 'roof';
  if (asset.elevationM < height) {
    const footprint = footprintRing(zone);
    if (footprint !== null && isInRing(asset.position, footprint)) return 'inside';
  }
  return 'outdoor';
}

/**
 * The pose of an asset's box. `drawnAt` is where the 2D map draws it (`fanOutAssets`: assets on one spot
 * are spread on a ring), so both views show the same arrangement; it defaults to the catalogue position.
 *
 * `rotationY` is `π − heading`: a model's front is +Z, which is south in the scene, and `headingDeg` runs
 * clockwise from north, so heading 0 turns the model half a turn to face north. `unverified` against the
 * vendor's models (checked in V2-13.8); a neutral box is the same seen from either end.
 */
export function assetPose(
  asset: Pick<Asset, 'position' | 'elevationM' | 'headingDeg'>,
  frame: Frame,
  drawnAt: LngLat = asset.position,
): AssetPose {
  const [x, z] = frame.toLocal(drawnAt);
  return { x, y: asset.elevationM, z, rotationY: Math.PI - (asset.headingDeg * Math.PI) / 180 };
}

/** A class's footprint (width × depth × height) as a size on the scene's axes. */
export function boxOf({ width, depth, height }: AssetFootprint): BoxSize {
  return { x: width, y: height, z: depth };
}

/**
 * Every asset placed and posed, ordered by code so the same catalogue always gives the same list (the
 * boxes' geometry is rebuilt when it changes). The fan-out runs once over **all** the assets, as on the
 * 2D map, so a pair is spread the same way in both views even when one of them is not drawn; the
 * placement uses the catalogue position, which the 4 m ring must not move across a footprint's edge.
 */
export function placeAssets(
  assets: readonly Asset[],
  zones: readonly Zone[],
  frame: Frame,
): PlacedAsset[] {
  const drawnAt = fanOutAssets(assets);
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  return [...assets]
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((asset) => ({
      code: asset.code,
      classCode: asset.class.code,
      zoneId: asset.zoneId,
      placement: placementOf(asset, zoneById.get(asset.zoneId)),
      pose: assetPose(asset, frame, drawnAt.get(asset.code)),
      size: boxOf(asset.class.footprintM),
    }));
}
