import { useRef } from 'react';
import type { LabelAnchor } from '../lib/twinScene';
import { DragHint } from './DragHint';
import { TwinCanvas } from './TwinCanvas';
import { TwinControls } from './TwinControls';
import { TwinLegend } from './TwinLegend';
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
 * It owns the scene (`useTwinScene`) and renders the WebGL canvas and the DOM over it as siblings: the zone
 * labels, the drag hint, the legend and the camera controls. The canvas gets the same scene and two refs
 * for what it keeps in step from its frame loop without a React render: the labels' layer (`LabelProjector`,
 * V2-12.7) and the compass (`CompassSync`, V2-12.10).
 *
 * A default export, the console's exception to named exports: `React.lazy` needs one.
 */
export default function TwinStage() {
  const scene = useTwinScene();
  const labelLayer = useRef<HTMLDivElement>(null);
  const compass = useRef<HTMLButtonElement>(null);
  return (
    <div className={styles.fill}>
      <TwinCanvas scene={scene} labelLayer={labelLayer} compassRef={compass} />
      <ZoneLabels anchors={scene?.anchors ?? NO_ANCHORS} layerRef={labelLayer} />
      <DragHint />
      {/* The legend explains what is drawn: with no scene there is nothing to explain (frame 06 has none while loading). */}
      {scene && <TwinLegend />}
      <TwinControls compassRef={compass} />
    </div>
  );
}
