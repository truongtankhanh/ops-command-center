import type { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useState } from 'react';
import { Button } from '../../ui/Button';
import { Minus, Plus, Scan } from '../../ui/icons';
import { Panel } from '../../ui/Panel';
import styles from './MapControls.module.css';

/**
 * The map's zoom and fit buttons in place of MapLibre's white `NavigationControl`: a floating `Panel` rail down the
 * left edge under the stage bar, the look of the 3D view's camera rail (V3-10.2) and where frame 09 draws it, so a
 * switch of view does not move it. The canvas keeps MapLibre's own keyboard zoom (`+` / `-`) while it has focus.
 *
 * At a zoom limit the button is `aria-disabled`, not `disabled`: a disabled button drops keyboard
 * focus, so pressing Zoom in until the limit would throw the operator out of the group. MapLibre
 * clamps to its limits, so a click there does nothing anyway.
 */
export function MapControls({ map, onFit }: { map: MapLibreMap | null; onFit: () => void }) {
  const [limits, setLimits] = useState({ atMin: false, atMax: false });

  useEffect(() => {
    if (!map) return;
    // Read in the event only: the initial and the fitted zoom lie inside the limits, so both
    // buttons start enabled. `zoom` fires every animation frame; state changes only at a limit.
    const onZoom = () => {
      const zoom = map.getZoom();
      const atMin = zoom <= map.getMinZoom();
      const atMax = zoom >= map.getMaxZoom();
      setLimits((current) =>
        current.atMin === atMin && current.atMax === atMax ? current : { atMin, atMax },
      );
    };
    map.on('zoom', onZoom);
    return () => {
      map.off('zoom', onZoom);
    };
  }, [map]);

  return (
    <Panel variant="floating" role="group" aria-label="Map view" className={styles.controls}>
      <Button
        variant="ghost"
        icon={Plus}
        aria-label="Zoom in"
        className={styles.button}
        disabled={!map}
        aria-disabled={limits.atMax || undefined}
        onClick={() => map?.zoomIn()}
      />
      <Button
        variant="ghost"
        icon={Minus}
        aria-label="Zoom out"
        className={styles.button}
        disabled={!map}
        aria-disabled={limits.atMin || undefined}
        onClick={() => map?.zoomOut()}
      />
      <Button
        variant="ghost"
        icon={Scan}
        aria-label="Fit campus"
        className={styles.button}
        disabled={!map}
        onClick={onFit}
      />
    </Panel>
  );
}
