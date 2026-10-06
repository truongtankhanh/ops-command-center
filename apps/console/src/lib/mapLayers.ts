import { severityRank } from '@occ/contracts';
import type { FeatureCollection } from 'geojson';
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSourceSpecification,
  LayerSpecification,
  Map as MapLibreMap,
} from 'maplibre-gl';
import { mapColors } from '../styles/tokens';
import { CLUSTER_COUNT_MAX, CLUSTER_COUNT_PREFIX } from './mapFeatures';

/*
 * Sources and layers for cameras and incidents. Marker shapes come from the frames: 01 (markers,
 * cameras), 02 (selected marker), 04 (critical pulse). No layer uses `text-*`: the offline style has
 * no `glyphs`, so every label is an image (see `mapImages.ts`) or stays in the DOM.
 */

export const MAP_SOURCES = {
  cameras: 'cameras',
  incidents: 'incidents',
  selected: 'incident-selected',
} as const;

export const MAP_LAYERS = {
  cameras: 'cameras',
  pulseStatic: 'pulse-static',
  pulseWave: 'pulse-wave',
  selectedPulseStatic: 'selected-pulse-static',
  selectedPulseWave: 'selected-pulse-wave',
  clusters: 'clusters',
  clusterCount: 'cluster-count',
  incidents: 'incidents',
  selectedRing: 'selected-ring',
  selected: 'selected',
} as const;

/** Layers a click or a pointer can hit, topmost first. */
export const INTERACTIVE_LAYERS = [MAP_LAYERS.selected, MAP_LAYERS.incidents, MAP_LAYERS.clusters];

/** The animated pulse rings, one per incident source. */
export const PULSE_WAVE_LAYERS = [MAP_LAYERS.pulseWave, MAP_LAYERS.selectedPulseWave];

/** The pulse wave at rest: its form under reduced motion, and where the animation scales from. */
export const PULSE_WAVE = { radius: 12, opacity: 0.6 };

/** Clusters group markers that overlap on screen and break up before the map's max zoom (20). */
const CLUSTER_RADIUS = 24;
const CLUSTER_MAX_ZOOM = 19;

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Never hide a marker to make room for another: an incident must always be on the map. */
const ICON_PLACEMENT = { 'icon-allow-overlap': true, 'icon-ignore-placement': true } as const;

const isCluster: FilterSpecification = ['has', 'point_count'];
const isPoint: FilterSpecification = ['!', ['has', 'point_count']];
const isPulsing: FilterSpecification = ['==', ['get', 'pulse'], true];

/** The highest member severity of a cluster, as its colour; low is the fallback. */
const clusterSeverityColour: ExpressionSpecification = [
  'match',
  ['get', 'sevRank'],
  severityRank('critical'),
  mapColors.severity.critical,
  severityRank('high'),
  mapColors.severity.high,
  severityRank('medium'),
  mapColors.severity.medium,
  mapColors.severity.low,
];

const clusterCountImage: ExpressionSpecification = [
  'case',
  ['>', ['get', 'point_count'], CLUSTER_COUNT_MAX],
  `${CLUSTER_COUNT_PREFIX}${CLUSTER_COUNT_MAX}+`,
  ['concat', CLUSTER_COUNT_PREFIX, ['to-string', ['get', 'point_count']]],
];

export function cameraSource(): [id: string, source: GeoJSONSourceSpecification] {
  return [MAP_SOURCES.cameras, { type: 'geojson', data: EMPTY }];
}

export function incidentSources(): [id: string, source: GeoJSONSourceSpecification][] {
  return [
    [
      MAP_SOURCES.incidents,
      {
        type: 'geojson',
        data: EMPTY,
        cluster: true,
        clusterRadius: CLUSTER_RADIUS,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterProperties: {
          sevRank: ['max', ['get', 'sevRank']],
          pulse: ['any', ['get', 'pulse']],
        },
      },
    ],
    [MAP_SOURCES.selected, { type: 'geojson', data: EMPTY }],
  ];
}

export function cameraLayers(): LayerSpecification[] {
  return [
    {
      id: MAP_LAYERS.cameras,
      type: 'symbol',
      source: MAP_SOURCES.cameras,
      layout: { ...ICON_PLACEMENT, 'icon-image': ['get', 'image'] },
    },
  ];
}

/** In draw order, bottom first. Add after `cameraLayers()` so incidents sit above cameras. */
export function incidentLayers(): LayerSpecification[] {
  return [
    ...pulseLayers(MAP_SOURCES.incidents, MAP_LAYERS.pulseStatic, MAP_LAYERS.pulseWave),
    ...pulseLayers(
      MAP_SOURCES.selected,
      MAP_LAYERS.selectedPulseStatic,
      MAP_LAYERS.selectedPulseWave,
    ),
    {
      id: MAP_LAYERS.clusters,
      type: 'circle',
      source: MAP_SOURCES.incidents,
      filter: isCluster,
      paint: {
        'circle-radius': 14,
        'circle-color': mapColors.surface1,
        'circle-stroke-width': 2.5,
        'circle-stroke-color': clusterSeverityColour,
      },
    },
    {
      id: MAP_LAYERS.clusterCount,
      type: 'symbol',
      source: MAP_SOURCES.incidents,
      filter: isCluster,
      layout: { ...ICON_PLACEMENT, 'icon-image': clusterCountImage },
    },
    {
      id: MAP_LAYERS.incidents,
      type: 'symbol',
      source: MAP_SOURCES.incidents,
      filter: isPoint,
      layout: {
        ...ICON_PLACEMENT,
        'icon-image': ['get', 'image'],
        'symbol-sort-key': ['get', 'sortKey'],
      },
    },
    {
      id: MAP_LAYERS.selectedRing,
      type: 'circle',
      source: MAP_SOURCES.selected,
      paint: {
        'circle-radius': 16,
        'circle-opacity': 0,
        'circle-stroke-width': 2.5,
        'circle-stroke-color': mapColors.accent,
      },
    },
    {
      id: MAP_LAYERS.selected,
      type: 'symbol',
      source: MAP_SOURCES.selected,
      layout: { ...ICON_PLACEMENT, 'icon-image': ['get', 'image'] },
    },
  ];
}

/** Frame 04: a static outer ring and the wave that `mapPulse.ts` animates. Critical only. */
function pulseLayers(source: string, staticId: string, waveId: string): LayerSpecification[] {
  const ring = {
    'circle-opacity': 0,
    'circle-stroke-width': 2,
    'circle-stroke-color': mapColors.severity.critical,
  };
  return [
    {
      id: staticId,
      type: 'circle',
      source,
      filter: isPulsing,
      paint: { ...ring, 'circle-radius': 18, 'circle-stroke-opacity': 0.35 },
    },
    {
      id: waveId,
      type: 'circle',
      source,
      filter: isPulsing,
      paint: {
        ...ring,
        'circle-radius': PULSE_WAVE.radius,
        'circle-stroke-opacity': PULSE_WAVE.opacity,
      },
    },
  ];
}

/**
 * Removes layers, then sources. Does nothing once `Map.remove()` has run: it deletes the map's style,
 * after which every style call throws — and on unmount React runs a component's effect cleanups in
 * declaration order, so the cleanup that removes the map runs before the ones that added layers.
 */
export function removeLayers(
  map: MapLibreMap,
  layerIds: readonly string[],
  sourceIds: readonly string[],
): void {
  if (!map.style) return;
  for (const id of layerIds) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of sourceIds) if (map.getSource(id)) map.removeSource(id);
}
