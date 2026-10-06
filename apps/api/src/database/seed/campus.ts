import type {
  CameraFieldOfView,
  IncidentSeverity,
  IncidentType,
  LngLat,
  SiteFeature,
  ZoneKind,
} from '@occ/contracts';
import { circle, offset, rectangle, roundedRectangle } from '../../common/geo';

/**
 * Reference data for "Langbiang Tech Campus" — a fictional campus used for development and demos.
 * Positions are metre offsets from the campus centre, so the layout is easy to read and edit.
 */
export const CAMPUS_CENTER: LngLat = [108.4415, 11.953];

interface ZoneSeed {
  code: string;
  name: string;
  kind: ZoneKind;
  /** [east, north] metres from the campus centre. */
  at: [number, number];
  size: [number, number];
}

export const ZONES: ZoneSeed[] = [
  { code: 'GATE-MAIN', name: 'Main Gate', kind: 'gate', at: [0, -250], size: [44, 22] },
  { code: 'BLD-HUB', name: 'Innovation Hub', kind: 'building', at: [-120, 60], size: [90, 60] },
  { code: 'BLD-LIB', name: 'Library', kind: 'building', at: [40, 120], size: [70, 50] },
  { code: 'BLD-DC', name: 'Data Center', kind: 'building', at: [175, 40], size: [60, 46] },
  { code: 'BLD-LHA', name: 'Lecture Hall A', kind: 'building', at: [-60, -110], size: [80, 40] },
  { code: 'BLD-STU', name: 'Student Center', kind: 'building', at: [110, -95], size: [72, 50] },
  { code: 'PRK-WEST', name: 'West Parking', kind: 'parking', at: [-215, -175], size: [90, 70] },
  { code: 'OUT-LAWN', name: 'Central Lawn', kind: 'outdoor', at: [20, 0], size: [110, 70] },
  { code: 'OUT-FIELD', name: 'Sports Field', kind: 'outdoor', at: [-150, 190], size: [120, 70] },
];

/** [west, east] and [south, north] edges in metres from the campus centre. */
interface Box {
  west: number;
  east: number;
  south: number;
  north: number;
}

interface SiteSeed {
  code: string;
  name: string;
  boundary: Box & { radius: number };
  /** Each road a polyline of [east, north] metres. */
  roads: [number, number][][];
  field: Box & { circleRadius: number };
}

/**
 * The site plan drawn under the zones (ADR-0017): boundary, roads and sports-field markings, in
 * metres from the campus centre. Building footprints and parking rows are not here: clients derive
 * them from the zones.
 */
export const SITE: SiteSeed = {
  code: 'LANGBIANG',
  name: 'Langbiang Tech Campus',
  boundary: { west: -282, east: 228, south: -277, north: 247, radius: 18 },
  roads: [
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
  ],
  field: { west: -200, east: -100, south: 165, north: 215, circleRadius: 9 },
};

const CORNER_SEGMENTS = 6;
const CIRCLE_SEGMENTS = 24;

interface CameraSeed {
  code: string;
  name: string;
  zone: string;
  /** [east, north] metres from the zone centre. */
  at: [number, number];
  online?: boolean;
  /**
   * Faces the zone centre, where incidents in the zone are placed, unless the name points it at a
   * lane or an entry. Headings rounded to 5°; the range reaches at least what the camera faces.
   */
  fov: CameraFieldOfView;
}

export const CAMERAS: CameraSeed[] = [
  {
    code: 'CAM-G01',
    name: 'Main gate inbound',
    zone: 'GATE-MAIN',
    at: [-26, -6],
    fov: { heading: 140, angle: 60, range: 50 },
  },
  {
    code: 'CAM-G02',
    name: 'Main gate outbound',
    zone: 'GATE-MAIN',
    at: [26, -6],
    fov: { heading: 325, angle: 60, range: 50 },
  },
  {
    code: 'CAM-H01',
    name: 'Hub lobby',
    zone: 'BLD-HUB',
    at: [0, -32],
    fov: { heading: 0, angle: 90, range: 40 },
  },
  {
    code: 'CAM-H02',
    name: 'Hub east wing',
    zone: 'BLD-HUB',
    at: [46, 10],
    fov: { heading: 260, angle: 90, range: 50 },
  },
  {
    code: 'CAM-L01',
    name: 'Library entrance',
    zone: 'BLD-LIB',
    at: [0, -27],
    fov: { heading: 0, angle: 90, range: 40 },
  },
  {
    code: 'CAM-D01',
    name: 'Data center perimeter',
    zone: 'BLD-DC',
    at: [-32, 0],
    fov: { heading: 90, angle: 90, range: 40 },
  },
  {
    code: 'CAM-D02',
    name: 'Data center loading bay',
    zone: 'BLD-DC',
    at: [32, -12],
    online: false,
    fov: { heading: 290, angle: 90, range: 40 },
  },
  {
    code: 'CAM-A01',
    name: 'Lecture hall foyer',
    zone: 'BLD-LHA',
    at: [0, -22],
    fov: { heading: 0, angle: 90, range: 30 },
  },
  {
    code: 'CAM-S01',
    name: 'Student center plaza',
    zone: 'BLD-STU',
    at: [-38, 0],
    fov: { heading: 90, angle: 110, range: 40 },
  },
  {
    code: 'CAM-P01',
    name: 'West parking entry',
    zone: 'PRK-WEST',
    at: [46, 20],
    fov: { heading: 290, angle: 60, range: 50 },
  },
  {
    code: 'CAM-P02',
    name: 'West parking rows',
    zone: 'PRK-WEST',
    at: [-30, -36],
    fov: { heading: 40, angle: 110, range: 60 },
  },
  {
    code: 'CAM-F01',
    name: 'Sports field north',
    zone: 'OUT-FIELD',
    at: [-62, 0],
    fov: { heading: 90, angle: 110, range: 70 },
  },
];

interface IncidentSeed {
  type: IncidentType;
  severity: IncidentSeverity;
  title: string;
  description: string;
  zone: string;
  /** Minutes before boot. */
  minutesAgo: number;
  acknowledgedAfter?: number;
  resolvedAfter?: number;
  resolution?: string;
}

/** A small history so the console is meaningful before the simulator produces anything. */
export const INCIDENTS: IncidentSeed[] = [
  {
    type: 'equipment_fault',
    severity: 'medium',
    title: 'Loading bay camera offline',
    description: 'CAM-D02 stopped sending frames. Network switch port shows link down.',
    zone: 'BLD-DC',
    minutesAgo: 95,
    acknowledgedAfter: 6,
  },
  {
    type: 'intrusion',
    severity: 'high',
    title: 'Door forced open — service corridor',
    description: 'Door contact on the east service corridor reported forced entry.',
    zone: 'BLD-HUB',
    minutesAgo: 14,
  },
  {
    type: 'crowding',
    severity: 'low',
    title: 'Queue building at main gate',
    description: 'Vehicle queue longer than 12 cars at the inbound lane.',
    zone: 'GATE-MAIN',
    minutesAgo: 6,
  },
  {
    type: 'fire_alarm',
    severity: 'critical',
    title: 'Smoke detector — lecture hall foyer',
    description: 'Detector LHA-SD-04 triggered. Cause: steam from the coffee station.',
    zone: 'BLD-LHA',
    minutesAgo: 180,
    acknowledgedAfter: 1,
    resolvedAfter: 9,
    resolution: 'False alarm confirmed on site; detector reset.',
  },
  {
    type: 'medical',
    severity: 'high',
    title: 'Student feeling unwell — sports field',
    description: 'Reported by field staff via radio.',
    zone: 'OUT-FIELD',
    minutesAgo: 240,
    acknowledgedAfter: 1,
    resolvedAfter: 18,
    resolution: 'First aid given; student collected by family.',
  },
];

export const zoneCenter = (zone: ZoneSeed): LngLat => offset(CAMPUS_CENTER, ...zone.at);
export const zonePolygon = (zone: ZoneSeed): LngLat[] => rectangle(zoneCenter(zone), ...zone.size);

/** `SITE` as drawn features, in drawing order (`sortOrder`, from 0). */
export function siteFeatures(): (SiteFeature & { sortOrder: number })[] {
  const { boundary, field } = SITE;
  const at = (east: number, north: number): LngLat => offset(CAMPUS_CENTER, east, north);
  const centerOf = (box: Box): LngLat => at((box.west + box.east) / 2, (box.south + box.north) / 2);
  const fieldCenter = centerOf(field);
  const halfwayEast = (field.west + field.east) / 2;

  const features: SiteFeature[] = [
    {
      part: 'boundary',
      geometry: {
        type: 'Polygon',
        coordinates: [
          roundedRectangle(
            centerOf(boundary),
            boundary.east - boundary.west,
            boundary.north - boundary.south,
            boundary.radius,
            CORNER_SEGMENTS,
          ),
        ],
      },
    },
    ...SITE.roads.map((road): SiteFeature => ({
      part: 'road',
      geometry: { type: 'LineString', coordinates: road.map(([east, north]) => at(east, north)) },
    })),
    {
      part: 'field',
      geometry: {
        type: 'LineString',
        coordinates: rectangle(fieldCenter, field.east - field.west, field.north - field.south),
      },
    },
    {
      part: 'field',
      geometry: {
        type: 'LineString',
        coordinates: [at(halfwayEast, field.south), at(halfwayEast, field.north)],
      },
    },
    {
      part: 'field',
      geometry: {
        type: 'LineString',
        coordinates: circle(fieldCenter, field.circleRadius, CIRCLE_SEGMENTS),
      },
    },
  ];
  return features.map((feature, sortOrder) => ({ ...feature, sortOrder }));
}
