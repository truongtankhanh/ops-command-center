import { useId } from 'react';
import { MAP_LAYER_KEYS, type MapLayerKey } from '../lib/mapLayers';
import { useConsole } from '../store';
import { Button } from '../ui/Button';
import styles from './LayersControl.module.css';

const LABELS: Record<MapLayerKey, string> = {
  incidents: 'Incidents',
  cameras: 'Cameras',
  assets: 'Assets',
};

/**
 * Frame 14's "Show: Incidents · Cameras · Assets": three toggle buttons that draw or hide a kind of
 * marker on the 2D map. A toggle hides drawing only: the incident feed, the Assets tab and the
 * camera strip are untouched, and so are the site plan, the zone outline and highlight and the
 * report's pin (`LAYER_GROUPS`). Not remembered (Open question 4), and the same for every role.
 *
 * Hiding the incidents is the one that can mislead, so it says so in words and stays said: while
 * they are hidden "Incidents hidden" is shown beside the toggles and describes the Incidents
 * button. It is plain text, not a live region: the pressed state already says it when it changes,
 * and a new critical incident or selecting one turns the layer back on (`useConsole`).
 *
 * The toggle's state is `aria-pressed`, and the tick beside the name is only a drawing of it.
 */
export function LayersControl() {
  const layers = useConsole((s) => s.layers);
  const toggleLayer = useConsole((s) => s.toggleLayer);
  const noteId = useId();

  return (
    <div role="group" aria-label="Layers" className={styles.layers}>
      <span className={styles.label}>Show</span>
      {MAP_LAYER_KEYS.map((key) => (
        <Button
          key={key}
          variant="ghost"
          className={styles.layer}
          aria-pressed={layers[key]}
          aria-describedby={key === 'incidents' && !layers.incidents ? noteId : undefined}
          onClick={() => toggleLayer(key)}
        >
          <span className={styles.tick} aria-hidden="true" />
          {LABELS[key]}
        </Button>
      ))}
      {!layers.incidents && (
        <span id={noteId} className={styles.note}>
          Incidents hidden
        </span>
      )}
    </div>
  );
}
