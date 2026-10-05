import type { LngLat } from '@occ/contracts';

const METERS_PER_DEGREE_LAT = 111_320;

/** Offsets a point by metres east / north. Accurate enough at campus scale. */
export function offset([lng, lat]: LngLat, eastMeters: number, northMeters: number): LngLat {
  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
  return [
    round(lng + eastMeters / metersPerDegreeLng),
    round(lat + northMeters / METERS_PER_DEGREE_LAT),
  ];
}

/** Closed rectangular ring centred on a point. */
export function rectangle(center: LngLat, widthMeters: number, heightMeters: number): LngLat[] {
  const w = widthMeters / 2;
  const h = heightMeters / 2;
  const ring = [
    offset(center, -w, -h),
    offset(center, w, -h),
    offset(center, w, h),
    offset(center, -w, h),
  ];
  return [...ring, ring[0]!];
}

/** Random point inside the inner part of a polygon's bounding box — used by the simulator. */
export function randomPointIn(
  polygon: LngLat[],
  random: () => number = Math.random,
  inset = 0.2,
): LngLat {
  const lngs = polygon.map(([lng]) => lng);
  const lats = polygon.map(([, lat]) => lat);
  const pick = (min: number, max: number) => {
    const margin = (max - min) * inset;
    return round(min + margin + random() * (max - min - 2 * margin));
  };
  return [pick(Math.min(...lngs), Math.max(...lngs)), pick(Math.min(...lats), Math.max(...lats))];
}

/** Within this many degrees (~1 cm) of an edge counts as on it, so rounding never flips a result. */
const EDGE_TOLERANCE = 1e-7;

/**
 * Whether a point lies inside a closed ring or on its boundary. Planar ray casting on raw
 * coordinates: exact enough at campus scale, and the ring may be convex or not.
 */
export function isInPolygon([x, y]: LngLat, ring: LngLat[]): boolean {
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

const round = (n: number) => Math.round(n * 1e7) / 1e7;
