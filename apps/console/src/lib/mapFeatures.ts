import {
  type Camera,
  type CameraFieldOfView,
  type Incident,
  type IncidentType,
  type LngLat,
  severityRank,
} from '@occ/contracts';
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';
import { distanceM, offsetM } from './geo';
import { isActive } from './incidents';

/**
 * Incidents closer than this share a fan-out ring: one marker (24 px) at the map's max zoom (20),
 * where a pixel is ≈ 0.146 m at the campus latitude. Reports without a position all sit on their
 * zone's centre, so without the fan-out no zoom level would ever separate them.
 */
const GROUP_DISTANCE_M = 3.5;
/** Distance between neighbours on a fan-out ring: ≈ 30 px at zoom 20. */
const SPACING_M = 4.4;

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

export interface CameraViewProperties {
  id: string;
  /** An offline camera's view is drawn muted. */
  online: boolean;
}

/** No segment of a view's arc spans more than this: 18 for a 90° view, 72 for a full circle. */
const VIEW_SEGMENT_DEG = 5;

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

/**
 * What each camera sees: a circular sector from its position (ADR-0017). A camera whose orientation
 * is not known gets none. An API replica from before IMP-24 omits `fieldOfView` altogether, which
 * the contract type does not model, so a missing field counts as unknown too.
 */
export function cameraViewFeatures(
  cameras: readonly Camera[],
): FeatureCollection<Polygon, CameraViewProperties> {
  const features: Feature<Polygon, CameraViewProperties>[] = [];
  for (const camera of cameras) {
    const view = camera.fieldOfView ?? null;
    if (view === null) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [viewRing(camera.position, view)] },
      properties: { id: camera.id, online: camera.online },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * A closed ring: the apex, then the arc clockwise from `heading − angle / 2` (bearings clockwise
 * from north, as in `fanOut`), back to the apex. A 360° view is the arc alone.
 */
function viewRing(apex: LngLat, { heading, angle, range }: CameraFieldOfView): LngLat[] {
  const sweep = Math.min(angle, 360);
  // At least one segment, so a degenerate angle still yields a ring rather than NaN coordinates.
  const segments = Math.max(1, Math.ceil(sweep / VIEW_SEGMENT_DEG));
  const start = heading - sweep / 2;
  const arc = Array.from({ length: segments + 1 }, (_, i): LngLat => {
    const bearing = ((start + (sweep * i) / segments) * Math.PI) / 180;
    return offsetM(apex, range * Math.sin(bearing), range * Math.cos(bearing));
  });
  // The arc's last point equals its first only up to rounding; a ring must close exactly.
  return sweep < 360 ? [apex, ...arc, apex] : [...arc.slice(0, -1), arc[0]!];
}
