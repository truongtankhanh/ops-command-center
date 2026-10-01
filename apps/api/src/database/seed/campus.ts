import type { IncidentSeverity, IncidentType, LngLat, ZoneKind } from '@occ/contracts';
import { offset, rectangle } from '../../common/geo';

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

interface CameraSeed {
  code: string;
  name: string;
  zone: string;
  /** [east, north] metres from the zone centre. */
  at: [number, number];
  online?: boolean;
}

export const CAMERAS: CameraSeed[] = [
  { code: 'CAM-G01', name: 'Main gate inbound', zone: 'GATE-MAIN', at: [-26, -6] },
  { code: 'CAM-G02', name: 'Main gate outbound', zone: 'GATE-MAIN', at: [26, -6] },
  { code: 'CAM-H01', name: 'Hub lobby', zone: 'BLD-HUB', at: [0, -32] },
  { code: 'CAM-H02', name: 'Hub east wing', zone: 'BLD-HUB', at: [46, 10] },
  { code: 'CAM-L01', name: 'Library entrance', zone: 'BLD-LIB', at: [0, -27] },
  { code: 'CAM-D01', name: 'Data center perimeter', zone: 'BLD-DC', at: [-32, 0] },
  {
    code: 'CAM-D02',
    name: 'Data center loading bay',
    zone: 'BLD-DC',
    at: [32, -12],
    online: false,
  },
  { code: 'CAM-A01', name: 'Lecture hall foyer', zone: 'BLD-LHA', at: [0, -22] },
  { code: 'CAM-S01', name: 'Student center plaza', zone: 'BLD-STU', at: [-38, 0] },
  { code: 'CAM-P01', name: 'West parking entry', zone: 'PRK-WEST', at: [46, 20] },
  { code: 'CAM-P02', name: 'West parking rows', zone: 'PRK-WEST', at: [-30, -36] },
  { code: 'CAM-F01', name: 'Sports field north', zone: 'OUT-FIELD', at: [-62, 0] },
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
