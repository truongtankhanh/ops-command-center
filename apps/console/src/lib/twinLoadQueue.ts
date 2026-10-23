import type { Asset, LngLat, SitePlan, Zone } from '@occ/contracts';
import { distanceM } from './map/geo';
import { siteBounds } from './map/sitePlan';
import type { LoadStep } from './twinLoading';

/*
 * Which equipment models the 3D stage loads, in which order, and what the loading card says about each
 * (V2-14.7, frame 06). Pure: no `three`, no DOM. The scene (twin chunk) and the card (main chunk) both
 * call `modelClasses` with the same inputs, so the card's rows are in the order the models are fetched.
 */

/** A class with a model: one file serves all its assets (ADR-0020 § Model contract). */
export interface ModelClass {
  /** `AssetClass.code`, e.g. `cooling_tower`. */
  code: string;
  name: string;
  /** `/models/<class>.<hash>.glb`. */
  modelUrl: string;
  assetCount: number;
  /** The code of one asset of the class (the first by code): its detail holds the class's points. */
  representative: string;
  /** Metres from the load target to the nearest asset of the class. */
  distanceM: number;
}

/** How far a class's model has got. `failed` is final: the class stays a box and is not asked for again. */
export interface ClassProgress {
  state: 'queued' | 'loading' | 'ready' | 'failed';
  /** Bytes received so far. */
  loaded: number;
  /** Bytes in all, `0` while the server has not said (no `Content-Length`). */
  total: number;
}

export const QUEUED: ClassProgress = { state: 'queued', loaded: 0, total: 0 };

/**
 * Where "nearest" is measured from: the middle of the campus (the plan's boundary and the zones), which is
 * where the first view looks (`twinCamera.homeView`). `null` when there is nothing to measure from.
 */
export function loadTarget(plan: SitePlan | undefined, zones: readonly Zone[]): LngLat | null {
  const corners = siteBounds(plan, zones);
  if (corners === null) return null;
  const [[west, south], [east, north]] = corners;
  return [(west + east) / 2, (south + north) / 2];
}

const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The classes that have a model, nearest the target first and then by class code. Every asset of a class
 * counts for its distance and its count, the ones that are not drawn at campus level too: the model is
 * needed the moment their building is in focus. With no target the order is the class code's.
 */
export function modelClasses(assets: readonly Asset[], target: LngLat | null): ModelClass[] {
  const classes = new Map<string, ModelClass>();
  for (const asset of [...assets].sort((a, b) => byCode(a.code, b.code))) {
    const { code, name, modelUrl } = asset.class;
    if (modelUrl === null || modelUrl === '') continue;
    const distance = target === null ? 0 : distanceM(target, asset.position);
    const known = classes.get(code);
    if (known === undefined) {
      classes.set(code, {
        code,
        name,
        modelUrl,
        assetCount: 1,
        representative: asset.code,
        distanceM: distance,
      });
    } else {
      known.assetCount += 1;
      known.distanceM = Math.min(known.distanceM, distance);
    }
  }
  return [...classes.values()].sort((a, b) => a.distanceM - b.distanceM || byCode(a.code, b.code));
}

/**
 * A byte count pair as the card says it: "0.6 / 1.4 MB", in kB for a file under a megabyte ("21 / 21 kB"),
 * the unit of the larger number (1 kB = 1,000 bytes, as the build's budget reports). Without a total it
 * is the bytes so far alone.
 */
export function formatProgress(loaded: number, total: number): string {
  const largest = Math.max(loaded, total);
  const [divisor, digits, unit] = largest < 1_000_000 ? [1_000, 0, 'kB'] : [1_000_000, 1, 'MB'];
  const text = (bytes: number) => (bytes / divisor).toFixed(digits);
  return total > 0 ? `${text(loaded)} / ${text(total)} ${unit}` : `${text(loaded)} ${unit}`;
}

/**
 * One row of the loading card per class, in the classes' order. A model on its way is `active` with its
 * bytes, one waiting is `queued`, one that arrived is `done` with its size. One that **failed** is also
 * `done` ("drawn as a box"): the asset keeps its box and the stage is usable, so the card must close like
 * for a success; the failure is the log line, not a row that would hold the card up for ever (V2-14.7).
 */
export function modelSteps(
  classes: readonly ModelClass[],
  progress: Readonly<Record<string, ClassProgress>>,
): LoadStep[] {
  return classes.map(({ code, name, assetCount }): LoadStep => {
    const { state, loaded, total } = progress[code] ?? QUEUED;
    const label = `${name} × ${assetCount}`;
    const id = `model:${code}`;
    switch (state) {
      case 'queued':
        return { id, label, detail: 'queued', state: 'queued' };
      case 'loading':
        return { id, label, detail: formatProgress(loaded, total), state: 'active' };
      case 'ready':
        return {
          id,
          label,
          detail: loaded === 0 && total === 0 ? 'ready' : formatProgress(total || loaded, 0),
          state: 'done',
        };
      case 'failed':
        return { id, label, detail: 'drawn as a box', state: 'done' };
    }
  });
}
