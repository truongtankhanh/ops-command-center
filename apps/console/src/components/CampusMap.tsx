import type { Camera, Incident, LngLat, SitePlan, Zone } from '@occ/contracts';
import type { Point } from 'geojson';
import maplibregl, {
  type GeoJSONSource,
  type MapGeoJSONFeature,
  type MapMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { useCameras, useIncidents, useSitePlan, useZones } from '../api/queries';
import { cameraFeatures, cameraViewFeatures, incidentFeatures } from '../lib/mapFeatures';
import { addClusterCountImage, registerMapImages } from '../lib/mapImages';
import {
  cameraLayers,
  cameraSource,
  cameraViewLayers,
  cameraViewSource,
  groundLayers,
  incidentLayers,
  incidentSources,
  INTERACTIVE_LAYERS,
  MAP_LAYERS,
  MAP_SOURCES,
  removeLayers,
  siteSources,
  zoneHighlightFilter,
  zoneOverlayLayers,
} from '../lib/mapLayers';
import { startPulse } from '../lib/mapPulse';
import { siteBounds } from '../lib/sitePlan';
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';
import { useConsole } from '../store';
import { mapColors, mapMotion } from '../styles/tokens';
import styles from './CampusMap.module.css';
import { MapControls } from './MapControls';
import { MapLegend } from './MapLegend';
import { MapTooltip } from './MapTooltip';

/**
 * The campus as a site plan. Works fully offline (on-prem): the site plan and zones come from the
 * API (same origin), with no tile server. Set VITE_MAP_STYLE_URL to put a basemap underneath when
 * one is available.
 */
const OFFLINE_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'ground', type: 'background', paint: { 'background-color': mapColors.ground } }],
};

/** Past this the offline plan shows nothing more; the fan-out in `lib/mapFeatures` is sized for it. */
const MAX_ZOOM = 20;
/** About 1.4 zoom levels out from the fitted campus (≈ 16.4): the plan stays recognisable. */
const MIN_ZOOM = 15;
/** `easeTo` / `fitBounds` duration when the view follows a selection or the Fit campus button. */
const FOCUS_MS = 600;

/**
 * Incidents and cameras are map layers, not DOM markers, so they are not in the Tab order: the
 * incident feed is the keyboard and screen-reader route to every incident the map draws.
 */
export function CampusMap() {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const { data: zones } = useZones();
  const { data: sitePlan } = useSitePlan();
  const { data: cameras } = useCameras();
  const { data: incidents } = useIncidents();
  const selectedId = useConsole((s) => s.selectedIncidentId);
  /** What the view should centre on; read by the resize observer as well. */
  const focusRef = useRef<[number, number] | null>(null);

  // Create the map once.
  useEffect(() => {
    if (!container.current) return;
    // No `center`: where the site is comes from data, and `useSiteLayers` frames it on arrival.
    const instance = new maplibregl.Map({
      container: container.current,
      style: import.meta.env.VITE_MAP_STYLE_URL ?? OFFLINE_STYLE,
      zoom: 16.4,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      attributionControl: false,
      dragRotate: false,
    });
    const loading = new AbortController();
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

  useSiteLayers(map, zones, sitePlan, focusRef);
  useCameraLayer(map, cameras);
  useIncidentLayers(map, incidents, selectedId);

  // Bring the selected incident into view; show the whole campus when nothing is selected.
  const selected = incidents?.find((i) => i.id === selectedId);
  const selectedPosition = selected?.position.join(',');
  useEffect(() => {
    focusRef.current = selectedPosition
      ? (selectedPosition.split(',').map(Number) as [number, number])
      : null;
    if (map) focus(map, focusRef.current, FOCUS_MS);
  }, [map, selectedPosition]);

  // Frame 03's outline on the selected incident's zone. The layer is re-added with the zones and
  // the site plan, so this also runs when either (re)arrives.
  const selectedZoneId = selected?.zoneId ?? null;
  useEffect(() => {
    if (map?.getLayer(MAP_LAYERS.zoneHighlight)) {
      map.setFilter(MAP_LAYERS.zoneHighlight, zoneHighlightFilter(selectedZoneId));
    }
  }, [map, zones, sitePlan, selectedZoneId]);

  return (
    <section className={styles.map} aria-label="Campus map">
      <div ref={container} className={styles.canvas} />
      <MapTooltip map={map} />
      <MapLegend />
      <MapControls map={map} onFit={() => map && fitCampus(map, FOCUS_MS)} />
    </section>
  );
}

const campusBounds = new WeakMap<maplibregl.Map, [LngLat, LngLat]>();

function fitCampus(map: maplibregl.Map, duration = 0) {
  const bounds = campusBounds.get(map);
  if (bounds) map.fitBounds(bounds, { padding: 48, duration });
}

/** Centre on a point, or show the whole campus when there is none. */
function focus(map: maplibregl.Map, point: [number, number] | null, duration: number) {
  if (point) map.easeTo({ center: point, duration });
  else fitCampus(map, duration);
}

/**
 * The ground: site plan and zones, added together so their order is set in one place
 * (`groundLayers`, `zoneOverlayLayers`). Without zones there is no campus to draw; without a site
 * plan (none set up, an older API, or a failed request) the zones are drawn alone. Re-added when
 * either arrives: the plan comes once per session. Zone labels stay DOM markers: the offline style
 * has no glyphs for map text.
 */
function useSiteLayers(
  map: maplibregl.Map | null,
  zones: Zone[] | undefined,
  plan: SitePlan | undefined,
  focusRef: RefObject<[number, number] | null>,
) {
  useEffect(() => {
    if (!map || !zones?.length) return;

    const sources = siteSources(plan, zones);
    const ground = groundLayers((plan?.center ?? zones[0]!.center)[1]);
    const overlays = zoneOverlayLayers();
    // Zones can arrive after the camera views, cameras and incidents exist: the ground goes under
    // the views, the zone outline and highlight over them, and all of it under the camera markers.
    const groundBelow = firstLayer(map, [MAP_LAYERS.cameraViewFill, MAP_LAYERS.cameras]);
    const overlaysBelow = firstLayer(map, [MAP_LAYERS.cameras]);
    sources.forEach(([id, source]) => map.addSource(id, source));
    ground.forEach((layer) => map.addLayer(layer, groundBelow));
    overlays.forEach((layer) => map.addLayer(layer, overlaysBelow));
    const layers = [...ground, ...overlays];

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

    const bounds = siteBounds(plan, zones);
    if (bounds) campusBounds.set(map, bounds);
    // A selected incident keeps the view; otherwise the campus is framed.
    focus(map, focusRef.current, 0);

    return () => {
      labels.forEach((label) => label.remove());
      removeLayers(
        map,
        layers.map((layer) => layer.id),
        sources.map(([id]) => id),
      );
    };
  }, [map, zones, plan, focusRef]);
}

/** The first of these layers the map has, to insert another below it; `undefined` adds on top. */
const firstLayer = (map: maplibregl.Map, ids: readonly string[]): string | undefined =>
  ids.find((id) => map.getLayer(id));

/**
 * Camera markers and what each camera sees, added once per map; a camera list change only replaces
 * the source data.
 */
function useCameraLayer(map: maplibregl.Map | null, cameras: Camera[] | undefined) {
  useEffect(() => {
    if (!map) return;
    const sources = [cameraViewSource(), cameraSource()];
    const views = cameraViewLayers();
    const markers = cameraLayers();
    sources.forEach(([id, source]) => map.addSource(id, source));
    // With the zones already drawn, the views go under their outlines (see `useSiteLayers`).
    const viewsBelow = firstLayer(map, [MAP_LAYERS.zoneOutline]);
    views.forEach((layer) => map.addLayer(layer, viewsBelow));
    markers.forEach((layer) => map.addLayer(layer));
    return () =>
      removeLayers(
        map,
        [...views, ...markers].map((layer) => layer.id),
        sources.map(([id]) => id),
      );
  }, [map]);

  useEffect(() => {
    if (!map || !cameras) return;
    map.getSource<GeoJSONSource>(MAP_SOURCES.cameras)?.setData(cameraFeatures(cameras));
    map.getSource<GeoJSONSource>(MAP_SOURCES.cameraViews)?.setData(cameraViewFeatures(cameras));
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
    // The pointer cursor is `MapTooltip`'s, which owns the one `mousemove` handler.
    map.on('click', onClick);

    return () => {
      map.off('click', onClick);
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
