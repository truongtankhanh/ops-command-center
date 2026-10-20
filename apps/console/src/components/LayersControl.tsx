import { useId } from 'react';
import { layersOf, type SceneLayerKey } from '../lib/twinLayers';
import { levelOf } from '../lib/twinLevel';
import type { ViewChoice } from '../lib/viewChoice';
import { useConsole } from '../store';
import { Button } from '../ui/Button';
import styles from './LayersControl.module.css';

const LABELS: Record<SceneLayerKey, string> = {
  incidents: 'Incidents',
  cameras: 'Cameras',
  assets: 'Assets',
  inside: 'Inside',
  // Not offered yet: V2-17.4 adds it to `layersOf`; the label is here because the record covers every key.
  heat: 'Heat',
};

/**
 * Frame 14's "Show: Incidents · Cameras · Assets": three toggle buttons that draw or hide a kind of
 * marker on the 2D map (and, in 3D, the layers of `layersOf`). A toggle hides drawing only: the
 * incident feed, the Assets tab and the camera strip are untouched, and so are the site plan, the
 * zone outline and highlight and the report's pin (`LAYER_GROUPS`). Not remembered (Open question 4), and the same for every role.
 *
 * Hiding the incidents is the one that can mislead, so it says so in words and stays said: while
 * they are hidden "Incidents hidden" is shown beside the toggles and describes the Incidents
 * button. It is plain text, not a live region: the pressed state already says it when it changes,
 * and a new critical incident or selecting one turns the layer back on (`useConsole`).
 *
 * Which toggles it offers is `layersOf(view, level)`: the 3D stage has no Assets toggle (equipment is the scene, not
 * a layer on it, ADR-0020, V2-12.1, so `layers.assets` is left alone there and is as it was when the view goes back
 * to 2D), and **Inside** is offered at building level only (V2-15.9): it draws the building in focus opaque with its
 * equipment hidden, and at asset and part level the isolated asset is drawn whatever it says, so a toggle there would
 * do nothing. Its state is kept while it is not offered. Heat joins the 3D list with V2-17.4.
 *
 * The toggle's state is `aria-pressed`, and the tick beside the name is only a drawing of it.
 */
export function LayersControl({ view = '2d' }: { view?: ViewChoice }) {
  const layers = useConsole((s) => s.layers);
  const level = useConsole((s) => levelOf(s));
  const toggleLayer = useConsole((s) => s.toggleLayer);
  const noteId = useId();

  return (
    <div role="group" aria-label="Layers" className={styles.layers}>
      <span className={styles.label}>Show</span>
      {layersOf(view, level).map((key) => (
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
