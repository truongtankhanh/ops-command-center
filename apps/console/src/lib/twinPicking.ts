import type { LayerVisibility } from './mapLayers';
import type { BoxRange } from './twinBoxes';
import type { ShellRange } from './twinBuildings';
import { levelOf } from './twinLevel';

/*
 * What a ray or a pointer can hit in the 3D view, and which hit wins, as plain data (V2-15.3, ADR-0020 §
 * Scene, "Settled in V2-15.1" and "Settled in V2-15.3"): no `three`, no WebGL and no DOM, so the rules are
 * tested without them. `twin/picker.ts` casts the ray and calls this; V2-15.4 turns the winner into hover
 * and selection.
 */

/**
 * What can be hit. V2-16 adds `'beacon'` (V2-16.3) and `'ground'` (V2-16.7); `choose` and the scope are
 * written over this union so that neither changes for its callers.
 */
export type PickKind = 'building' | 'asset' | 'part' | 'camera';

/** The thing a hit names. A part also says whose it is: a node name alone is not unique across assets. */
export type PickRef =
  | { kind: 'building' | 'asset' | 'camera'; id: string }
  | { kind: 'part'; id: string; assetCode: string };

/** A pointer position in CSS pixels from the canvas's top-left corner (`PointerEvent.offsetX / offsetY`). */
export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Which kind wins when two things are hit together, first wins (V2-15.1): a part over its asset, an asset
 * over a camera, a camera over a building. The beacon (V2-16.3) goes in front when it exists.
 */
export const KIND_ORDER: readonly PickKind[] = ['part', 'asset', 'camera', 'building'];

/**
 * Two ray hits closer than this are at "equal distance" and the kind decides (V2-15.1). `unverified`: a
 * millimetre-scale float tolerance in metres, chosen to be below anything a person can see; the case it is
 * for is a grazing ray along a face shared by two meshes.
 */
export const TIE_EPSILON_M = 0.01;

/**
 * The side of a camera marker's hit target, in CSS pixels: the drawn sprite (14 × 22 with its stem) grown
 * to the 24 × 24 minimum of WCAG 2.5.8. `unverified`.
 */
export const CAMERA_HIT_SIZE_PX = 24;

/**
 * A press that ends within this many CSS pixels of where it began is a click; further is a drag, which is the
 * camera's (V2-15.4, TwinScene's threshold). `DragHint` has its own, larger figure for when to stop showing
 * its instruction: that is a different question.
 */
export const CLICK_SLOP_PX = 3;

/** Whether a press at `down` that ends at `up` is a click: it moved at most `CLICK_SLOP_PX`. */
export function isClick(down: ScreenPoint, up: ScreenPoint): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= CLICK_SLOP_PX;
}

/** The canvas's cursor (V2-15.4), by what the pointer is doing; the first that applies wins. */
export type CanvasCursor = 'crosshair' | 'grabbing' | 'pointer' | 'grab';

export function cursorOf(state: {
  /** The report location is being picked. */
  picking: boolean;
  /** A press has moved further than the click slop: a drag, an orbit or a pan. */
  dragging: boolean;
  /** The latest pick is something. */
  overTarget: boolean;
}): CanvasCursor {
  if (state.picking) return 'crosshair';
  if (state.dragging) return 'grabbing';
  return state.overTarget ? 'pointer' : 'grab';
}

/** Kinds that are drawn as screen-sized sprites and so are hit in screen space, not by the ray. */
const SPRITE_KINDS: ReadonlySet<PickKind> = new Set<PickKind>(['camera']);

const rankOf = (kind: PickKind): number => KIND_ORDER.length - KIND_ORDER.indexOf(kind);

/** A triangle range of a merged mesh and what its triangles belong to. */
export interface PickEntry {
  firstTriangle: number;
  triangleCount: number;
  ref: PickRef;
}

/** In triangle order, which is the order the builders (`buildShellGeometry`, `buildBoxGeometry`) write. */
export type PickTable = readonly PickEntry[];

/** The table of the merged shells: a triangle of building `zoneId`'s range is that building. */
export function buildingTable(ranges: readonly ShellRange[]): PickTable {
  return ranges.map(({ zoneId, firstTriangle, triangleCount }) => ({
    firstTriangle,
    triangleCount,
    ref: { kind: 'building', id: zoneId },
  }));
}

/** The table of the merged boxes: a triangle of asset `code`'s range is that asset. */
export function boxTable(ranges: readonly BoxRange[]): PickTable {
  return ranges.map(({ code, firstTriangle, triangleCount }) => ({
    firstTriangle,
    triangleCount,
    ref: { kind: 'asset', id: code },
  }));
}

/**
 * What triangle `faceIndex` of the merged mesh belongs to, or `undefined` outside every range. A binary
 * search: the last range that starts at or before the triangle, if the triangle is inside it.
 */
export function entryAt(table: PickTable, faceIndex: number): PickRef | undefined {
  let low = 0;
  let high = table.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const entry = table[middle]!;
    if (faceIndex < entry.firstTriangle) high = middle - 1;
    else if (faceIndex >= entry.firstTriangle + entry.triangleCount) low = middle + 1;
    else return entry.ref;
  }
  return undefined;
}

/** One thing under the pointer. `distance` is metres along the ray, or pixels from the anchor for a sprite. */
export interface PickHit {
  ref: PickRef;
  distance: number;
}

/** What may be hit right now. */
export interface PickScope {
  kinds: ReadonlySet<PickKind>;
  /** When set, the one asset that is isolated: only it and its parts can be hit (V2-15.1). */
  assetCode: string | null;
  /**
   * When set, the building in focus, which is not a target (V2-15.8): its walls are see-through, so a ray through
   * them reaches the equipment inside instead of stopping at the nearest wall.
   */
  excludedBuildingId: string | null;
}

/** The part of the console store that decides the scope. */
export interface ScopeState {
  focusZoneId: string | null;
  selectedAssetCode: string | null;
  selectedPart: string | null;
  /** The report location is being picked: the ground only, which V2-16.7 adds, so no hit until then. */
  picking: boolean;
  layers: Pick<LayerVisibility, 'cameras'>;
}

const NOTHING: PickScope = { kinds: new Set(), assetCode: null, excludedBuildingId: null };

/**
 * What the level allows (V2-15.1, V2-15.8). At campus and building level a building, an asset (as one target) and,
 * while the Cameras layer is on, a camera: the faded buildings and the faded equipment of building level stay
 * pickable, so a click moves the focus, but **the building in focus is not a target**, so the equipment behind its
 * see-through walls is. At asset and part level only the isolated asset and its parts: the faded rest is not a
 * target. While a report location is picked, nothing.
 */
export function scopeOf(state: ScopeState): PickScope {
  if (state.picking) return NOTHING;
  const level = levelOf(state);
  if (level === 'asset' || level === 'part') {
    return {
      kinds: new Set<PickKind>(['asset', 'part']),
      assetCode: state.selectedAssetCode,
      excludedBuildingId: null,
    };
  }
  const kinds = new Set<PickKind>(['building', 'asset']);
  if (state.layers.cameras) kinds.add('camera');
  return {
    kinds,
    assetCode: null,
    excludedBuildingId: level === 'building' ? state.focusZoneId : null,
  };
}

/** Whether `ref` may be hit in `scope`. */
function allowed(ref: PickRef, scope: PickScope): boolean {
  if (!scope.kinds.has(ref.kind)) return false;
  if (ref.kind === 'building' && ref.id === scope.excludedBuildingId) return false;
  if (scope.assetCode === null) return true;
  if (ref.kind === 'asset') return ref.id === scope.assetCode;
  if (ref.kind === 'part') return ref.assetCode === scope.assetCode;
  return false;
}

/**
 * The winner among `hits`, or `null` for nothing under the pointer.
 *
 * - A part that may not be hit (its asset is not isolated) is its asset instead, at the same distance: a ray
 *   through a fan blade at campus level is the cooling tower. A part of an asset that is not the isolated one
 *   is dropped with it.
 * - Of the ray hits the nearest wins; hits within `TIE_EPSILON_M` of it are tied and the higher kind wins.
 * - A sprite and a ray hit under the same pixel are compared by kind only (ADR-0020 "Settled in V2-15.1");
 *   of two sprites the one whose anchor is nearest the pointer wins.
 */
export function choose(hits: readonly PickHit[], scope: PickScope): PickRef | null {
  let ray: PickHit | null = null;
  let sprite: PickHit | null = null;
  const rays: PickHit[] = [];

  for (const hit of hits) {
    let ref = hit.ref;
    if (ref.kind === 'part' && !allowed(ref, scope)) ref = { kind: 'asset', id: ref.assetCode };
    if (!allowed(ref, scope)) continue;
    const kept = ref === hit.ref ? hit : { ref, distance: hit.distance };
    if (SPRITE_KINDS.has(kept.ref.kind)) {
      if (sprite === null || kept.distance < sprite.distance) sprite = kept;
    } else {
      rays.push(kept);
    }
  }

  if (rays.length > 0) {
    const nearest = Math.min(...rays.map((hit) => hit.distance));
    for (const hit of rays) {
      if (hit.distance > nearest + TIE_EPSILON_M) continue;
      if (ray === null || rankOf(hit.ref.kind) > rankOf(ray.ref.kind)) ray = hit;
    }
  }

  if (ray !== null && sprite !== null) {
    return rankOf(sprite.ref.kind) > rankOf(ray.ref.kind) ? sprite.ref : ray.ref;
  }
  return (ray ?? sprite)?.ref ?? null;
}

/** A marker's anchor, projected to CSS pixels from the canvas's top-left corner. */
export interface ProjectedMarker {
  id: string;
  x: number;
  y: number;
}

/**
 * The camera markers under `point`. A marker stands on its anchor (its bottom-centre, the foot of the stem)
 * and is `CAMERA_HIT_SIZE_PX` wide and tall, so the target covers the bitmap above the anchor. Screen `y`
 * runs down, so the target is the square from `anchor.y − size` to `anchor.y`. The distance of a hit is the
 * pixel distance from the anchor.
 */
export function cameraHits(point: ScreenPoint, markers: readonly ProjectedMarker[]): PickHit[] {
  const half = CAMERA_HIT_SIZE_PX / 2;
  const hits: PickHit[] = [];
  for (const { id, x, y } of markers) {
    const dx = point.x - x;
    const dy = point.y - y;
    if (Math.abs(dx) > half || dy > 0 || dy < -CAMERA_HIT_SIZE_PX) continue;
    hits.push({ ref: { kind: 'camera', id }, distance: Math.hypot(dx, dy) });
  }
  return hits;
}

/** What a window of picks cost. */
export interface PickStats {
  count: number;
  meanMs: number;
  maxMs: number;
}

/**
 * Collects the duration of each pick and reports count, mean and maximum once per `windowMs` through
 * `report`, then starts again: the development log of V2-15.3 (a line per pick would cost more than the
 * budget it measures). It has no clock: the caller passes `now`, so it tests without one.
 */
export function createPickStats(report: (stats: PickStats) => void, windowMs = 1000) {
  let start: number | null = null;
  let count = 0;
  let total = 0;
  let max = 0;
  return {
    record(durationMs: number, now: number): void {
      start ??= now;
      count += 1;
      total += durationMs;
      max = Math.max(max, durationMs);
      if (now - start < windowMs) return;
      report({ count, meanMs: total / count, maxMs: max });
      start = null;
      count = 0;
      total = 0;
      max = 0;
    },
  };
}
