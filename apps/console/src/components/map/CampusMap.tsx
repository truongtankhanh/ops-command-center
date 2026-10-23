import type { Asset, Camera, Incident, LngLat, SitePlan, Zone } from '@occ/contracts';
import type { Point } from 'geojson';
import maplibregl, {
  type GeoJSONSource,
  type MapGeoJSONFeature,
  type MapMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { isRateLimited } from '../../api/client';
import { useAssets, useCameras, useIncidents, useSitePlan, useZones } from '../../api/queries';
import { assetStates } from '../../lib/assets/assets';
import {
  assetFeatures,
  cameraFeatures,
  cameraViewFeatures,
  fanOutAssets,
  incidentFeatures,
} from '../../lib/map/mapFeatures';
import { addClusterCountImage, registerMapImages } from '../../lib/map/mapImages';
import {
  assetLayers,
  assetRingFilter,
  assetSource,
  cameraLayers,
  cameraSource,
  cameraViewLayers,
  cameraViewSource,
  groundLayers,
  incidentLayers,
  incidentSources,
  INTERACTIVE_LAYERS,
  LAYER_GROUPS,
  type LayerVisibility,
  MAP_LAYER_KEYS,
  MAP_LAYERS,
  MAP_SOURCES,
  removeLayers,
  siteSources,
  visibleLayers,
  zoneHighlightFilter,
  zoneOverlayLayers,
} from '../../lib/map/mapLayers';
import { startPulse } from '../../lib/map/mapPulse';
import { placePinAt } from '../../lib/map/reportPin';
import { siteBounds } from '../../lib/map/sitePlan';
import { serverNow } from '../../lib/telemetry/telemetryFreshness';
import { buildingFocusOf } from '../../lib/twin-core/twinLevel';
import { usePrefersReducedMotion } from '../../lib/shared/usePrefersReducedMotion';
import { useTelemetryStore } from '../../realtime/telemetryStore';
import { useConsole } from '../../store';
import { mapColors, mapMotion } from '../../styles/tokens';
import { Icon } from '../../ui/Icon';
import { Crosshair } from '../../ui/icons';
import styles from './CampusMap.module.css';
import { LoadFailed, RateLimited } from '../LoadStates';
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

/** Past this the offline plan shows nothing more; the fan-out in `lib/map/mapFeatures` is sized for it. */
const MAX_ZOOM = 20;
/** About 1.4 zoom levels out from the fitted campus (≈ 16.4): the plan stays recognisable. */
const MIN_ZOOM = 15;
/** How often the asset markers are re-derived: stale is a function of the clock, so a quiet site ticks. */
const ASSET_SYNC_MS = 1000;
/** `easeTo` / `fitBounds` duration when the view follows a selection or the Fit campus button. */
const FOCUS_MS = 600;
/** Space kept around the campus when it is framed. */
const FIT_PADDING = 48;
/** Map width the open sheet always leaves for the view on a narrow screen. */
const MIN_VISIBLE_PX = 160;

/**
 * The zoom a video wall's map eases to when it goes to an incident (V2-21.9): close enough to see the incident's surroundings,
 * where the campus fit shows all of it. `unverified` until it is looked at on a wall (V2-21.12).
 */
const WALL_FOCUS_ZOOM = 18;

/** What the view frames: the selected incident's drawn position, and whether the sheet is open. */
interface ViewTarget {
  point: [number, number] | null;
  sheetOpen: boolean;
  /** The zoom to ease to at `point`; the map keeps its own when unset. */
  zoom?: number;
}

/**
 * Incidents and cameras are map layers, not DOM markers, so they are not in the Tab order: the
 * incident feed is the keyboard and screen-reader route to every incident the map draws.
 *
 * **On a video wall** (`wall`, V2-21.9) it is the picture the 3D view falls back to: the map takes no input (MapLibre
 * `interactive: false`: no drag, wheel, touch or key, and the canvas leaves the Tab order), draws no tooltip, legend or
 * control, and follows the incident the wall's camera is on (`wallFocusId`, set by `useWallFocus`) instead of the selected
 * one, easing to it and back to the campus fit when the hold ends.
 */
export function CampusMap({ wall = false }: { wall?: boolean } = {}) {
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
  const { data: assets } = useAssets();
  const { data: incidents } = useIncidents();
  const selectedId = useConsole((s) => (wall ? s.wallFocusId : s.selectedIncidentId));
  const reporting = useConsole((s) => s.reporting);
  const reportZoneId = useConsole((s) => s.reportZoneId);
  const picking = useConsole((s) => s.picking);
  const layers = useConsole((s) => s.layers);
  const selectedAssetCode = useConsole((s) => s.selectedAssetCode);
  const reducedMotion = usePrefersReducedMotion();
  // The inspector is a sheet too: the view keeps clear of it as of the incident's and the form's.
  const sheetOpen = !wall && (selectedId !== null || selectedAssetCode !== null || reporting);
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
      interactive: !wall,
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
  }, [wall]);

  const features = useMemo(
    () => (incidents ? incidentFeatures(incidents, selectedId) : null),
    [incidents, selectedId],
  );
  useSiteLayers(map, zones, sitePlan, focusRef);
  useCameraLayer(map, cameras);
  // Between the cameras and the incidents: layers added later are drawn higher (see the hook).
  useAssetLayers(map, assets, incidents);
  // The building an asset is in, for the click that selects it (the 3D view focuses it; 2D ignores it).
  const focusZoneOf = useMemo(
    () => (code: string) => {
      const asset = assets?.find((candidate) => candidate.code === code);
      return asset ? buildingFocusOf(asset, zones) : null;
    },
    [assets, zones],
  );
  useIncidentLayers(map, features, layers.incidents, focusZoneOf);
  // After every hook that adds a layer: effects run in declaration order, so the layers exist when
  // this applies the operator's toggles (do not move it above them).
  useLayerVisibility(map, layers);
  useReportPick(map, zones);

  // Bring the selected incident into view beside the sheet, at the marker as drawn (it may be fanned
  // out from its true position); show the whole campus when nothing is selected. The view moves when
  // the selection or the sheet changes, and once the selected marker is first known — not when the
  // fan-out shifts it a few metres because another incident arrived at the same spot.
  //
  // The same for the inspected asset, at the point it is drawn (`fanOutAssets`: assets on one spot
  // are spread). The store keeps the incident, the asset and the report form exclusive, so at most
  // one of the two points applies. Under reduced motion the view jumps (`duration` 0) instead of
  // easing over `FOCUS_MS`; MapLibre would skip the ease too, but that is stated here.
  const assetPoint = useMemo(
    () => (selectedAssetCode && assets ? fanOutAssets(assets).get(selectedAssetCode) : undefined),
    [assets, selectedAssetCode],
  );
  const selectedPoint = features?.selected.features[0]?.geometry.coordinates ?? assetPoint;
  const pointRef = useRef<number[] | undefined>(undefined);
  const focusMs = reducedMotion ? 0 : FOCUS_MS;
  const focusMsRef = useRef(focusMs);
  useEffect(() => {
    pointRef.current = selectedPoint;
    focusMsRef.current = focusMs;
  });
  const hasSelectedPoint = selectedPoint !== undefined;
  useEffect(() => {
    const point = pointRef.current;
    focusRef.current = {
      point: point ? [point[0]!, point[1]!] : null,
      sheetOpen,
      ...(wall && point ? { zoom: WALL_FOCUS_ZOOM } : {}),
    };
    if (map) focus(map, focusRef.current, focusMsRef.current);
  }, [map, selectedId, selectedAssetCode, hasSelectedPoint, sheetOpen, wall]);

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
    <section
      className={styles.map}
      aria-label="Campus map"
      aria-busy={mapLoading || undefined}
      data-still={wall || undefined}
    >
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
      {!wall && (
        <>
          <MapTooltip map={map} />
          <MapLegend />
          <MapControls map={map} onFit={() => map && fitCampus(map, sheetOpen, focusMs)} />
        </>
      )}
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
function focus(map: maplibregl.Map, { point, sheetOpen, zoom }: ViewTarget, duration: number) {
  if (!point) {
    fitCampus(map, sheetOpen, duration);
    return;
  }
  const inset = sheetInset(map, sheetOpen);
  map.easeTo({
    center: point,
    offset: [-inset / 2, 0],
    duration,
    ...(zoom === undefined ? {} : { zoom }),
  });
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
 * Asset markers (V2-10.3): one source and layer per map, **drawn above the cameras and below the
 * incidents**, so an incident raised at an asset's position stays on top. Layers are drawn in the
 * order they were added and effects run in the order the hooks are called, so this hook is called
 * between `useCameraLayer` and `useIncidentLayers`; do not move it.
 *
 * The data is derived here, not in the component. An asset's state depends on the telemetry
 * overview, which changes several times a second, and on the API's clock, which moves every
 * second; reading either through a hook would re-render the whole map for markers that rarely
 * change. Instead the derived list is compared with the one last sent, and `setData` is called
 * only when it differs: a tick that changes no asset's state sends nothing.
 *
 * It is interactive (V2-10.4): a click selects the asset in the shared handler of
 * `useIncidentLayers`, and the hovered and the selected asset get a ring, which this hook sets as a
 * layer filter from the store without re-rendering the map.
 */
function useAssetLayers(
  map: maplibregl.Map | null,
  assets: Asset[] | undefined,
  incidents: Incident[] | undefined,
) {
  /** The features last sent, as text; reset when a new source is added, which starts empty. */
  const sent = useRef('');

  useEffect(() => {
    if (!map) return;
    const [sourceId, source] = assetSource();
    const layers = assetLayers();
    sent.current = '';
    map.addSource(sourceId, source);
    // Under the incidents if they are somehow already drawn; the hook order gives the same.
    const below = firstLayer(map, [MAP_LAYERS.pulseStatic]);
    layers.forEach((layer) => map.addLayer(layer, below));
    return () =>
      removeLayers(
        map,
        layers.map((layer) => layer.id),
        [sourceId],
      );
  }, [map]);

  useEffect(() => {
    // Nothing is drawn until the catalogue is known; an empty one clears the source.
    if (!map || !assets) return;
    const sync = () => {
      const { state } = useTelemetryStore.getState().view;
      const now = serverNow(state.serverClock, performance.now());
      const known = incidents ?? [];
      const features = assetFeatures(assets, assetStates(assets, known, state.assets, now), known);
      const next = JSON.stringify(features);
      if (next === sent.current) return;
      sent.current = next;
      map.getSource<GeoJSONSource>(MAP_SOURCES.assets)?.setData(features);
    };
    sync();
    const stop = useTelemetryStore.subscribe(sync);
    const timer = setInterval(sync, ASSET_SYNC_MS);
    return () => {
      stop();
      clearInterval(timer);
    };
  }, [map, assets, incidents]);

  // The rings follow the store's hovered and selected asset. Read imperatively, so a hover (which
  // can come from a row of the list or from this map) does not render `CampusMap`; a filter is set
  // only when its asset changes.
  useEffect(() => {
    if (!map) return;
    let selected: string | null = null;
    let hovered: string | null = null;
    const apply = () => {
      // The map may have been removed since: its style is gone and every style call throws.
      if (!map.style) return;
      const state = useConsole.getState();
      if (state.selectedAssetCode !== selected) {
        selected = state.selectedAssetCode;
        map.setFilter(MAP_LAYERS.assetSelected, assetRingFilter(selected));
      }
      if (state.hoveredAssetCode !== hovered) {
        hovered = state.hoveredAssetCode;
        map.setFilter(MAP_LAYERS.assetHover, assetRingFilter(hovered));
      }
    };
    apply();
    return useConsole.subscribe(apply);
  }, [map]);
}

/**
 * Active incidents, plus the selected one even if it is resolved. Sources, layers, handlers and the
 * selected code tag are created once per map; an incident event or a selection change only
 * replaces the source data and moves the tag.
 */
function useIncidentLayers(
  map: maplibregl.Map | null,
  features: ReturnType<typeof incidentFeatures> | null,
  /** The Incidents toggle: the layers follow it in `useLayerVisibility`, the DOM tag and pulse here. */
  shown: boolean,
  /** The building zone of an asset by code, or `null` (V2-15.2). */
  focusZoneOf: (code: string) => string | null,
) {
  const codeTag = useRef<maplibregl.Marker | null>(null);
  // Read by the one click handler added per map, so it sees the assets and zones as they are now.
  const focusZoneOfRef = useRef(focusZoneOf);
  useEffect(() => {
    focusZoneOfRef.current = focusZoneOf;
  });
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
      // Only what is drawn: a hidden layer is not hit, whatever MapLibre would answer for it.
      const hittable = visibleLayers(INTERACTIVE_LAYERS, useConsole.getState().layers);
      if (hittable.length === 0) return;
      const [hit] = map.queryRenderedFeatures(event.point, { layers: hittable });
      if (!hit) return;
      if (hit.layer.id === MAP_LAYERS.clusters) {
        expandCluster(map, hit);
        return;
      }
      // An asset selects (the inspector opens) and a second click on it deselects, as an incident.
      // It has a `code`, not an `id`, so it is read before the id below.
      if (hit.layer.id === MAP_LAYERS.assets) {
        const code: unknown = hit.properties.code;
        if (typeof code !== 'string') return;
        useConsole.getState().toggleAsset(code, focusZoneOfRef.current(code));
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
  }, [map, features]);

  // The code tag is DOM, so it is not hidden with the layers: it goes while the incidents are.
  useEffect(() => {
    if (!map || !features) return;
    const tag = codeTag.current;
    if (!tag) return;
    const [selected] = features.selected.features;
    if (!selected || !shown) {
      tag.remove();
      return;
    }
    tag.getElement().textContent = selected.properties.code;
    tag.setLngLat(selected.geometry.coordinates as [number, number]);
    if (!tag.getElement().isConnected) tag.addTo(map);
  }, [map, features, shown]);

  // The wave repaints the map every frame, so it runs only while something pulses and is drawn.
  useEffect(() => {
    if (!map || !pulsing || reducedMotion || !shown) return;
    return startPulse(map, mapMotion.pulseMs);
  }, [map, pulsing, reducedMotion, shown]);
}

/**
 * The operator's toggles (frame 14's "Show"): each group of layers is shown or hidden as one
 * (`LAYER_GROUPS`). Only a group whose toggle changed is touched, and none at all while everything
 * is shown, so a console that never hides anything pays nothing. A layer a group names that the
 * map does not have (yet) is skipped.
 */
function useLayerVisibility(map: maplibregl.Map | null, layers: LayerVisibility) {
  /** What the map has been told: every layer starts shown. */
  const applied = useRef<LayerVisibility>({ incidents: true, cameras: true, assets: true });

  useEffect(() => {
    if (!map) return;
    for (const key of MAP_LAYER_KEYS) {
      if (applied.current[key] === layers[key]) continue;
      const visibility = layers[key] ? 'visible' : 'none';
      for (const id of LAYER_GROUPS[key]) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
      }
    }
    applied.current = layers;
  }, [map, layers]);
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
 * (`placePinAt`, `lib/map/reportPin.ts`), so a placed pin is never refused for lying outside its zone.
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
