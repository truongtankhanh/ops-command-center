import type { Camera, LngLat, SitePlan, Zone } from '@occ/contracts';
import type { Point } from 'geojson';
import maplibregl, {
  type GeoJSONSource,
  type MapGeoJSONFeature,
  type MapMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { isRateLimited } from '../api/client';
import { useCameras, useIncidents, useSitePlan, useZones } from '../api/queries';
import { zoneAt } from '../lib/geo';
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
import { Icon } from '../ui/Icon';
import { Crosshair } from '../ui/icons';
import styles from './CampusMap.module.css';
import { LoadFailed, RateLimited } from './LoadStates';
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
/** Space kept around the campus when it is framed. */
const FIT_PADDING = 48;
/** Map width the open sheet always leaves for the view on a narrow screen. */
const MIN_VISIBLE_PX = 160;

/** What the view frames: the selected incident's drawn position, and whether the sheet is open. */
interface ViewTarget {
  point: [number, number] | null;
  sheetOpen: boolean;
}

/**
 * Incidents and cameras are map layers, not DOM markers, so they are not in the Tab order: the
 * incident feed is the keyboard and screen-reader route to every incident the map draws.
 */
export function CampusMap() {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const {
    data: zones,
    error: zonesError,
    failureReason: zonesFailure,
    isPending: zonesPending,
    isFetching: zonesFetching,
    refetch: refetchZones,
  } = useZones();
  const { data: sitePlan } = useSitePlan();
  const { data: cameras } = useCameras();
  const { data: incidents } = useIncidents();
  const selectedId = useConsole((s) => s.selectedIncidentId);
  const reporting = useConsole((s) => s.reporting);
  const reportZoneId = useConsole((s) => s.reportZoneId);
  const picking = useConsole((s) => s.picking);
  const sheetOpen = selectedId !== null || reporting;
  /** What the view frames; read by `useSiteLayers` when the ground is (re)drawn. */
  const focusRef = useRef<ViewTarget>({ point: null, sheetOpen: false });

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
    // Only the canvas follows: MapLibre keeps the centre, and the view never jumps on a resize.
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current);
    return () => {
      loading.abort();
      observer.disconnect();
      instance.remove();
    };
  }, []);

  const features = useMemo(
    () => (incidents ? incidentFeatures(incidents, selectedId) : null),
    [incidents, selectedId],
  );
  useSiteLayers(map, zones, sitePlan, focusRef);
  useCameraLayer(map, cameras);
  useIncidentLayers(map, features);
  useReportPick(map, zones);

  // Bring the selected incident into view beside the sheet, at the marker as drawn (it may be fanned
  // out from its true position); show the whole campus when nothing is selected. The view moves when
  // the selection or the sheet changes, and once the selected marker is first known — not when the
  // fan-out shifts it a few metres because another incident arrived at the same spot.
  const selectedPoint = features?.selected.features[0]?.geometry.coordinates;
  const pointRef = useRef<number[] | undefined>(undefined);
  useEffect(() => {
    pointRef.current = selectedPoint;
  });
  const hasSelectedPoint = selectedPoint !== undefined;
  useEffect(() => {
    const point = pointRef.current;
    focusRef.current = {
      point: point ? [point[0]!, point[1]!] : null,
      sheetOpen,
    };
    if (map) focus(map, focusRef.current, FOCUS_MS);
  }, [map, selectedId, hasSelectedPoint, sheetOpen]);

  const selected = incidents?.find((i) => i.id === selectedId);

  // Frame 03's outline: on the zone being reported while the report form is open, else on the
  // selected incident's zone. The layer is re-added with the zones and the site plan, so this also
  // runs when either (re)arrives.
  const highlightZoneId = reporting ? reportZoneId : (selected?.zoneId ?? null);
  useEffect(() => {
    if (map?.getLayer(MAP_LAYERS.zoneHighlight)) {
      map.setFilter(MAP_LAYERS.zoneHighlight, zoneHighlightFilter(highlightZoneId));
    }
  }, [map, zones, sitePlan, highlightZoneId]);

  // A 429 being retried is not "busy": its message is shown and announced instead.
  const mapLoading = zonesPending && !isRateLimited(zonesFailure);

  return (
    <section className={styles.map} aria-label="Campus map" aria-busy={mapLoading || undefined}>
      <div ref={container} className={styles.canvas} />
      {/* The zones are the campus: without them the map is an empty ground (Q9). The site plan and
          the marker images fail quietly instead, since the zones still carry the meaning. */}
      {mapLoading ? (
        <p role="status" className={styles.hidden}>
          Loading the campus map…
        </p>
      ) : zonesPending ? (
        <RateLimited className={styles.state} />
      ) : (
        !zones && (
          <LoadFailed
            error={zonesError}
            fallback="The campus map could not be loaded."
            isFetching={zonesFetching}
            onRetry={() => void refetchZones()}
            className={styles.state}
          />
        )
      )}
      {/* Pointer-only, like the map itself: the zone select is the keyboard route to a location. */}
      {picking && (
        <div className={styles.pickHint} aria-hidden="true">
          <Icon glyph={Crosshair} size={16} />
          Click the map to place the incident · drag the pin to adjust
        </div>
      )}
      <MapTooltip map={map} />
      <MapLegend />
      <MapControls map={map} onFit={() => map && fitCampus(map, sheetOpen, FOCUS_MS)} />
    </section>
  );
}

const campusBounds = new WeakMap<maplibregl.Map, [LngLat, LngLat]>();

/**
 * How much of the map's right side the open sheet covers, in px: the stage's `--sheet-inset` (the
 * sheet's width in the current display mode, 0 where the sheet covers the whole screen), less on a
 * map too narrow to keep `MIN_VISIBLE_PX` beside it.
 */
function sheetInset(map: maplibregl.Map, sheetOpen: boolean): number {
  if (!sheetOpen) return 0;
  const container = map.getContainer();
  // Registered as a `<length>` in tokens.css, so it computes to px ("495px"), not the `calc(…)`.
  const covered = parseFloat(getComputedStyle(container).getPropertyValue('--sheet-inset')) || 0;
  return Math.min(covered, Math.max(0, container.clientWidth - MIN_VISIBLE_PX));
}

function fitCampus(map: maplibregl.Map, sheetOpen: boolean, duration = 0) {
  const bounds = campusBounds.get(map);
  if (!bounds) return;
  const right = FIT_PADDING + sheetInset(map, sheetOpen);
  map.fitBounds(bounds, {
    padding: { top: FIT_PADDING, bottom: FIT_PADDING, left: FIT_PADDING, right },
    duration,
  });
}

/**
 * Centres on a point in the part of the map the sheet leaves visible, or shows the whole campus
 * there when there is no point. An `offset`, not MapLibre's `padding`: padding stays on the map
 * and `fitBounds` would add it to its own, so the map keeps none.
 */
function focus(map: maplibregl.Map, { point, sheetOpen }: ViewTarget, duration: number) {
  if (!point) {
    fitCampus(map, sheetOpen, duration);
    return;
  }
  const inset = sheetInset(map, sheetOpen);
  map.easeTo({ center: point, offset: [-inset / 2, 0], duration });
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
  focusRef: RefObject<ViewTarget>,
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
      // Pointer-only like the map: without it MapLibre makes the label a "Map marker" button. The
      // zone names reach assistive tech through the feed, the detail and the report's zone list.
      el.setAttribute('aria-hidden', 'true');
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
  features: ReturnType<typeof incidentFeatures> | null,
) {
  const codeTag = useRef<maplibregl.Marker | null>(null);
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
      // While picking, a click places the report's pin (`useReportPick`) and selects nothing.
      if (useConsole.getState().picking) return;
      const [hit] = map.queryRenderedFeatures(event.point, { layers: INTERACTIVE_LAYERS });
      if (!hit) return;
      if (hit.layer.id === MAP_LAYERS.clusters) {
        expandCluster(map, hit);
        return;
      }
      const id = String(hit.properties.id);
      // A camera opens the viewer and leaves the selected incident as it is (UI-13).
      if (hit.layer.id === MAP_LAYERS.cameras) {
        useConsole.getState().openViewer(id);
        return;
      }
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

/**
 * Frame 03's pin, drawn by `.reportPin`: a teardrop in the accent with its tip on the point, a dark
 * centre and a ground shadow. A constant: nothing user-supplied is ever put into this markup.
 */
const PIN_SVG = `<svg viewBox="-12 -31 24 34" width="24" height="34" aria-hidden="true">
  <ellipse class="${styles.pinShadow}" cx="0" cy="0" rx="7" ry="2.5"/>
  <path class="${styles.pinBody}" d="M0 0 C-3 -7 -10 -11 -10 -19 A10 10 0 1 1 10 -19 C10 -11 3 -7 0 0 Z"/>
  <circle class="${styles.pinDot}" cx="0" cy="-19" r="4"/>
</svg>`;
/** The drawing reaches 3 px below the tip (the shadow); the marker is anchored at its bottom. */
const PIN_TIP_OFFSET: [number, number] = [0, 3];

/**
 * Picking the report's location on the map (frame 03). While "Pick on map" is on, a click inside a
 * zone places the pin there and selects that zone; a click outside every zone places nothing. The
 * pin is a DOM marker, so MapLibre drags it (mouse and touch); a drop in another zone selects that
 * zone, a drop outside every zone puts the pin back. Zones are found by the API's own rule
 * (`zoneAt`), so a placed pin is never refused for lying outside its zone.
 *
 * The marker exists only while there is a pin. Pointer-only: the zone select is the keyboard route,
 * and a report without a pin goes to the zone's centre.
 */
function useReportPick(map: maplibregl.Map | null, zones: Zone[] | undefined) {
  const picking = useConsole((s) => s.picking);
  const position = useConsole((s) => s.reportPosition);
  const hasPin = position !== null;
  const pin = useRef<maplibregl.Marker | null>(null);
  // Read by the handlers added once per map or per pin, so they see the zones as they are now.
  const zonesRef = useRef(zones);
  useEffect(() => {
    zonesRef.current = zones;
  });

  useEffect(() => {
    if (!map) return;
    const onClick = (event: MapMouseEvent) => {
      if (!useConsole.getState().picking) return;
      placePinAt([event.lngLat.lng, event.lngLat.lat], zonesRef.current);
    };
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [map]);

  // `MapTooltip` leaves the cursor alone while picking.
  useEffect(() => {
    if (map) map.getCanvas().style.cursor = picking ? 'crosshair' : '';
  }, [map, picking]);

  // The marker comes and goes with the pin; moving the pin only moves the marker (below).
  useEffect(() => {
    const start = useConsole.getState().reportPosition;
    if (!map || !start) return;
    const element = document.createElement('div');
    element.className = styles.reportPin!;
    element.innerHTML = PIN_SVG;
    // Pointer-only (see above): the zone select is the keyboard route, so it is no "Map marker".
    element.setAttribute('aria-hidden', 'true');
    const marker = new maplibregl.Marker({ element, anchor: 'bottom', offset: PIN_TIP_OFFSET })
      .setLngLat(start)
      .addTo(map);
    marker.on('dragend', () => {
      const { lng, lat } = marker.getLngLat();
      if (placePinAt([lng, lat], zonesRef.current)) return;
      // Dropped outside every zone: back to where it was, which is still in the store.
      const kept = useConsole.getState().reportPosition;
      if (kept) marker.setLngLat(kept);
    });
    pin.current = marker;
    return () => {
      marker.remove();
      pin.current = null;
    };
  }, [map, hasPin]);

  useEffect(() => {
    if (position) pin.current?.setLngLat(position);
  }, [position]);

  useEffect(() => {
    const marker = pin.current;
    if (!marker) return;
    marker.setDraggable(picking);
    marker.getElement().toggleAttribute('data-draggable', picking);
  }, [picking, hasPin]);
}

/** Places the report's pin at `point` if it lies in a zone, else reports a miss. True if placed. */
function placePinAt(point: LngLat, zones: readonly Zone[] | undefined): boolean {
  const zone = zoneAt(point, zones ?? []);
  const { placePin, missPin } = useConsole.getState();
  if (zone) placePin(point, zone.id);
  else missPin();
  return zone !== undefined;
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
