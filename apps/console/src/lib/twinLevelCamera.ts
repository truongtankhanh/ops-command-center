import type { Zone } from '@occ/contracts';
import type { FitBox } from './twinCamera';
import { type LevelState, levelOf, type SceneLevel } from './twinLevel';
import { type Bounds, buildingShells, type Frame, heightOf, type Local } from './twinScene';

/*
 * Where the camera goes when the level changes (V2-15.6, ADR-0020 § Camera): the rule as plain data, with no
 * `three`, no store and no DOM, so every transition is tested without them. `twin/useLevelCamera.ts` watches the
 * store and calls this; `twin/Rig.tsx` flies. The asset's fit is V2-15.7's (it adds its case here).
 */

/** What a level change is, as far as the camera is concerned: the level and the building in focus. */
export interface LevelKey {
  level: SceneLevel;
  focusZoneId: string | null;
}

export const levelKeyOf = (state: LevelState): LevelKey => ({
  level: levelOf(state),
  focusZoneId: state.focusZoneId,
});

/** What the camera does for a level change: the home view, or the fit of a building. */
export type CameraStep = { kind: 'home' } | { kind: 'fit'; box: FitBox };

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
 * The camera's answer to the level going from `previous` to `next`:
 *
 * - **campus**: the home view, whatever it came from (a building, an asset, a part);
 * - **building**: the fit of the building in focus, when the level or the building changed (going up from an
 *   asset, a click on a building, a click on another one) and the console has its box;
 * - **asset and part**: nothing here (V2-15.7 fits the asset);
 * - nothing for no change, and nothing for a first reading (`previous` is `null`): the stage's own first view
 *   is `startBoxOf`, and the camera does not move by itself.
 */
export function levelCameraStep(
  previous: LevelKey | null,
  next: LevelKey,
  boxes: ReadonlyMap<string, FitBox>,
): CameraStep | null {
  if (previous === null) return null;
  if (previous.level === next.level && previous.focusZoneId === next.focusZoneId) return null;
  switch (next.level) {
    case 'campus':
      return { kind: 'home' };
    case 'building': {
      const box = next.focusZoneId === null ? undefined : boxes.get(next.focusZoneId);
      return box === undefined ? null : { kind: 'fit', box };
    }
    case 'asset':
    case 'part':
      return null;
  }
}

/**
 * The box the stage's first view looks at when it starts at building level (the store keeps its level while the
 * operator is in 2D, and the camera is back at home), or `null` for the home view: at campus, at asset and part
 * level (V2-15.7), and for a building the console does not hold.
 */
export function startBoxOf(state: LevelState, boxes: ReadonlyMap<string, FitBox>): FitBox | null {
  if (levelOf(state) !== 'building' || state.focusZoneId === null) return null;
  return boxes.get(state.focusZoneId) ?? null;
}
