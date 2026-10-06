import type { LngLat } from '@occ/contracts';

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

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
