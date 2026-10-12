import type {
  CameraFieldOfView,
  IncidentSeverity,
  IncidentType,
  LngLat,
  SiteFeature,
  ZoneKind,
  ZoneUse,
} from '@occ/contracts';
import { circle, offset, rectangle, roundedRectangle } from '../../common/geo';

/**
 * Reference data for "Langbiang Tech Campus" — a fictional campus used for development and demos.
 * Positions are metre offsets from the campus centre, so the layout is easy to read and edit.
 */
export const CAMPUS_CENTER: LngLat = [108.4415, 11.953];

export interface ZoneSeed {
  code: string;
  name: string;
  kind: ZoneKind;
  /** Buildings only (`zone_use_check`). */
  use?: ZoneUse;
  /**
   * Metres above ground of a building's shell, `> 0`. Buildings only by convention: the
   * `zone_height_check` constraint does not look at the kind.
   */
  heightM?: number;
  /** [east, north] metres from the campus centre. */
  at: [number, number];
  size: [number, number];
}

/**
 * Append only, and keep the nine zones of the first campus where they are: a top-up never rewrites
 * the geometry of a zone that exists, so a change to one of them would split fresh and upgraded
 * volumes. Positions follow `TwinScene.dc.html` (its y axis is south-positive: north = −y).
 */
export const ZONES: ZoneSeed[] = [
  { code: 'GATE-MAIN', name: 'Main Gate', kind: 'gate', at: [0, -250], size: [44, 22] },
  {
    code: 'BLD-HUB',
    name: 'Innovation Hub',
    kind: 'building',
    use: 'academic',
    heightM: 24,
    at: [-120, 60],
    size: [90, 60],
  },
  {
    code: 'BLD-LIB',
    name: 'Library',
    kind: 'building',
    use: 'library',
    heightM: 18,
    at: [40, 120],
    size: [70, 50],
  },
  {
    code: 'BLD-DC',
    name: 'Data Center',
    kind: 'building',
    use: 'data_center',
    heightM: 14,
    at: [175, 40],
    size: [60, 46],
  },
  {
    code: 'BLD-LHA',
    name: 'Lecture Hall A',
    kind: 'building',
    use: 'academic',
    heightM: 16,
    at: [-60, -110],
    size: [80, 40],
  },
  {
    code: 'BLD-STU',
    name: 'Student Center',
    kind: 'building',
    use: 'dining',
    heightM: 12,
    at: [110, -95],
    size: [72, 50],
  },
  { code: 'PRK-WEST', name: 'West Parking', kind: 'parking', at: [-215, -175], size: [90, 70] },
  { code: 'OUT-LAWN', name: 'Central Lawn', kind: 'outdoor', at: [20, 0], size: [110, 70] },
  { code: 'OUT-FIELD', name: 'Sports Field', kind: 'outdoor', at: [-150, 190], size: [120, 70] },
  {
    code: 'BLD-LAB',
    name: 'Science Lab',
    kind: 'building',
    use: 'laboratory',
    heightM: 16,
    at: [170, 212],
    size: [90, 64],
  },
  {
    code: 'BLD-DORA',
    name: 'Dormitory A',
    kind: 'building',
    use: 'residential',
    heightM: 20,
    at: [80, -181.5],
    size: [90, 47],
  },
  {
    code: 'BLD-DORB',
    name: 'Dormitory B',
    kind: 'building',
    use: 'residential',
    heightM: 20,
    at: [178.5, -181.5],
    size: [87, 47],
  },
  {
    code: 'BLD-CLINIC',
    name: 'Health Clinic',
    kind: 'building',
    use: 'healthcare',
    heightM: 10,
    at: [183.5, -240],
    size: [77, 56],
  },
  {
    code: 'BLD-SPORTS',
    name: 'Sports Hall',
    kind: 'building',
    use: 'sports_hall',
    heightM: 14,
    at: [-40, 207],
    size: [80, 74],
  },
  {
    code: 'BLD-ADMIN',
    name: 'Admin Building',
    kind: 'building',
    use: 'administration',
    heightM: 14,
    at: [-226, -14],
    size: [92, 68],
  },
  {
    code: 'BLD-SEC',
    name: 'Security office',
    kind: 'building',
    use: 'security_post',
    heightM: 6,
    at: [42, -251.5],
    size: [32, 27],
  },
  { code: 'UTL-PLANT', name: 'Utility Plant', kind: 'utility', at: [65, 207], size: [110, 74] },
  { code: 'WTR-LAKE', name: 'Lake', kind: 'water', at: [-95, -196.5], size: [110, 63] },
  { code: 'PRK-EAST', name: 'East Parking', kind: 'parking', at: [185, -116], size: [60, 48] },
  { code: 'GATE-EAST', name: 'East Gate', kind: 'gate', at: [216.5, -55], size: [23, 34] },
];

/**
 * The zones of the first demo campus. A database that holds all of them is "the reference campus":
 * the only kind of database a top-up may add the seed's data to. Frozen on purpose — a code added
 * to `ZONES` must never be added here, or every volume seeded before it stops being topped up.
 */
export const REFERENCE_ZONE_CODES: readonly string[] = [
  'GATE-MAIN',
  'BLD-HUB',
  'BLD-LIB',
  'BLD-DC',
  'BLD-LHA',
  'BLD-STU',
  'PRK-WEST',
  'OUT-LAWN',
  'OUT-FIELD',
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

export interface CameraSeed {
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

/**
 * Append only, and keep the twelve cameras of the first campus where they are: a top-up never
 * rewrites a camera that exists, so a change to one of them would split fresh and upgraded volumes.
 */
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
  // The cameras of the expanded campus. Where `TwinScene.dc.html` (`S.cams`) places one, `at` is
  // that position converted as for `ZONES`; the others are placed by the frame that shows them.
  {
    code: 'CAM-R01',
    name: 'Dormitory A lobby',
    zone: 'BLD-DORA',
    at: [0, -22.5],
    fov: { heading: 0, angle: 90, range: 30 },
  },
  {
    code: 'CAM-R02',
    name: 'Dormitory B lobby',
    zone: 'BLD-DORB',
    at: [1.5, -22.5],
    fov: { heading: 355, angle: 90, range: 30 },
  },
  {
    // Frame 15 ("On this asset"): looks along the corridor at the level 3 leak sensor.
    code: 'CAM-R05',
    name: 'Level 3 corridor',
    zone: 'BLD-DORB',
    at: [-5, -11.5],
    fov: { heading: 90, angle: 60, range: 40 },
  },
  {
    // Frame 15 shows it with "No signal"; placed by the lift.
    code: 'CAM-R06',
    name: 'Dormitory B stairwell',
    zone: 'BLD-DORB',
    at: [-20, 14],
    online: false,
    fov: { heading: 125, angle: 90, range: 30 },
  },
  {
    code: 'CAM-L03',
    name: 'Science Lab, level 2',
    zone: 'BLD-LAB',
    at: [-38, -26],
    fov: { heading: 55, angle: 90, range: 50 },
  },
  {
    // Frame 08 ("On this asset"): the east yard, pointed at the standby generator.
    code: 'CAM-D03',
    name: 'Data center east yard',
    zone: 'BLD-DC',
    at: [24, 18],
    fov: { heading: 140, angle: 90, range: 40 },
  },
  {
    code: 'CAM-C01',
    name: 'Health Clinic exterior',
    zone: 'BLD-CLINIC',
    at: [-33.5, -26],
    fov: { heading: 50, angle: 90, range: 50 },
  },
  {
    // On the zone's south edge, where TwinScene draws it beside the "Utility yard" label.
    code: 'CAM-U01',
    name: 'Utility yard',
    zone: 'UTL-PLANT',
    at: [1, -37],
    fov: { heading: 0, angle: 90, range: 40 },
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
