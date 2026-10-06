import { INCIDENT_SEVERITIES, type IncidentSeverity, type LngLat } from '@occ/contracts';
import type { Geometry } from 'geojson';
import { INTERACTIVE_LAYERS, MAP_LAYERS } from './mapLayers';

/** What the pointer is over, and where the tooltip anchors: the drawn marker, not the cursor. */
export type HoverTarget =
  | { kind: 'incident'; id: string; lngLat: LngLat }
  | { kind: 'camera'; id: string; lngLat: LngLat }
  | {
      kind: 'cluster';
      clusterId: number;
      count: number;
      severity: IncidentSeverity;
      lngLat: LngLat;
    };

const INCIDENT_LAYERS: readonly string[] = [MAP_LAYERS.incidents, MAP_LAYERS.selected];

/**
 * Reads a feature MapLibre reports under the pointer. Rendered feature properties are untyped and
 * a cluster's are MapLibre's own, so anything that is not the expected shape gives `null` — no
 * tooltip — instead of a half-filled one.
 */
export function hoverTargetOf(
  layerId: string,
  properties: Record<string, unknown> | null | undefined,
  geometry: Geometry | null | undefined,
): HoverTarget | null {
  if (geometry?.type !== 'Point') return null;
  const [lng, lat] = geometry.coordinates;
  if (lng === undefined || lat === undefined) return null;
  const lngLat: LngLat = [lng, lat];

  if (INCIDENT_LAYERS.includes(layerId) || layerId === MAP_LAYERS.cameras) {
    const id = properties?.id;
    if (typeof id !== 'string') return null;
    return { kind: layerId === MAP_LAYERS.cameras ? 'camera' : 'incident', id, lngLat };
  }

  if (layerId === MAP_LAYERS.clusters) {
    const { cluster_id: clusterId, point_count: count, sevRank } = properties ?? {};
    if (typeof clusterId !== 'number' || typeof count !== 'number' || typeof sevRank !== 'number')
      return null;
    const severity = INCIDENT_SEVERITIES[sevRank];
    return severity ? { kind: 'cluster', clusterId, count, severity, lngLat } : null;
  }

  return null;
}

/**
 * The same tooltip subject. A cluster is the same while its id and size hold; a live update that
 * regroups the incidents gives it a new id.
 */
export function sameTarget(a: HoverTarget | null, b: HoverTarget | null): boolean {
  if (a === null || b === null) return a === b;
  switch (a.kind) {
    case 'incident':
    case 'camera':
      return b.kind === a.kind && b.id === a.id;
    case 'cluster':
      return b.kind === 'cluster' && b.clusterId === a.clusterId && b.count === a.count;
  }
}

/** Whether a click on this layer does something, so the pointer should say so. */
export const isClickable = (layerId: string): boolean =>
  (INTERACTIVE_LAYERS as readonly string[]).includes(layerId);
