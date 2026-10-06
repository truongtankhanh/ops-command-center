import {
  type Camera,
  type Incident,
  type IncidentType,
  type LngLat,
  severityRank,
} from '@occ/contracts';
import type { Feature, FeatureCollection, Point } from 'geojson';
import { isActive } from './incidents';

/**
 * Incidents closer than this share a fan-out ring: one marker (24 px) at the map's max zoom (20),
 * where a pixel is ≈ 0.146 m at the campus latitude. Reports without a position all sit on their
 * zone's centre, so without the fan-out no zoom level would ever separate them.
 */
const GROUP_DISTANCE_M = 3.5;
/** Distance between neighbours on a fan-out ring: ≈ 30 px at zoom 20. */
const SPACING_M = 4.4;
const METRES_PER_DEGREE = 111_320;

export interface IncidentProperties {
  id: string;
  code: string;
  /** Map image id, see `incidentImageId`. */
  image: string;
  /** `severityRank`: 0 low … 3 critical. Clusters keep the highest. */
  sevRank: number;
  /** Draw order inside a layer: higher severity on top, open above acknowledged. */
  sortKey: number;
  /** Open and critical. Clusters pulse when any member does. */
  pulse: boolean;
}

export interface CameraProperties {
  id: string;
  image: string;
}

/** A resolved incident is drawn in a neutral form, the same for every severity. */
export const resolvedImageId = (type: IncidentType): string => `incident-resolved-${type}`;

export const incidentImageId = ({
  severity,
  status,
  type,
}: Pick<Incident, 'severity' | 'status' | 'type'>): string =>
  status === 'resolved' ? resolvedImageId(type) : `incident-${severity}-${status}-${type}`;

export const cameraImageId = (online: boolean): string =>
  online ? 'camera-online' : 'camera-offline';

export const CLUSTER_COUNT_PREFIX = 'cluster-count-';
/** Above this a cluster shows "9+". */
export const CLUSTER_COUNT_MAX = 9;

export const clusterCountImageId = (count: number): string =>
  `${CLUSTER_COUNT_PREFIX}${count > CLUSTER_COUNT_MAX ? `${CLUSTER_COUNT_MAX}+` : count}`;

const isPulsing = (incident: Incident) =>
  incident.severity === 'critical' && incident.status === 'open';

/**
 * Where each incident is drawn. Incidents within `GROUP_DISTANCE_M` of a group's first member are
 * spread on a ring around it, first at north, then clockwise; a lone incident keeps its position.
 *
 * Groups and ring order follow report time, not `compareIncidents`: that order changes when an
 * incident is acknowledged, which would make its neighbours swap places on the map.
 */
export function fanOut(incidents: readonly Incident[]): Map<string, LngLat> {
  const ordered = [...incidents].sort(
    (a, b) =>
      Date.parse(a.reportedAt) - Date.parse(b.reportedAt) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const groups: { anchor: LngLat; members: Incident[] }[] = [];
  for (const incident of ordered) {
    const group = groups.find((g) => distanceM(g.anchor, incident.position) < GROUP_DISTANCE_M);
    if (group) group.members.push(incident);
    else groups.push({ anchor: incident.position, members: [incident] });
  }

  const positions = new Map<string, LngLat>();
  for (const { anchor, members } of groups) {
    if (members.length === 1) {
      positions.set(members[0]!.id, members[0]!.position);
      continue;
    }
    const radius = Math.max(SPACING_M, (members.length * SPACING_M) / (2 * Math.PI));
    members.forEach((incident, i) => {
      const angle = (2 * Math.PI * i) / members.length;
      positions.set(
        incident.id,
        offsetM(anchor, radius * Math.sin(angle), radius * Math.cos(angle)),
      );
    });
  }
  return positions;
}

/**
 * The incidents the map draws — active ones, plus the selected one even when resolved — split into
 * the clustered set and the selected one, which never joins a cluster.
 */
export function incidentFeatures(
  incidents: readonly Incident[],
  selectedId: string | null,
): {
  rest: FeatureCollection<Point, IncidentProperties>;
  selected: FeatureCollection<Point, IncidentProperties>;
  /** Any drawn incident pulses: the pulse animation only runs while this holds. */
  pulsing: boolean;
} {
  const drawn = incidents.filter((incident) => isActive(incident) || incident.id === selectedId);
  const positions = fanOut(drawn);
  const rest: Feature<Point, IncidentProperties>[] = [];
  const selected: Feature<Point, IncidentProperties>[] = [];

  for (const incident of drawn) {
    const sevRank = severityRank(incident.severity);
    const feature: Feature<Point, IncidentProperties> = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: positions.get(incident.id) ?? incident.position },
      properties: {
        id: incident.id,
        code: incident.code,
        image: incidentImageId(incident),
        sevRank,
        sortKey: sevRank * 2 + (incident.status === 'open' ? 1 : 0),
        pulse: isPulsing(incident),
      },
    };
    (incident.id === selectedId ? selected : rest).push(feature);
  }

  return {
    rest: { type: 'FeatureCollection', features: rest },
    selected: { type: 'FeatureCollection', features: selected },
    pulsing: drawn.some(isPulsing),
  };
}

export function cameraFeatures(
  cameras: readonly Camera[],
): FeatureCollection<Point, CameraProperties> {
  return {
    type: 'FeatureCollection',
    features: cameras.map((camera) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: camera.position },
      properties: { id: camera.id, image: cameraImageId(camera.online) },
    })),
  };
}

/** Equirectangular distance — exact enough over a few metres. */
function distanceM([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const east = (lng2 - lng1) * METRES_PER_DEGREE * Math.cos(toRadians((lat1 + lat2) / 2));
  const north = (lat2 - lat1) * METRES_PER_DEGREE;
  return Math.hypot(east, north);
}

function offsetM([lng, lat]: LngLat, eastM: number, northM: number): LngLat {
  return [
    lng + eastM / (METRES_PER_DEGREE * Math.cos(toRadians(lat))),
    lat + northM / METRES_PER_DEGREE,
  ];
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
