import type { LngLat, SiteFeaturePart, SitePlan, Zone } from '@occ/contracts';
import type { Feature, FeatureCollection, LineString, Polygon } from 'geojson';
import { METRES_PER_DEGREE, offsetM } from './geo';

/*
 * What the map draws under and between the zones. The site's boundary, roads and field markings
 * are data served by the API (`GET /api/site-plan`, ADR-0017). Building footprints and parking rows
 * are a drawing rule over the zones instead: they apply to any site's zones without a console
 * build, and cannot drift from the zones they are drawn in.
 */

export type SitePart = SiteFeaturePart | 'footprint' | 'parking-row';

export interface SiteProperties {
  part: SitePart;
}

export interface ZoneProperties {
  id: string;
  kind: Zone['kind'];
}

interface Box {
  west: number;
  east: number;
  south: number;
  north: number;
}

/** A building's footprint sits this far inside its zone. */
const FOOTPRINT_INSET_M = 8;
/** Parking rows run east–west this far inside the zone, `ROW_SPACING_M` apart around its middle. */
const ROW_INSET_M = 8;
const ROW_SPACING_M = 15;
/** No row closer than this to the zone's north or south edge. */
const ROW_MARGIN_M = 15;

/**
 * Everything drawn under and between the zones: the served plan in its drawing order (nothing
 * without one), then the parts derived from the zones. Derived parts read each zone's bounding
 * box: every seed zone is an axis-aligned rectangle (`rectangle()` in the API's seed).
 */
export function siteFeatures(
  plan: SitePlan | undefined,
  zones: readonly Zone[],
): FeatureCollection<Polygon | LineString, SiteProperties> {
  return {
    type: 'FeatureCollection',
    features: [
      ...(plan?.features ?? []).map(
        ({ part, geometry }): Feature<Polygon | LineString, SiteProperties> => ({
          type: 'Feature',
          properties: { part },
          geometry,
        }),
      ),
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

/**
 * South-west and north-east corners of the campus: the plan's boundary and every zone. `null` when
 * there is neither, so there is nothing to frame.
 */
export function siteBounds(
  plan: SitePlan | undefined,
  zones: readonly Zone[],
): [LngLat, LngLat] | null {
  const boundary = (plan?.features ?? [])
    .filter((feature) => feature.part === 'boundary')
    .flatMap(({ geometry }) =>
      geometry.type === 'Polygon' ? geometry.coordinates.flat() : geometry.coordinates,
    );
  const points = [...boundary, ...zones.flatMap((zone) => zone.polygon)];
  if (points.length === 0) return null;
  const box = boundsOf(points);
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

/** A closed ring, counter-clockwise from the south-west corner. */
function rect({ west, east, south, north }: Box): LngLat[] {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

function polygon(part: SitePart, ring: LngLat[]): Feature<Polygon, SiteProperties> {
  return {
    type: 'Feature',
    properties: { part },
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

function line(part: SitePart, points: LngLat[]): Feature<LineString, SiteProperties> {
  return {
    type: 'Feature',
    properties: { part },
    geometry: { type: 'LineString', coordinates: points },
  };
}
