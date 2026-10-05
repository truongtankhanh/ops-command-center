import type { Camera, Incident, Zone } from '@occ/contracts';
import type { FeatureCollection } from 'geojson';
import maplibregl, { type LngLatBoundsLike, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { useCameras, useIncidents, useZones } from '../api/queries';
import { isActive } from '../lib/incidents';
import { useConsole } from '../store';
import { mapColors } from '../styles/tokens';
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
      attributionControl: false,
      dragRotate: false,
    });
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    instance.on('load', () => setMap(instance));

    // The map shares its column with the camera strip; keep the canvas in step with the layout.
    const observer = new ResizeObserver(() => {
      instance.resize();
      focus(instance, focusRef.current, 0);
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      instance.remove();
    };
  }, []);

  useZoneLayer(map, zones);
  useCameraMarkers(map, cameras);
  useIncidentMarkers(map, incidents, selectedId);

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
    map.addSource('zones', { type: 'geojson', data });
    map.addLayer({
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
    });
    map.addLayer({
      id: 'zone-outline',
      type: 'line',
      source: 'zones',
      paint: { 'line-color': mapColors.zoneOutline, 'line-width': 1.2 },
    });

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

function useCameraMarkers(map: maplibregl.Map | null, cameras: Camera[] | undefined) {
  useEffect(() => {
    if (!map || !cameras) return;
    const markers = cameras.map((camera) => {
      const el = document.createElement('div');
      el.className = styles.cameraMarker!;
      el.dataset.online = String(camera.online);
      el.title = `${camera.code} ${camera.name}${camera.online ? '' : ' (offline)'}`;
      return new maplibregl.Marker({ element: el }).setLngLat(camera.position).addTo(map);
    });
    return () => markers.forEach((marker) => marker.remove());
  }, [map, cameras]);
}

/** Active incidents, plus the selected one even if it is resolved. */
function useIncidentMarkers(
  map: maplibregl.Map | null,
  incidents: Incident[] | undefined,
  selectedId: string | null,
) {
  useEffect(() => {
    if (!map || !incidents) return;
    const { select } = useConsole.getState();

    const markers = incidents
      .filter((incident) => isActive(incident) || incident.id === selectedId)
      .reverse() // most important drawn last, on top
      .map((incident) => {
        const el = document.createElement('button');
        el.className = styles.incidentMarker!;
        el.dataset.severity = incident.severity;
        el.dataset.status = incident.status;
        el.setAttribute('aria-pressed', String(incident.id === selectedId));
        el.setAttribute('aria-label', `${incident.title}, ${incident.severity}`);
        el.title = incident.title;
        el.addEventListener('click', (event) => {
          event.stopPropagation();
          select(incident.id === useConsole.getState().selectedIncidentId ? null : incident.id);
        });
        return new maplibregl.Marker({ element: el }).setLngLat(incident.position).addTo(map);
      });

    return () => markers.forEach((marker) => marker.remove());
  }, [map, incidents, selectedId]);
}
