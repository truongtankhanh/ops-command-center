import {
  type Asset,
  type Camera,
  type CameraFieldOfView,
  type Incident,
  type IncidentSeverity,
  type IncidentType,
  type LngLat,
  severityRank,
} from '@occ/contracts';
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';
import { type AssetState, openIncidentOf } from './assets';
import { distanceM, offsetM } from './geo';
import { isActive, isKnownType } from './incidents';

/**
 * Incidents closer than this share a fan-out ring: one marker (24 px) at the map's max zoom (20),
 * where a pixel is ≈ 0.146 m at the campus latitude. Reports without a position all sit on their
 * zone's centre, so without the fan-out no zoom level would ever separate them.
 */
const GROUP_DISTANCE_M = 3.5;
/** Distance between neighbours on a fan-out ring: ≈ 30 px at zoom 20. */
const SPACING_M = 4.4;
/**
 * Assets closer than this share a ring. A marker is 8 px (≈ 1.2 m at zoom 20), so only assets that
 * would sit on top of each other are moved (`PMP-S1` and `ICS-STU` stand on the same point).
 */
const ASSET_GROUP_DISTANCE_M = 0.5;
/** Distance between neighbours on an asset ring, which is also its least radius: about 4 m. */
const ASSET_SPACING_M = 4;

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

export interface AssetProperties {
  code: string;
  name: string;
  /** The state word the Assets tab shows (`assetStates`); the marker's look follows it. */
  state: AssetState;
  /** The severity of the asset's open incident while it is a fault, else `null`. */
  severity: IncidentSeverity | null;
  /** Map image id, see `assetImageId`. */
  image: string;
}

/** No segment of a view's arc spans more than this: 18 for a 90° view, 72 for a full circle. */
const VIEW_SEGMENT_DEG = 5;

/**
 * Stands in for a type this console does not know in image ids (`incident-high-open-unknown`), so
 * the marker uses a generic image registered with the others instead of one that does not exist.
 */
export const UNKNOWN_TYPE_IMAGE = 'unknown';

/** The type part of an incident image id. */
export type MarkerType = IncidentType | typeof UNKNOWN_TYPE_IMAGE;

export const markerType = (type: MarkerType): MarkerType =>
  isKnownType(type) ? type : UNKNOWN_TYPE_IMAGE;

/** A resolved incident is drawn in a neutral form, the same for every severity. */
export const resolvedImageId = (type: MarkerType): string =>
  `incident-resolved-${markerType(type)}`;

export const incidentImageId = ({
  severity,
  status,
  type,
}: Pick<Incident, 'severity' | 'status'> & { type: MarkerType }): string =>
  status === 'resolved'
    ? resolvedImageId(type)
    : `incident-${severity}-${status}-${markerType(type)}`;

export const cameraImageId = (online: boolean): string =>
  online ? 'camera-online' : 'camera-offline';

/** How an asset marker looks: three forms, the fault one in the hue of its incident's severity. */
export type AssetLook = 'normal' | 'nodata' | 'fault';

/**
 * `fault` is a fault; `nodata` and `offline` are the list's "No data" filter and draw alike; every
 * other state, a state word that has none (`unknown`) and any state added later draw as normal, so
 * a marker never has no image.
 */
export function assetLookOf(state: AssetState): AssetLook {
  switch (state) {
    case 'fault':
      return 'fault';
    case 'nodata':
    case 'offline':
      return 'nodata';
    default:
      return 'normal';
  }
}

/**
 * A fault with no known severity draws as medium, frame 14's fault hue, rather than as a missing
 * image. `severity` is ignored for the other looks.
 */
export const assetImageId = (look: AssetLook, severity: IncidentSeverity | null): string =>
  look === 'fault' ? `asset-fault-${severity ?? 'medium'}` : `asset-${look}`;

export const CLUSTER_COUNT_PREFIX = 'cluster-count-';
/** Above this a cluster shows "9+". */
export const CLUSTER_COUNT_MAX = 9;

export const clusterCountImageId = (count: number): string =>
  `${CLUSTER_COUNT_PREFIX}${count > CLUSTER_COUNT_MAX ? `${CLUSTER_COUNT_MAX}+` : count}`;

/** The badge on a cluster's ring: its highest severity as glyph, so colour is not the only cue. */
export const clusterSeverityImageId = (severity: IncidentSeverity): string =>
  `cluster-severity-${severity}`;

/** The one rule for which incident pulses: critical and still open. The 3D beacons read it too (V2-16.2). */
export const isPulsing = (incident: Incident) =>
  incident.severity === 'critical' && incident.status === 'open';

/**
 * Spreads markers that would overlap on a ring around the first of them. `ordered` decides who is
 * first and the order round the ring (first at north, then clockwise), so the caller picks an order
 * that does not change when something else about a member does. Anything within `groupDistanceM`
 * of a group's first member joins it; a lone member keeps its position. The ring is at least
 * `spacingM` in radius and grows so that neighbours stay `spacingM` apart.
 */
function spreadOnRings<T>(
  ordered: readonly T[],
  member: { id: (item: T) => string; position: (item: T) => LngLat },
  { groupDistanceM, spacingM }: { groupDistanceM: number; spacingM: number },
): Map<string, LngLat> {
  const groups: { anchor: LngLat; members: T[] }[] = [];
  for (const item of ordered) {
    const group = groups.find((g) => distanceM(g.anchor, member.position(item)) < groupDistanceM);
    if (group) group.members.push(item);
    else groups.push({ anchor: member.position(item), members: [item] });
  }

  const positions = new Map<string, LngLat>();
  for (const { anchor, members } of groups) {
    if (members.length === 1) {
      positions.set(member.id(members[0]!), member.position(members[0]!));
      continue;
    }
    const radius = Math.max(spacingM, (members.length * spacingM) / (2 * Math.PI));
    members.forEach((item, i) => {
      const angle = (2 * Math.PI * i) / members.length;
      positions.set(
        member.id(item),
        offsetM(anchor, radius * Math.sin(angle), radius * Math.cos(angle)),
      );
    });
  }
  return positions;
}

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
  return spreadOnRings(
    ordered,
    { id: (incident) => incident.id, position: (incident) => incident.position },
    { groupDistanceM: GROUP_DISTANCE_M, spacingM: SPACING_M },
  );
}

/** Asset codes are unique, so ordering by them is a total order that no state change disturbs. */
const byCode = <T extends { code: string }>(a: T, b: T) =>
  a.code < b.code ? -1 : a.code > b.code ? 1 : 0;

/**
 * Where each asset is drawn, by asset **code**: its own position, except that assets within
 * `ASSET_GROUP_DISTANCE_M` of one another are spread on a ring of about 4 m, first by code at
 * north, then clockwise, so each stays visible and pickable. An asset outside its zone is drawn
 * where it stands; elevation plays no part in 2D.
 */
export function fanOutAssets(
  assets: readonly Pick<Asset, 'code' | 'position'>[],
): Map<string, LngLat> {
  return spreadOnRings(
    [...assets].sort(byCode),
    { id: (asset) => asset.code, position: (asset) => asset.position },
    { groupDistanceM: ASSET_GROUP_DISTANCE_M, spacingM: ASSET_SPACING_M },
  );
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
 * One point per asset, ordered by code so the same catalogue always gives the same list (the map
 * compares lists to decide whether to redraw). `states` is `assetStates`' answer; an asset it lacks
 * has `unknown` and draws as normal. The severity is the open incident's, only for a fault.
 */
export function assetFeatures(
  assets: readonly Asset[],
  states: ReadonlyMap<string, AssetState>,
  incidents: readonly Incident[],
): FeatureCollection<Point, AssetProperties> {
  const positions = fanOutAssets(assets);
  return {
    type: 'FeatureCollection',
    features: [...assets].sort(byCode).map((asset): Feature<Point, AssetProperties> => {
      const state = states.get(asset.code) ?? 'unknown';
      const severity =
        state === 'fault' ? (openIncidentOf(asset, incidents)?.severity ?? null) : null;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: positions.get(asset.code) ?? asset.position },
        properties: {
          code: asset.code,
          name: asset.name,
          state,
          severity,
          image: assetImageId(assetLookOf(state), severity),
        },
      };
    }),
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
