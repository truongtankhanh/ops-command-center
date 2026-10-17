import type { LngLat, SitePlan, Zone } from '@occ/contracts';
import { METRES_PER_DEGREE } from './geo';
import { footprintRing, type SitePart, siteBounds, siteFeatures } from './sitePlan';

/*
 * The 3D twin's scene as plain data: the site's longitudes and latitudes in metres, the building shells
 * and the flat ground, with no `three` and no WebGL, so it is tested without either (ADR-0020 § Testing).
 * The meshes of V2-12.6 and V2-12.7 are built from what this returns.
 *
 * Axes (V2-12.1, ADR-0020): origin at `SitePlan.center`, `x` east, `y` up (a height, not handled here),
 * `z` = −north. A point north of the origin therefore has a negative `z`, which is what
 * `TwinScene.dc.html` calls `y`, so the prototype's numbers read directly as `[x, z]`.
 *
 * The 2D map's rules are reused, not copied: a building's shell is the footprint of `sitePlan.ts`
 * (the zone inset by 8 m), and the lines come from `siteFeatures`, so the two views cannot disagree.
 */

/** A point on the ground in metres: `x` east, `z` = −north. */
export type Local = readonly [x: number, z: number];

/** An axis-aligned box on the ground, in metres. */
export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Frame {
  toLocal(point: LngLat): [x: number, z: number];
  fromLocal(x: number, z: number): LngLat;
}

/** A building's extruded shell: the footprint ring, open and counter-clockwise on the map, and its height. */
export interface Shell {
  zoneId: string;
  ring: Local[];
  heightM: number;
}

export interface FlatZone {
  zoneId: string;
  kind: Zone['kind'];
  ring: Local[];
}

/** One line or outline of the site plan, in drawing order. A closed one repeats no point. */
export interface SiteLine {
  part: SitePart;
  closed: boolean;
  points: Local[];
}

/**
 * The height of a building whose zone has none (`Zone.heightM` is `null`), in metres. No document names
 * a value; 12 m is in the lower half of the demo campus's 6 – 24 m, so a missing height is never taller
 * than a real one (V2-12.1).
 */
export const DEFAULT_BUILDING_HEIGHT_M = 12;

/** The camera's target may leave the site by this much (brief § Camera limits). */
export const PAN_MARGIN_M = 40;

/**
 * Metres around `center`, in `geo.ts`'s flat-earth model with the cosine of the centre's latitude:
 * accurate to well under a centimetre over a campus, and the same model the seed builds its zones with.
 * `fromLocal` is the exact inverse of `toLocal`. At the centre `toLocal` gives `+0`, not `−0`.
 */
export function makeFrame([centerLng, centerLat]: LngLat): Frame {
  const metresPerDegreeLng = METRES_PER_DEGREE * Math.cos((centerLat * Math.PI) / 180);
  return {
    toLocal: ([lng, lat]) => [
      (lng - centerLng) * metresPerDegreeLng,
      (centerLat - lat) * METRES_PER_DEGREE,
    ],
    fromLocal: (x, z) => [centerLng + x / metresPerDegreeLng, centerLat - z / METRES_PER_DEGREE],
  };
}

/**
 * The signed area of a ring in m², positive when it runs counter-clockwise on the map (north up, east
 * right), whichever way the viewer's camera looks: the fixed winding the meshes rely on.
 */
export function signedAreaM2(ring: readonly Local[]): number {
  let twice = 0;
  ring.forEach(([x, z], index) => {
    const [nextX, nextZ] = ring[(index + 1) % ring.length]!;
    // North is −z, so the cross product of (east, north) pairs is x·(−nextZ) − nextX·(−z).
    twice += nextX * z - x * nextZ;
  });
  return twice / 2;
}

/** A ring in metres: open (a closing duplicate dropped) and counter-clockwise on the map. */
function ringToLocal(ring: readonly LngLat[], frame: Frame): Local[] {
  const points: Local[] = ring.map((point) => frame.toLocal(point));
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) {
    points.pop();
  }
  return signedAreaM2(points) < 0 ? points.reverse() : points;
}

const heightOf = ({ heightM }: Zone): number =>
  typeof heightM === 'number' && Number.isFinite(heightM) && heightM > 0
    ? heightM
    : DEFAULT_BUILDING_HEIGHT_M;

/**
 * The shell of every building zone, in the zones' order. A building too small to inset has no
 * footprint on the 2D map and no shell here; its flat zone still shows (`flatZones`). A height that is
 * missing, zero, negative or not a number is `DEFAULT_BUILDING_HEIGHT_M`.
 */
export function buildingShells(zones: readonly Zone[], frame: Frame): Shell[] {
  return zones.flatMap((zone) => {
    if (zone.kind !== 'building') return [];
    const ring = footprintRing(zone);
    if (ring === null) return [];
    return [{ zoneId: zone.id, ring: ringToLocal(ring, frame), heightM: heightOf(zone) }];
  });
}

/** Every zone as a flat fill, whatever its kind: the 2D map fills buildings too. */
export function flatZones(zones: readonly Zone[], frame: Frame): FlatZone[] {
  return zones.map((zone) => ({
    zoneId: zone.id,
    kind: zone.kind,
    ring: ringToLocal(zone.polygon, frame),
  }));
}

const lngLat = (position: readonly number[]): LngLat => [position[0] ?? 0, position[1] ?? 0];

/**
 * What is drawn under and between the zones, in the 2D map's order: the served plan's boundary, roads
 * and fields, then the derived footprint outlines and parking rows (`siteFeatures`).
 */
export function siteLines(
  plan: SitePlan | undefined,
  zones: readonly Zone[],
  frame: Frame,
): SiteLine[] {
  return siteFeatures(plan, zones).features.map(({ properties, geometry }) =>
    geometry.type === 'Polygon'
      ? {
          part: properties.part,
          closed: true,
          points: ringToLocal((geometry.coordinates[0] ?? []).map(lngLat), frame),
        }
      : {
          part: properties.part,
          closed: false,
          points: geometry.coordinates.map((position) => frame.toLocal(lngLat(position))),
        },
  );
}

/**
 * The box around the plan's boundary and every zone, as the 2D map frames them (`siteBounds`), or `null`
 * when there is nothing to frame.
 */
export function sceneBounds(
  plan: SitePlan | undefined,
  zones: readonly Zone[],
  frame: Frame,
): Bounds | null {
  const corners = siteBounds(plan, zones);
  if (corners === null) return null;
  const [southWest, northEast] = corners;
  const [westX, southZ] = frame.toLocal(southWest);
  const [eastX, northZ] = frame.toLocal(northEast);
  // North is −z, so the north-east corner has the smaller z.
  return {
    minX: Math.min(westX, eastX),
    maxX: Math.max(westX, eastX),
    minZ: Math.min(southZ, northZ),
    maxZ: Math.max(southZ, northZ),
  };
}

/** Where the camera's target may go: `bounds` grown by `PAN_MARGIN_M` on every side. */
export function panBounds(bounds: Bounds): Bounds {
  return {
    minX: bounds.minX - PAN_MARGIN_M,
    maxX: bounds.maxX + PAN_MARGIN_M,
    minZ: bounds.minZ - PAN_MARGIN_M,
    maxZ: bounds.maxZ + PAN_MARGIN_M,
  };
}
