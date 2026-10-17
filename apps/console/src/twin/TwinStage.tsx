import { useRef } from 'react';
import type { LabelAnchor } from '../lib/twinScene';
import { TwinCanvas } from './TwinCanvas';
import styles from './TwinStage.module.css';
import { useTwinScene } from './useTwinScene';
import { ZoneLabels } from './ZoneLabels';

const NO_ANCHORS: LabelAnchor[] = [];

/**
 * The 3D twin, as the lazy chunk's entry (ADR-0020): `StageView` loads it with `React.lazy` when the
 * 3D view is in effect, so the 2D view, the fallback and the sign-in screens never download three.js.
 * The `Campus 3D view` landmark, the loading placeholder and the load-failure fallback belong to
 * `StageView` (main chunk): this chunk's CSS is not loaded yet while they show.
 *
 * It owns the scene (`useTwinScene`) and renders the WebGL canvas and the DOM zone labels over it as
 * siblings, handing both the same scene and the labels' layer to the canvas's projector (V2-12.7).
 *
 * A default export, the console's exception to named exports: `React.lazy` needs one.
 */
export default function TwinStage() {
  const scene = useTwinScene();
  const labelLayer = useRef<HTMLDivElement>(null);
  return (
    <div className={styles.fill}>
      <TwinCanvas scene={scene} labelLayer={labelLayer} />
      <ZoneLabels anchors={scene?.anchors ?? NO_ANCHORS} layerRef={labelLayer} />
    </div>
  );
}
