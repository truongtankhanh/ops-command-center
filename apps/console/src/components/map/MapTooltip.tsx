import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { type ReactNode, useEffect, useState } from 'react';
import { useAssets, useCameras, useIncidents, useZones } from '../../api/queries';
import { isActive } from '../../lib/incidents/incidents';
import { type HoverTarget, hoverTargetOf, isClickable, sameTarget } from '../../lib/map/mapHover';
import { HOVER_LAYERS, visibleLayers } from '../../lib/map/mapLayers';
import { useConsole } from '../../store';
import { AssetTip, CameraTip, ClusterTip, IncidentTip } from '../shell/Tips';
import { tipSurface } from '../shell/tipSurface';
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
 * The bodies are `Tips.tsx`'s, shared with the 3D view's tooltip (V2-15.5).
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
    body = <ClusterTip count={target.count} severity={target.severity} />;
  }

  return (
    <div
      className={`${tipSurface} ${styles.tooltip}`}
      style={{ left: hover.left, top: hover.top }}
      data-placement={hover.below ? 'below' : 'above'}
      aria-hidden="true"
    >
      {body}
    </div>
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
