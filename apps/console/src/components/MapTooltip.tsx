import type { Camera, Incident } from '@occ/contracts';
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { type ReactNode, useEffect, useState } from 'react';
import { useCameras, useIncidents, useZones } from '../api/queries';
import { formatAge, isActive, severityLabel, statusLabel } from '../lib/incidents';
import { type HoverTarget, hoverTargetOf, isClickable, sameTarget } from '../lib/mapHover';
import { HOVER_LAYERS } from '../lib/mapLayers';
import { useNow } from '../lib/useNow';
import { useConsole } from '../store';
import { Icon } from '../ui/Icon';
import { cameraIcon, incidentTypeIcon, severityIcon, statusIcon } from '../ui/icons';
import styles from './MapTooltip.module.css';

/** Half the tooltip's `max-width` in the module: it is clamped this far from the map's sides. */
const HALF_WIDTH = 140;
/** An anchor closer than this to the top of the map gets its tooltip below the marker. */
const FLIP_BELOW_Y = 140;

interface Hover {
  target: HoverTarget;
  left: number;
  top: number;
  below: boolean;
}

/**
 * What is under the pointer on the map: an incident, a cluster or a camera. Owns the map's one
 * `mousemove` handler, so it also sets the pointer cursor over what a click acts on (except while
 * the report's location is being picked).
 *
 * Pointer-only and hidden from assistive tech: the incident feed is the keyboard and screen-reader
 * route to every incident the map draws, and on touch a tap selects. The tooltip anchors at the
 * marker, hides while the map moves, and reads incidents from the live cache on every render, so
 * an acknowledge shows at once and an incident that stops being drawn takes its tooltip with it.
 */
export function MapTooltip({ map }: { map: MapLibreMap | null }) {
  const [hover, setHover] = useState<Hover | null>(null);
  const { data: incidents } = useIncidents();
  const { data: cameras } = useCameras();
  const { data: zones } = useZones();
  const selectedId = useConsole((s) => s.selectedIncidentId);

  useEffect(() => {
    if (!map) return;
    const canvas = map.getCanvas();
    // A position taken while the map pans would be stale a frame later.
    let moving = false;

    const onMove = (event: MapMouseEvent) => {
      // While picking the report's location a click places the pin, so nothing is pointed out and
      // the cursor stays the crosshair `CampusMap` sets.
      if (useConsole.getState().picking) {
        setHover(null);
        return;
      }
      const [hit] = map.queryRenderedFeatures(event.point, { layers: HOVER_LAYERS });
      canvas.style.cursor = hit && isClickable(hit.layer.id) ? 'pointer' : '';
      const target =
        hit && !moving ? hoverTargetOf(hit.layer.id, hit.properties, hit.geometry) : null;
      // Re-render only when the subject changes, not on every pointer move.
      setHover((current) =>
        sameTarget(current?.target ?? null, target)
          ? current
          : target && { target, ...placement(map, target) },
      );
    };
    const hide = () => setHover(null);
    const onMoveStart = () => {
      moving = true;
      hide();
    };
    const onMoveEnd = () => {
      moving = false;
    };

    map.on('mousemove', onMove);
    map.on('mouseout', hide);
    map.on('movestart', onMoveStart);
    map.on('moveend', onMoveEnd);
    return () => {
      map.off('mousemove', onMove);
      map.off('mouseout', hide);
      map.off('movestart', onMoveStart);
      map.off('moveend', onMoveEnd);
      setHover(null);
    };
  }, [map]);

  if (!hover) return null;
  const { target } = hover;
  const zoneName = (zoneId: string) => zones?.find((zone) => zone.id === zoneId)?.name;

  let body: ReactNode;
  if (target.kind === 'incident') {
    const incident = incidents?.find((i) => i.id === target.id);
    // The map draws active incidents and the selected one; anything else has left the map.
    if (!incident || !(isActive(incident) || incident.id === selectedId)) return null;
    body = <IncidentTip incident={incident} zone={zoneName(incident.zoneId)} />;
  } else if (target.kind === 'camera') {
    const camera = cameras?.find((c) => c.id === target.id);
    if (!camera) return null;
    body = <CameraTip camera={camera} zone={zoneName(camera.zoneId)} />;
  } else {
    body = (
      <>
        <p className={styles.title}>{target.count} incidents</p>
        <p className={styles.line} data-severity={target.severity}>
          <Icon glyph={severityIcon(target.severity)} size={16} className={styles.severity} />
          Highest: {severityLabel(target.severity)}
        </p>
        <p>Click to zoom in</p>
      </>
    );
  }

  return (
    <div
      className={styles.tooltip}
      style={{ left: hover.left, top: hover.top }}
      data-placement={hover.below ? 'below' : 'above'}
      aria-hidden="true"
    >
      {body}
    </div>
  );
}

function IncidentTip({ incident, zone }: { incident: Incident; zone?: string }) {
  const now = useNow();
  return (
    <>
      <p className={styles.title}>
        <Icon glyph={incidentTypeIcon(incident.type)} size={16} className={styles.glyph} />
        <span className={styles.titleText}>{incident.title}</span>
      </p>
      <p className={styles.line} data-severity={incident.severity}>
        <Icon glyph={severityIcon(incident.severity)} size={16} className={styles.severity} />
        {severityLabel(incident.severity)}
        <span className={styles.status}>
          <Icon glyph={statusIcon(incident.status)} size={16} />
          {statusLabel(incident.status)}
        </span>
      </p>
      <p>
        {[incident.code, zone, formatAge(incident.reportedAt, now)].filter(Boolean).join(' · ')}
      </p>
    </>
  );
}

function CameraTip({ camera, zone }: { camera: Camera; zone?: string }) {
  return (
    <>
      <p className={styles.title}>
        <Icon
          glyph={cameraIcon(camera.online)}
          size={16}
          className={camera.online ? styles.glyph : styles.offline}
        />
        <span className={styles.titleText}>{camera.name}</span>
      </p>
      <p>
        {[camera.code, zone, camera.online ? undefined : 'Offline'].filter(Boolean).join(' · ')}
      </p>
    </>
  );
}

/** Where the tooltip goes, in map container pixels: above the marker, clamped to the sides. */
function placement(map: MapLibreMap, { lngLat }: HoverTarget): Omit<Hover, 'target'> {
  const { x, y } = map.project(lngLat);
  const width = map.getContainer().clientWidth;
  return {
    left: Math.max(HALF_WIDTH, Math.min(x, width - HALF_WIDTH)),
    top: y,
    below: y < FLIP_BELOW_Y,
  };
}
