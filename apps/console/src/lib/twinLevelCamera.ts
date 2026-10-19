import type { Zone } from '@occ/contracts';
import type { FitBox } from './twinCamera';
import { type LevelState, levelOf, type SceneLevel } from './twinLevel';
import type { PlacedAsset } from './twinPlacement';
import { type Bounds, buildingShells, type Frame, heightOf, type Local } from './twinScene';

/*
 * Where the camera goes when the level changes (V2-15.6, ADR-0020 § Camera): the rule as plain data, with no
 * `three`, no store and no DOM, so every transition is tested without them. `twin/useLevelCamera.ts` watches the
 * store and calls this; `twin/Rig.tsx` flies. The asset's fit is V2-15.7's: the same watcher, one more case.
 */

/**
 * What a level change is, as far as the camera is concerned: the level, the building in focus and the asset
 * isolated. The asset is in the key because one level (`asset`) holds many selections: selecting another asset
 * is a change the camera must follow (V2-15.7).
 */
export interface LevelKey {
  level: SceneLevel;
  focusZoneId: string | null;
  assetCode: string | null;
}

export const levelKeyOf = (state: LevelState): LevelKey => ({
  level: levelOf(state),
  focusZoneId: state.focusZoneId,
  assetCode: state.selectedAssetCode,
});

/** What the camera does for a level change: the home view, the fit of a building, or the fit of an asset. */
export type CameraStep =
  { kind: 'home' } | { kind: 'fit'; box: FitBox } | { kind: 'fit-asset'; box: FitBox };

/** The ground box around `points`. */
function boundsOf(points: readonly Local[]): Bounds {
  const xs = points.map(([x]) => x);
  const zs = points.map(([, z]) => z);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

/**
 * The box of every building the console has, by zone id: the shell's footprint and the height it is drawn at.
 * A building too small to have a shell (`buildingShells` skips it, though its zone is a building and can be
 * focused) falls back to its zone's own polygon, so focusing it still has something to look at. Zones that are
 * not buildings have none: they are not a level.
 */
export function buildingBoxes(zones: readonly Zone[], frame: Frame): Map<string, FitBox> {
  const boxes = new Map<string, FitBox>();
  for (const shell of buildingShells(zones, frame)) {
    boxes.set(shell.zoneId, { bounds: boundsOf(shell.ring), heightM: shell.heightM });
  }
  for (const zone of zones) {
    if (zone.kind !== 'building' || boxes.has(zone.id) || zone.polygon.length === 0) continue;
    boxes.set(zone.id, {
      bounds: boundsOf(zone.polygon.map((point) => frame.toLocal(point))),
      heightM: heightOf(zone),
    });
  }
  return boxes;
}

/**
 * The box of every placed asset, by code (V2-15.7): its footprint turned by the pose's heading, as the ground
 * rectangle that contains it, the height it stands and the elevation of its base. The model's bounds are the
 * footprint (ADR-0020 § Model contract: the footprint follows the model), so this is the model's box as well and a
 * class whose model has not arrived is fitted the same. An asset on a roof has its base at the roof.
 */
export function assetBoxes(placed: readonly PlacedAsset[]): Map<string, FitBox> {
  const boxes = new Map<string, FitBox>();
  for (const { code, pose, size } of placed) {
    const cos = Math.abs(Math.cos(pose.rotationY));
    const sin = Math.abs(Math.sin(pose.rotationY));
    const halfX = (cos * size.x + sin * size.z) / 2;
    const halfZ = (sin * size.x + cos * size.z) / 2;
    boxes.set(code, {
      bounds: {
        minX: pose.x - halfX,
        maxX: pose.x + halfX,
        minZ: pose.z - halfZ,
        maxZ: pose.z + halfZ,
      },
      heightM: size.y,
      baseM: pose.y,
    });
  }
  return boxes;
}

/**
 * The camera's answer to the level going from `previous` to `next`:
 *
 * - **campus**: the home view, whatever it came from (a building, an asset, a part);
 * - **building**: the fit of the building in focus, when the level or the building changed (going up from an
 *   asset, a click on a building, a click on another one) and the console has its box;
 * - **asset and part**: the fit of the asset when it is a different one from before (campus, a building or another
 *   asset to it: one step, the asset's, even when its building changes too) and the console has its box; the
 *   same asset (its part selected or left) does not move the camera;
 * - nothing for no change, and nothing for a first reading (`previous` is `null`): the stage's own first view
 *   is `startBoxOf` / `startAssetBoxOf`, and the camera does not move by itself.
 */
export function levelCameraStep(
  previous: LevelKey | null,
  next: LevelKey,
  boxes: ReadonlyMap<string, FitBox>,
  assets: ReadonlyMap<string, FitBox>,
): CameraStep | null {
  if (previous === null) return null;
  if (
    previous.level === next.level &&
    previous.focusZoneId === next.focusZoneId &&
    previous.assetCode === next.assetCode
  ) {
    return null;
  }
  switch (next.level) {
    case 'campus':
      return { kind: 'home' };
    case 'building': {
      const box = next.focusZoneId === null ? undefined : boxes.get(next.focusZoneId);
      return box === undefined ? null : { kind: 'fit', box };
    }
    case 'asset':
    case 'part': {
      if (next.assetCode === null || next.assetCode === previous.assetCode) return null;
      const box = assets.get(next.assetCode);
      return box === undefined ? null : { kind: 'fit-asset', box };
    }
  }
}

/**
 * The box the stage's first view looks at when it starts at building level (the store keeps its level while the
 * operator is in 2D, and the camera is back at home), or `null` for the home view: at campus, at asset and part
 * level (`startAssetBoxOf` has those), and for a building the console does not hold.
 */
export function startBoxOf(state: LevelState, boxes: ReadonlyMap<string, FitBox>): FitBox | null {
  if (levelOf(state) !== 'building' || state.focusZoneId === null) return null;
  return boxes.get(state.focusZoneId) ?? null;
}

/**
 * The box the stage's first view looks at when it starts with an asset isolated (V2-15.7; the store keeps the
 * selection while the operator is in 2D and the camera is back at home), or `null`: at every other level, and
 * for an asset the console does not hold.
 */
export function startAssetBoxOf(
  state: LevelState,
  assets: ReadonlyMap<string, FitBox>,
): FitBox | null {
  const level = levelOf(state);
  if ((level !== 'asset' && level !== 'part') || state.selectedAssetCode === null) return null;
  return assets.get(state.selectedAssetCode) ?? null;
}
