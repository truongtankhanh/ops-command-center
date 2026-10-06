import { severityRank, type Zone } from '@occ/contracts';
import type { FeatureCollection } from 'geojson';
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSourceSpecification,
  LayerSpecification,
  Map as MapLibreMap,
} from 'maplibre-gl';
import { mapColors } from '../styles/tokens';
import { metresToPixels } from './geo';
import { CLUSTER_COUNT_MAX, CLUSTER_COUNT_PREFIX } from './mapFeatures';
import { CAMPUS_CENTER, type SitePart, siteFeatures, zoneFeatures } from './sitePlan';

/*
 * Sources and layers for the site plan, zones, cameras and incidents. Shapes come from the frames:
 * 01 (site plan, markers, cameras), 02 (selected marker), 03 (highlighted zone), 04 (critical
 * pulse). No layer uses `text-*`: the offline style has no `glyphs`, so every label is an image
 * (see `mapImages.ts`) or stays in the DOM.
 */

export const MAP_SOURCES = {
  site: 'site',
  zones: 'zones',
  cameras: 'cameras',
  incidents: 'incidents',
  selected: 'incident-selected',
} as const;

export const MAP_LAYERS = {
  boundaryFill: 'boundary-fill',
  boundaryLine: 'boundary-line',
  roads: 'roads',
  field: 'field',
  parkingRows: 'parking-rows',
  zoneFill: 'zone-fill',
  footprints: 'footprints',
  zoneOutline: 'zone-outline',
  zoneHighlight: 'zone-highlight',
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

/** Layers a click can hit, topmost first. */
export const INTERACTIVE_LAYERS = [MAP_LAYERS.selected, MAP_LAYERS.incidents, MAP_LAYERS.clusters];

/** Layers that show a tooltip under the pointer, topmost first. Cameras do nothing on click yet. */
export const HOVER_LAYERS = [...INTERACTIVE_LAYERS, MAP_LAYERS.cameras];

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

/** Roads are 9 m wide in frame 01, at every zoom. */
const ROAD_WIDTH_M = 9;
/** Zooms between which a metric width is interpolated; exponential base 2 keeps it exact. */
const METRIC_ZOOMS = [10, 20] as const;

const isPart = (part: SitePart): FilterSpecification => ['==', ['get', 'part'], part];

/** A `line-width` that stays `metres` wide on the ground as the map zooms. */
function metricWidth(metres: number): ExpressionSpecification {
  const [low, high] = METRIC_ZOOMS;
  const [, lat] = CAMPUS_CENTER;
  return [
    'interpolate',
    ['exponential', 2],
    ['zoom'],
    low,
    metresToPixels(metres, low, lat),
    high,
    metresToPixels(metres, high, lat),
  ];
}

/** Outlines the zone with this id; `null` outlines none. */
export const zoneHighlightFilter = (zoneId: string | null): FilterSpecification =>
  zoneId === null ? false : ['==', ['get', 'id'], zoneId];

export function siteSources(
  zones: readonly Zone[],
): [id: string, source: GeoJSONSourceSpecification][] {
  return [
    [MAP_SOURCES.site, { type: 'geojson', data: siteFeatures(zones) }],
    [MAP_SOURCES.zones, { type: 'geojson', data: zoneFeatures(zones) }],
  ];
}

/** The ground, in draw order, bottom first. Insert below the camera layer. */
export function siteLayers(): LayerSpecification[] {
  return [
    {
      id: MAP_LAYERS.boundaryFill,
      type: 'fill',
      source: MAP_SOURCES.site,
      filter: isPart('boundary'),
      paint: { 'fill-color': mapColors.site.boundaryFill },
    },
    {
      id: MAP_LAYERS.boundaryLine,
      type: 'line',
      source: MAP_SOURCES.site,
      filter: isPart('boundary'),
      paint: {
        'line-color': mapColors.site.boundaryLine,
        'line-width': 1.2,
        'line-dasharray': [5, 3.5],
      },
    },
    {
      id: MAP_LAYERS.roads,
      type: 'line',
      source: MAP_SOURCES.site,
      filter: isPart('road'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': mapColors.site.road, 'line-width': metricWidth(ROAD_WIDTH_M) },
    },
    {
      id: MAP_LAYERS.field,
      type: 'line',
      source: MAP_SOURCES.site,
      filter: isPart('field'),
      paint: { 'line-color': mapColors.site.fieldLine, 'line-width': 1 },
    },
    {
      id: MAP_LAYERS.parkingRows,
      type: 'line',
      source: MAP_SOURCES.site,
      filter: isPart('parking-row'),
      paint: {
        'line-color': mapColors.site.parkingLine,
        'line-width': 1,
        'line-dasharray': [2, 3],
      },
    },
    {
      id: MAP_LAYERS.zoneFill,
      type: 'fill',
      source: MAP_SOURCES.zones,
      paint: {
        'fill-color': [
          'match',
          ['get', 'kind'],
          'building',
          mapColors.zoneFill.building,
          'parking',
          mapColors.zoneFill.parking,
          'gate',
          mapColors.zoneFill.gate,
          mapColors.zoneFill.outdoor,
        ],
      },
    },
    {
      id: MAP_LAYERS.footprints,
      type: 'fill',
      source: MAP_SOURCES.site,
      filter: isPart('footprint'),
      paint: { 'fill-color': mapColors.site.footprint },
    },
    {
      id: MAP_LAYERS.zoneOutline,
      type: 'line',
      source: MAP_SOURCES.zones,
      paint: { 'line-color': mapColors.zoneOutline, 'line-width': 1.1 },
    },
    {
      id: MAP_LAYERS.zoneHighlight,
      type: 'line',
      source: MAP_SOURCES.zones,
      filter: zoneHighlightFilter(null),
      paint: { 'line-color': mapColors.accent, 'line-width': 2 },
    },
  ];
}

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
