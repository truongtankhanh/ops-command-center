import type { LayerVisibility } from '../map/mapLayers';
import type { Vec3 } from './twinCamera';
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
 * What can be hit. `'beacon'` is an incident's beacon (V2-16.4, `id` is the incident's id); `'ground'` (V2-16.7) is not
 * a thing but a **place**: the point the ray meets while the report's location is being picked (the nearest of the
 * roofs and the ground), so it has coordinates and no id. `choose` and the scope are written over this union so that
 * neither changes for its callers; a ground ref never goes through `choose`.
 */
export type PickKind = 'building' | 'asset' | 'part' | 'camera' | 'beacon' | 'ground';

/** The thing a hit names. A part also says whose it is: a node name alone is not unique across assets. */
export type PickRef =
  | { kind: 'building' | 'asset' | 'camera' | 'beacon'; id: string }
  | { kind: 'part'; id: string; assetCode: string }
  /** A point in scene metres (`x` east, `y` up, `z` = −north), the surface under the pointer while picking a location. */
  | { kind: 'ground'; x: number; y: number; z: number };

/** A pointer position in CSS pixels from the canvas's top-left corner (`PointerEvent.offsetX / offsetY`). */
export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Which kind wins when two things are hit together, first wins (V2-15.1): a beacon over everything (an incident is
 * what the console is for, V2-16.4), a part over its asset, an asset over a camera, a camera over a building.
 */
export const KIND_ORDER: readonly PickKind[] = ['beacon', 'part', 'asset', 'camera', 'building'];

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
const SPRITE_KINDS: ReadonlySet<PickKind> = new Set<PickKind>(['camera', 'beacon']);

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

/**
 * One thing under the pointer. `distance` is metres along the ray, or pixels from the anchor (a camera) or from the
 * disc's centre (a beacon) for a sprite. `rank` is a beacon's paint rank, which settles a tie between beacons.
 */
export interface PickHit {
  ref: PickRef;
  distance: number;
  rank?: number;
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
  /** The report location is being picked (V2-16.7): the only targets are the roofs and the ground, as a place. */
  picking: boolean;
  layers: Pick<LayerVisibility, 'cameras' | 'incidents'>;
}

/**
 * What the level allows (V2-15.1, V2-15.8). At campus and building level a building, an asset (as one target) and,
 * while the Cameras layer is on, a camera: the faded buildings and the faded equipment of building level stay
 * pickable, so a click moves the focus, but **the building in focus is not a target**, so the equipment behind its
 * see-through walls is. At asset and part level only the isolated asset and its parts: the faded rest is not a
 * target. A beacon is a target at campus and building level while the Incidents layer is on (V2-16.4), and never
 * with an asset isolated, as every other target there.
 *
 * While a report location is picked (V2-16.7) the targets are the building shells (roofs included) and the ground, as
 * a place and not a thing (`nearestSurface`): no asset, part, camera or beacon, as the 2D map hits nothing but the
 * ground. The focused building's see-through walls are still not a target, so a click through it lands on its floor.
 */
export function scopeOf(state: ScopeState): PickScope {
  const level = levelOf(state);
  if (state.picking) {
    return {
      kinds: new Set<PickKind>(['building', 'ground']),
      assetCode: null,
      excludedBuildingId: level === 'building' ? state.focusZoneId : null,
    };
  }
  if (level === 'asset' || level === 'part') {
    return {
      kinds: new Set<PickKind>(['asset', 'part']),
      assetCode: state.selectedAssetCode,
      excludedBuildingId: null,
    };
  }
  const kinds = new Set<PickKind>(['building', 'asset']);
  if (state.layers.cameras) kinds.add('camera');
  if (state.layers.incidents) kinds.add('beacon');
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
 * The extra reach of a beacon's target beyond its disc, in CSS pixels (V2-16.4): the disc grown by this much all
 * round. The smallest disc (10 px) then makes a 28 px target, above the 24 px of WCAG 2.5.8. `unverified`.
 */
export const BEACON_HIT_PAD_PX = 4;

/**
 * Two beacons whose disc centres are within this many CSS pixels of the nearest one are tied, and the one painted on
 * top wins (V2-16.4): beacons that share a point overlap exactly, and what is seen must be what is hit. `unverified`.
 */
export const BEACON_TIE_PX = 1;

/**
 * The winner among beacon hits: the nearest disc centre, unless another is within `BEACON_TIE_PX` of it, and then
 * the highest paint rank (the one drawn on top); the nearer of two of one rank.
 */
function topBeacon(hits: readonly PickHit[]): PickHit | null {
  if (hits.length === 0) return null;
  const nearest = Math.min(...hits.map((hit) => hit.distance));
  let best: PickHit | null = null;
  for (const hit of hits) {
    if (hit.distance > nearest + BEACON_TIE_PX) continue;
    const better =
      best === null ||
      (hit.rank ?? 0) > (best.rank ?? 0) ||
      ((hit.rank ?? 0) === (best.rank ?? 0) && hit.distance < best.distance);
    if (better) best = hit;
  }
  return best;
}

/**
 * The winner among `hits`, or `null` for nothing under the pointer.
 *
 * - A part that may not be hit (its asset is not isolated) is its asset instead, at the same distance: a ray
 *   through a fan blade at campus level is the cooling tower. A part of an asset that is not the isolated one
 *   is dropped with it.
 * - Of the ray hits the nearest wins; hits within `TIE_EPSILON_M` of it are tied and the higher kind wins.
 * - A sprite and a ray hit under the same pixel are compared by kind only (ADR-0020 "Settled in V2-15.1");
 *   of two camera markers the one whose anchor is nearest the pointer wins; a beacon wins over a camera, and of
 *   several beacons see `topBeacon`.
 */
export function choose(hits: readonly PickHit[], scope: PickScope): PickRef | null {
  let ray: PickHit | null = null;
  let camera: PickHit | null = null;
  const beacons: PickHit[] = [];
  const rays: PickHit[] = [];

  for (const hit of hits) {
    let ref = hit.ref;
    if (ref.kind === 'part' && !allowed(ref, scope)) ref = { kind: 'asset', id: ref.assetCode };
    if (!allowed(ref, scope)) continue;
    const kept = ref === hit.ref ? hit : { ref, distance: hit.distance };
    if (kept.ref.kind === 'beacon') {
      beacons.push(kept);
    } else if (SPRITE_KINDS.has(kept.ref.kind)) {
      if (camera === null || kept.distance < camera.distance) camera = kept;
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

  const sprite = topBeacon(beacons) ?? camera;
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

/** A surface the ray crossed while a location is picked: how far, where, and which building's shell it is (if any). */
export interface SurfaceHit {
  /** Metres along the ray. */
  distance: number;
  point: Vec3;
  /** The zone id of the building whose shell this is, `null` for the ground plane. */
  buildingId: string | null;
}

/**
 * The place the pointer is on while a location is picked (V2-16.7): the point of the **nearest** hit, a roof or a wall
 * of a building shell or the ground plane, skipping the building the scope does not target (the one in focus, whose
 * walls are see-through). `null` when nothing is hit (a ray that goes up and meets no shell). Plain data, so the rule
 * is tested without `three`; `twin/picker.ts` builds the hits.
 */
export function nearestSurface(hits: readonly SurfaceHit[], scope: PickScope): Vec3 | null {
  let nearest: SurfaceHit | null = null;
  for (const hit of hits) {
    if (hit.buildingId !== null && hit.buildingId === scope.excludedBuildingId) continue;
    if (nearest === null || hit.distance < nearest.distance) nearest = hit;
  }
  return nearest === null ? null : [...nearest.point];
}

/** A beacon's disc, projected to CSS pixels from the canvas's top-left corner: its centre, radius and paint rank. */
export interface ProjectedBeacon {
  id: string;
  x: number;
  y: number;
  /** The disc's radius in CSS pixels (`discRadiusOf`). */
  radius: number;
  /** `paintRank`: higher is painted later, so on top. */
  rank: number;
}

/**
 * The beacons under `point` (V2-16.4): a circular target on the disc's centre, `radius + BEACON_HIT_PAD_PX` wide
 * (the stem, the ellipse and the tag pill are not targets). The distance of a hit is the pixel distance from the
 * centre; `choose` settles overlaps.
 */
export function beaconHits(point: ScreenPoint, beacons: readonly ProjectedBeacon[]): PickHit[] {
  const hits: PickHit[] = [];
  for (const { id, x, y, radius, rank } of beacons) {
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance > radius + BEACON_HIT_PAD_PX) continue;
    hits.push({ ref: { kind: 'beacon', id }, distance, rank });
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
