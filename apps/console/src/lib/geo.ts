import type { LngLat, Zone } from '@occ/contracts';

/*
 * Metres on the campus. Equirectangular: over a campus a few hundred metres wide the error is far
 * below a pixel at any zoom the map allows.
 */

export const METRES_PER_DEGREE = 111_320;

/** Earth's circumference at the equator, as MapLibre's Web Mercator uses it. */
const EQUATOR_M = 40_075_016.686;
/** MapLibre lays out the world in 512 px tiles. */
const TILE_SIZE_PX = 512;

export function distanceM([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const east = (lng2 - lng1) * METRES_PER_DEGREE * Math.cos(toRadians((lat1 + lat2) / 2));
  const north = (lat2 - lat1) * METRES_PER_DEGREE;
  return Math.hypot(east, north);
}

export function offsetM([lng, lat]: LngLat, eastM: number, northM: number): LngLat {
  return [
    lng + eastM / (METRES_PER_DEGREE * Math.cos(toRadians(lat))),
    lat + northM / METRES_PER_DEGREE,
  ];
}

/** How many screen pixels `metres` covers at `zoom` and latitude `lat`. */
export function metresToPixels(metres: number, zoom: number, lat: number): number {
  return (metres * TILE_SIZE_PX * 2 ** zoom) / (EQUATOR_M * Math.cos(toRadians(lat)));
}

/*
 * Which zone a point is in, by the API's rule (`apps/api/src/common/geo.ts`, `isInPolygon`): planar
 * ray casting on raw coordinates, and a point within `EDGE_TOLERANCE` of an edge counts as inside.
 * A copy, not an approximation: the report form sends the pin's position with the zone found here,
 * and the API answers 400 when it disagrees. Change both together.
 */

/** Within this many degrees (~1 cm) of an edge counts as on it, so rounding never flips a result. */
const EDGE_TOLERANCE = 1e-7;

/** Whether a point lies inside a closed ring or on its boundary. */
export function isInRing([x, y]: LngLat, ring: readonly LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (isOnSegment([x, y], [xi, yi], [xj, yj])) return true;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function isOnSegment([x, y]: LngLat, [x1, y1]: LngLat, [x2, y2]: LngLat): boolean {
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length === 0) return Math.hypot(x - x1, y - y1) <= EDGE_TOLERANCE;
  const distanceToLine = Math.abs((x2 - x1) * (y1 - y) - (x1 - x) * (y2 - y1)) / length;
  const withinEnds =
    Math.min(x1, x2) - EDGE_TOLERANCE <= x &&
    x <= Math.max(x1, x2) + EDGE_TOLERANCE &&
    Math.min(y1, y2) - EDGE_TOLERANCE <= y &&
    y <= Math.max(y1, y2) + EDGE_TOLERANCE;
  return distanceToLine <= EDGE_TOLERANCE && withinEnds;
}

/** The zone containing `point`, or `undefined` outside every zone. Zones do not overlap. */
export const zoneAt = (point: LngLat, zones: readonly Zone[]): Zone | undefined =>
  zones.find((zone) => isInRing(point, zone.polygon));

/** "11.9541, 108.4419": latitude first, 4 decimals (about 11 m), as the report form shows a pin. */
export const formatLatLng = ([lng, lat]: LngLat): string => `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
