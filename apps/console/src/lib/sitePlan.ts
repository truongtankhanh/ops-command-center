import type { LngLat, Zone } from '@occ/contracts';
import type { Feature, FeatureCollection, LineString, Polygon } from 'geojson';
import { METRES_PER_DEGREE, offsetM } from './geo';

/**
 * The campus centre: a copy of `CAMPUS_CENTER` in `apps/api/src/database/seed/campus.ts`. The site
 * plan below is drawn in metres from it, the same way the seed places the zones, so the two line up.
 * One campus exists; serving the site plan from the API is for when there is a second one.
 */
export const CAMPUS_CENTER: LngLat = [108.4415, 11.953];

export type SitePart = 'boundary' | 'road' | 'field' | 'footprint' | 'parking-row';

export interface SiteProperties {
  part: SitePart;
}

export interface ZoneProperties {
  id: string;
  kind: Zone['kind'];
}

/** [east, north] metres from `CAMPUS_CENTER`. */
type Metres = [east: number, north: number];

interface Box {
  west: number;
  east: number;
  south: number;
  north: number;
}

// Frame 01's site plan. Boundary, roads and the sports-field markings are not in the zone data, so
// they live here; footprints and parking rows are derived from the zones below.
const BOUNDARY: Box & { radius: number } = {
  west: -282,
  east: 228,
  south: -277,
  north: 247,
  radius: 18,
};
const ROADS: Metres[][] = [
  [
    [0, -285],
    [0, -35],
  ],
  [
    [-215, -140],
    [-215, -55],
    [215, -55],
  ],
  [
    [-55, -55],
    [-55, 160],
    [120, 160],
    [120, -55],
  ],
];
const FIELD: Box = { west: -200, east: -100, south: 165, north: 215 };
const FIELD_CIRCLE_RADIUS_M = 9;

/** A building's footprint sits this far inside its zone. */
const FOOTPRINT_INSET_M = 8;
/** Parking rows run east–west this far inside the zone, `ROW_SPACING_M` apart around its middle. */
const ROW_INSET_M = 8;
const ROW_SPACING_M = 15;
/** No row closer than this to the zone's north or south edge. */
const ROW_MARGIN_M = 15;

const CORNER_SEGMENTS = 6;
const CIRCLE_SEGMENTS = 24;

/**
 * Everything drawn under and between the zones. Derived parts read each zone's bounding box: every
 * seed zone is an axis-aligned rectangle (`rectangle()` in the API's seed).
 */
export function siteFeatures(
  zones: readonly Zone[],
): FeatureCollection<Polygon | LineString, SiteProperties> {
  const fieldCentre: Metres = [(FIELD.west + FIELD.east) / 2, (FIELD.south + FIELD.north) / 2];
  const halfwayLine: Metres[] = [
    [fieldCentre[0], FIELD.south],
    [fieldCentre[0], FIELD.north],
  ];
  return {
    type: 'FeatureCollection',
    features: [
      polygon('boundary', roundedRect(BOUNDARY, BOUNDARY.radius).map(fromMetres)),
      ...ROADS.map((road) => line('road', road.map(fromMetres))),
      line('field', rect(FIELD).map(fromMetres)),
      line('field', halfwayLine.map(fromMetres)),
      line('field', circle(fieldCentre, FIELD_CIRCLE_RADIUS_M).map(fromMetres)),
      ...zones.filter((zone) => zone.kind === 'building').flatMap(footprint),
      ...zones.filter((zone) => zone.kind === 'parking').flatMap(parkingRows),
    ],
  };
}

export function zoneFeatures(zones: readonly Zone[]): FeatureCollection<Polygon, ZoneProperties> {
  return {
    type: 'FeatureCollection',
    features: zones.map((zone) => ({
      type: 'Feature',
      properties: { id: zone.id, kind: zone.kind },
      geometry: { type: 'Polygon', coordinates: [zone.polygon] },
    })),
  };
}

/** South-west and north-east corners of the campus: the boundary and every zone. */
export function siteBounds(zones: readonly Zone[]): [LngLat, LngLat] {
  const [west, south] = fromMetres([BOUNDARY.west, BOUNDARY.south]);
  const [east, north] = fromMetres([BOUNDARY.east, BOUNDARY.north]);
  const box = zones
    .map((zone) => boundsOf(zone.polygon))
    .reduce(
      (all, b) => ({
        west: Math.min(all.west, b.west),
        east: Math.max(all.east, b.east),
        south: Math.min(all.south, b.south),
        north: Math.max(all.north, b.north),
      }),
      { west, east, south, north },
    );
  return [
    [box.west, box.south],
    [box.east, box.north],
  ];
}

function footprint(zone: Zone): Feature<Polygon, SiteProperties>[] {
  const box = boundsOf(zone.polygon);
  const [west, south] = offsetM([box.west, box.south], FOOTPRINT_INSET_M, FOOTPRINT_INSET_M);
  const [east, north] = offsetM([box.east, box.north], -FOOTPRINT_INSET_M, -FOOTPRINT_INSET_M);
  if (west >= east || south >= north) return [];
  return [polygon('footprint', rect({ west, east, south, north }))];
}

function parkingRows(zone: Zone): Feature<LineString, SiteProperties>[] {
  const box = boundsOf(zone.polygon);
  const middle = (box.south + box.north) / 2;
  const heightM = (box.north - box.south) * METRES_PER_DEGREE;
  const steps = Math.floor((heightM / 2 - ROW_MARGIN_M) / ROW_SPACING_M);
  const rows: Feature<LineString, SiteProperties>[] = [];
  for (let k = -steps; k <= steps; k += 1) {
    const [, lat] = offsetM([box.west, middle], 0, k * ROW_SPACING_M);
    const start = offsetM([box.west, lat], ROW_INSET_M, 0);
    const end = offsetM([box.east, lat], -ROW_INSET_M, 0);
    if (start[0] < end[0]) rows.push(line('parking-row', [start, end]));
  }
  return rows;
}

function boundsOf(points: readonly LngLat[]): Box {
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  return {
    west: Math.min(...lngs),
    east: Math.max(...lngs),
    south: Math.min(...lats),
    north: Math.max(...lats),
  };
}

const fromMetres = ([east, north]: Metres): LngLat => offsetM(CAMPUS_CENTER, east, north);

/** A closed ring, counter-clockwise from the south-west corner. Works in metres or degrees. */
function rect({ west, east, south, north }: Box): [number, number][] {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

/** A closed ring with each corner rounded by `radius`, counter-clockwise. */
function roundedRect({ west, east, south, north }: Box, radius: number): Metres[] {
  const corners: [cx: number, cy: number, startDeg: number][] = [
    [east - radius, south + radius, 270],
    [east - radius, north - radius, 0],
    [west + radius, north - radius, 90],
    [west + radius, south + radius, 180],
  ];
  const ring = corners.flatMap(([cx, cy, startDeg]) =>
    Array.from({ length: CORNER_SEGMENTS + 1 }, (_, i): Metres => {
      const angle = ((startDeg + (90 * i) / CORNER_SEGMENTS) * Math.PI) / 180;
      return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
    }),
  );
  return [...ring, ring[0]!];
}

/** A closed ring approximating a circle. */
function circle([cx, cy]: Metres, radius: number): Metres[] {
  return Array.from({ length: CIRCLE_SEGMENTS + 1 }, (_, i): Metres => {
    const angle = (2 * Math.PI * i) / CIRCLE_SEGMENTS;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  });
}

function polygon(part: SitePart, ring: [number, number][]): Feature<Polygon, SiteProperties> {
  return {
    type: 'Feature',
    properties: { part },
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

function line(part: SitePart, points: [number, number][]): Feature<LineString, SiteProperties> {
  return {
    type: 'Feature',
    properties: { part },
    geometry: { type: 'LineString', coordinates: points },
  };
}
