import type { Camera, Incident, Zone } from '@occ/contracts';
import type { FeatureCollection, Point } from 'geojson';
import maplibregl, {
  type GeoJSONSource,
  type LngLatBoundsLike,
  type MapGeoJSONFeature,
  type MapMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCameras, useIncidents, useZones } from '../api/queries';
import { cameraFeatures, incidentFeatures } from '../lib/mapFeatures';
import { addClusterCountImage, registerMapImages } from '../lib/mapImages';
import {
  cameraLayers,
  cameraSource,
  incidentLayers,
  incidentSources,
  INTERACTIVE_LAYERS,
  MAP_LAYERS,
  MAP_SOURCES,
  removeLayers,
} from '../lib/mapLayers';
import { startPulse } from '../lib/mapPulse';
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';
import { useConsole } from '../store';
import { mapColors, mapMotion } from '../styles/tokens';
import styles from './CampusMap.module.css';

/**
 * The campus as a site plan. Works fully offline (on-prem): zones are drawn from API data.
 * Set VITE_MAP_STYLE_URL to put a basemap underneath when one is available.
 */
const OFFLINE_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'ground', type: 'background', paint: { 'background-color': mapColors.ground } }],
};

/** Past this the offline plan shows nothing more; the fan-out in `lib/mapFeatures` is sized for it. */
const MAX_ZOOM = 20;

/**
 * Incidents and cameras are map layers, not DOM markers, so they are not in the Tab order: the
 * incident feed is the keyboard and screen-reader route to every incident the map draws.
 */
export function CampusMap() {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const { data: zones } = useZones();
  const { data: cameras } = useCameras();
  const { data: incidents } = useIncidents();
  const selectedId = useConsole((s) => s.selectedIncidentId);
  /** What the view should centre on; read by the resize observer as well. */
  const focusRef = useRef<[number, number] | null>(null);

  // Create the map once.
  useEffect(() => {
    if (!container.current) return;
    const instance = new maplibregl.Map({
      container: container.current,
      style: import.meta.env.VITE_MAP_STYLE_URL ?? OFFLINE_STYLE,
      center: [108.4415, 11.953],
      zoom: 16.4,
      maxZoom: MAX_ZOOM,
      attributionControl: false,
      dragRotate: false,
    });
    const loading = new AbortController();
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    instance.on('styleimagemissing', (event) => addClusterCountImage(instance, event.id));
    // Layers are added once the marker images exist: an image registered after its layer would be
    // missing from the tiles already laid out.
    instance.on('load', () => {
      registerMapImages(instance, loading.signal).then(
        () => {
          if (!loading.signal.aborted) setMap(instance);
        },
        (error: unknown) => console.error('Map images failed to load', error),
      );
    });

    // The map shares its column with the camera strip; keep the canvas in step with the layout.
    const observer = new ResizeObserver(() => {
      instance.resize();
      focus(instance, focusRef.current, 0);
    });
    observer.observe(container.current);
    return () => {
      loading.abort();
      observer.disconnect();
      instance.remove();
    };
  }, []);

  useZoneLayer(map, zones);
  useCameraLayer(map, cameras);
  useIncidentLayers(map, incidents, selectedId);

  // Bring the selected incident into view; show the whole campus when nothing is selected.
  const selected = incidents?.find((i) => i.id === selectedId);
  const selectedPosition = selected?.position.join(',');
  useEffect(() => {
    focusRef.current = selectedPosition
      ? (selectedPosition.split(',').map(Number) as [number, number])
      : null;
    if (map) focus(map, focusRef.current, 600);
  }, [map, selectedPosition]);

  return (
    <section className={styles.map} aria-label="Campus map">
      <div ref={container} className={styles.canvas} />
      <div className={styles.legend} aria-hidden>
        <span>
          <i className={`${styles.legendSwatch} ${styles.swatchOpen}`} /> Open
        </span>
        <span>
          <i className={`${styles.legendSwatch} ${styles.swatchHandled}`} /> Being handled
        </span>
        <span>
          <i className={styles.cameraMarker} /> Camera
        </span>
      </div>
    </section>
  );
}

const campusBounds = new WeakMap<maplibregl.Map, maplibregl.LngLatBounds>();

function fitCampus(map: maplibregl.Map, duration = 0) {
  const bounds = campusBounds.get(map);
  if (bounds) map.fitBounds(bounds as LngLatBoundsLike, { padding: 48, duration });
}

/** Centre on a point, or show the whole campus when there is none. */
function focus(map: maplibregl.Map, point: [number, number] | null, duration: number) {
  if (point) map.easeTo({ center: point, duration });
  else fitCampus(map, duration);
}

function useZoneLayer(map: maplibregl.Map | null, zones: Zone[] | undefined) {
  useEffect(() => {
    if (!map || !zones?.length) return;

    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: zones.map((zone) => ({
        type: 'Feature',
        properties: { kind: zone.kind },
        geometry: { type: 'Polygon', coordinates: [zone.polygon] },
      })),
    };
    // Zones can arrive after the camera and incident layers exist; keep them underneath.
    const below = map.getLayer(MAP_LAYERS.cameras) ? MAP_LAYERS.cameras : undefined;
    map.addSource('zones', { type: 'geojson', data });
    map.addLayer(
      {
        id: 'zone-fill',
        type: 'fill',
        source: 'zones',
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
      below,
    );
    map.addLayer(
      {
        id: 'zone-outline',
        type: 'line',
        source: 'zones',
        paint: { 'line-color': mapColors.zoneOutline, 'line-width': 1.2 },
      },
      below,
    );

    const labels = zones.map((zone) => {
      const el = document.createElement('div');
      el.className = styles.zoneLabel!;
      el.textContent = zone.name;
      // Label sits just above the zone's top edge, clear of the markers inside it.
      const top = Math.max(...zone.polygon.map(([, lat]) => lat));
      return new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([zone.center[0], top])
        .setOffset([0, -2])
        .addTo(map);
    });

    const bounds = new maplibregl.LngLatBounds();
    zones.flatMap((z) => z.polygon).forEach((point) => bounds.extend(point));
    campusBounds.set(map, bounds);
    fitCampus(map);

    return () => {
      labels.forEach((label) => label.remove());
      if (map.getLayer('zone-outline')) map.removeLayer('zone-outline');
      if (map.getLayer('zone-fill')) map.removeLayer('zone-fill');
      if (map.getSource('zones')) map.removeSource('zones');
    };
  }, [map, zones]);
}

/** Added once per map; a camera list change only replaces the source data. */
function useCameraLayer(map: maplibregl.Map | null, cameras: Camera[] | undefined) {
  useEffect(() => {
    if (!map) return;
    const [sourceId, source] = cameraSource();
    const layers = cameraLayers();
    map.addSource(sourceId, source);
    layers.forEach((layer) => map.addLayer(layer));
    return () =>
      removeLayers(
        map,
        layers.map((layer) => layer.id),
        [sourceId],
      );
  }, [map]);

  useEffect(() => {
    if (!map || !cameras) return;
    map.getSource<GeoJSONSource>(MAP_SOURCES.cameras)?.setData(cameraFeatures(cameras));
  }, [map, cameras]);
}

/**
 * Active incidents, plus the selected one even if it is resolved. Sources, layers, handlers and the
 * selected code tag are created once per map; an incident event or a selection change only
 * replaces the source data and moves the tag.
 */
function useIncidentLayers(
  map: maplibregl.Map | null,
  incidents: Incident[] | undefined,
  selectedId: string | null,
) {
  const codeTag = useRef<maplibregl.Marker | null>(null);
  const features = useMemo(
    () => (incidents ? incidentFeatures(incidents, selectedId) : null),
    [incidents, selectedId],
  );
  const pulsing = features?.pulsing ?? false;
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!map) return;
    const sources = incidentSources();
    const layers = incidentLayers();
    sources.forEach(([id, source]) => map.addSource(id, source));
    layers.forEach((layer) => map.addLayer(layer));

    // Frame 02's code tag. Map text needs glyphs the offline style does not have, so it is DOM.
    const tagElement = document.createElement('div');
    tagElement.className = styles.codeTag!;
    tagElement.setAttribute('aria-hidden', 'true');
    const tag = new maplibregl.Marker({ element: tagElement, anchor: 'left', offset: [20, 0] });
    codeTag.current = tag;

    // One handler for every layer: the topmost feature wins, so a marker drawn over another never
    // toggles the selection twice.
    const onClick = (event: MapMouseEvent) => {
      const [hit] = map.queryRenderedFeatures(event.point, { layers: INTERACTIVE_LAYERS });
      if (!hit) return;
      if (hit.layer.id === MAP_LAYERS.clusters) {
        expandCluster(map, hit);
        return;
      }
      const id = String(hit.properties.id);
      const { select, selectedIncidentId } = useConsole.getState();
      select(id === selectedIncidentId ? null : id);
    };
    const onMove = (event: MapMouseEvent) => {
      const over = map.queryRenderedFeatures(event.point, { layers: INTERACTIVE_LAYERS });
      map.getCanvas().style.cursor = over.length ? 'pointer' : '';
    };
    map.on('click', onClick);
    map.on('mousemove', onMove);

    return () => {
      map.off('click', onClick);
      map.off('mousemove', onMove);
      tag.remove();
      codeTag.current = null;
      removeLayers(
        map,
        layers.map((layer) => layer.id),
        sources.map(([id]) => id),
      );
    };
  }, [map]);

  useEffect(() => {
    if (!map || !features) return;
    map.getSource<GeoJSONSource>(MAP_SOURCES.incidents)?.setData(features.rest);
    map.getSource<GeoJSONSource>(MAP_SOURCES.selected)?.setData(features.selected);

    const tag = codeTag.current;
    if (!tag) return;
    const [selected] = features.selected.features;
    if (!selected) {
      tag.remove();
      return;
    }
    tag.getElement().textContent = selected.properties.code;
    tag.setLngLat(selected.geometry.coordinates as [number, number]);
    if (!tag.getElement().isConnected) tag.addTo(map);
  }, [map, features]);

  // The wave repaints the map every frame, so it runs only while something pulses.
  useEffect(() => {
    if (!map || !pulsing || reducedMotion) return;
    return startPulse(map, mapMotion.pulseMs);
  }, [map, pulsing, reducedMotion]);
}

/** Zooms to where a cluster breaks up. */
function expandCluster(map: maplibregl.Map, cluster: MapGeoJSONFeature) {
  const center = (cluster.geometry as Point).coordinates as [number, number];
  map
    .getSource<GeoJSONSource>(MAP_SOURCES.incidents)
    ?.getClusterExpansionZoom(Number(cluster.properties.cluster_id))
    .then(
      (zoom) => map.easeTo({ center, zoom }),
      // A live update can replace the cluster before the answer arrives; the click then does nothing.
      () => undefined,
    );
}
