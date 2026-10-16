import type { Asset, Camera, Incident } from '@occ/contracts';
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { type ReactNode, useEffect, useState } from 'react';
import { useAssets, useCameras, useIncidents, useZones } from '../api/queries';
import { assetStates, openIncidentOf } from '../lib/assets';
import { freshnessText } from '../lib/assetInspector';
import { stateText } from '../lib/assetList';
import { formatAge, isActive, severityLabel, statusLabel } from '../lib/incidents';
import { type HoverTarget, hoverTargetOf, isClickable, sameTarget } from '../lib/mapHover';
import { HOVER_LAYERS, visibleLayers } from '../lib/mapLayers';
import { formatReading } from '../lib/readings';
import { ageMs as readingAgeMs, isStale, staleAfterMs } from '../lib/telemetryFreshness';
import { useNow } from '../lib/useNow';
import { useAssetState, useServerNow } from '../realtime/telemetryStore';
import { useConsole } from '../store';
import { Icon } from '../ui/Icon';
import {
  assetStateIcon,
  cameraIcon,
  incidentTypeIcon,
  severityIcon,
  statusIcon,
} from '../ui/icons';
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
 * What is under the pointer on the map: an incident, a cluster, a camera or an asset. Owns the
 * map's one `mousemove` handler, so it also sets the pointer cursor over what a click acts on
 * (except while the report's location is being picked).
 *
 * Pointer-only and hidden from assistive tech: the incident feed and the Assets tab are the
 * keyboard and screen-reader route to what the map draws, and on touch a tap selects. The tooltip
 * anchors at the marker, hides while the map moves, and reads incidents from the live cache on
 * every render, so an acknowledge shows at once and an incident that stops being drawn takes its
 * tooltip with it.
 *
 * Over an asset it also tells the console which one (`hoveredAssetCode`), so the Assets tab
 * highlights its row; the map rings the marker of a hovered row from the same value (two-way,
 * V2-10.4). It writes when the asset changes, not per pointer move.
 */
export function MapTooltip({ map }: { map: MapLibreMap | null }) {
  const [hover, setHover] = useState<Hover | null>(null);
  const { data: incidents } = useIncidents();
  const { data: cameras } = useCameras();
  const { data: assets } = useAssets();
  const { data: zones } = useZones();
  const selectedId = useConsole((s) => s.selectedIncidentId);

  // The asset under the pointer, for the row that mirrors it. The cleanup clears it when the pointer
  // moves on, leaves the map or the map unmounts, and only if it is still this asset: a row the
  // pointer has meanwhile entered owns the value then.
  const hoveredCode = hover?.target.kind === 'asset' ? hover.target.code : null;
  useEffect(() => {
    if (hoveredCode === null) return;
    const { hoveredAssetCode, hoverAsset } = useConsole.getState();
    if (hoveredAssetCode !== hoveredCode) hoverAsset(hoveredCode);
    return () => {
      if (useConsole.getState().hoveredAssetCode === hoveredCode) {
        useConsole.getState().hoverAsset(null);
      }
    };
  }, [hoveredCode]);

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
      // Only what is drawn: nothing is pointed out on a layer the operator has hidden.
      const hoverable = visibleLayers(HOVER_LAYERS, useConsole.getState().layers);
      const [hit] =
        hoverable.length === 0 ? [] : map.queryRenderedFeatures(event.point, { layers: hoverable });
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
  } else if (target.kind === 'asset') {
    const asset = assets?.find((a) => a.code === target.code);
    // An asset the catalogue does not hold (still loading) has nothing to say.
    if (!asset) return null;
    body = <AssetTip asset={asset} incidents={incidents ?? []} zone={zoneName(asset.zoneId)} />;
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

/**
 * Frame 14's `.tw-tip`: name and code, the state word with its glyph (the list's wording), the two
 * headline readings from the overview (no watch: the tooltip never asks for more than the console
 * already holds), how old the asset's latest reading is, and where a click leads.
 *
 * The age is the asset's, not each reading's: a frame carries changed keys only, so a steady
 * reading's own age would read "old" on a healthy device (V2-08.3, and the inspector's rule). It
 * is the one component here that reads the clock, so only an open asset tooltip re-renders each
 * second.
 */
function AssetTip({
  asset,
  incidents,
  zone,
}: {
  asset: Asset;
  incidents: readonly Incident[];
  zone?: string;
}) {
  const entry = useAssetState(asset.code);
  const now = useServerNow();

  const state =
    assetStates([asset], incidents, entry ? { [asset.code]: entry } : {}, now).get(asset.code) ??
    'unknown';
  const incident = state === 'fault' ? openIncidentOf(asset, incidents) : undefined;
  const age = entry !== undefined && now !== null ? readingAgeMs(entry.receivedAt, now) : null;
  // Offline or past its threshold: the values are the last known, and the age is said as such.
  const stale =
    entry !== undefined &&
    (!entry.online ||
      (now !== null && isStale(entry.receivedAt, staleAfterMs(asset.headline), now)));
  const word = stateText(state, { ageMs: stale ? age : null, incidentCode: incident?.code });
  const glyph =
    state === 'fault'
      ? incident && severityIcon(incident.severity)
      : state === 'unknown'
        ? undefined
        : assetStateIcon(state);
  const readings = asset.headline.slice(0, 2).map((point) => {
    const value = entry?.values[point.key] ?? entry?.headline[point.key];
    return {
      key: point.key,
      label: point.label,
      text: value === undefined ? '—' : formatReading(point, value),
    };
  });
  const freshness = freshnessText(age, stale);

  return (
    <>
      <p className={styles.assetHead}>
        <span className={styles.titleText}>{asset.name}</span>
        <span className={styles.assetCode}>{asset.code}</span>
      </p>
      {word !== null && (
        <p className={styles.line} data-severity={incident?.severity}>
          {glyph && <Icon glyph={glyph} size={16} className={styles.severity} />}
          {word}
        </p>
      )}
      {readings.length > 0 && (
        <dl className={styles.readings}>
          {readings.map((reading) => (
            <div key={reading.key} className={styles.reading}>
              <dt>{reading.label}</dt>
              <dd data-stale={stale}>{reading.text}</dd>
            </div>
          ))}
        </dl>
      )}
      {freshness !== null && <p className={styles.age}>{freshness}</p>}
      <p className={styles.foot}>{['Click to inspect', zone].filter(Boolean).join(' · ')}</p>
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
