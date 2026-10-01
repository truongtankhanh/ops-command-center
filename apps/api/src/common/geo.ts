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

const round = (n: number) => Math.round(n * 1e7) / 1e7;
