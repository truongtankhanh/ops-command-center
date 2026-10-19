import { useCallback, useMemo, useRef } from 'react';
import type { FitBox } from '../lib/twinCamera';
import type { LeaderStart } from '../lib/twinLeader';
import { assetBoxes, buildingBoxes } from '../lib/twinLevelCamera';
import type { ModelClass } from '../lib/twinLoadQueue';
import type { LabelAnchor } from '../lib/twinScene';
import { BuildingSummary } from './BuildingSummary';
import { DragHint } from './DragHint';
import { LeaderOverlay, TwinCallout } from './TwinCallout';
import { TwinCanvas } from './TwinCanvas';
import { TwinControls } from './TwinControls';
import { TwinLegend } from './TwinLegend';
import { TwinTooltip } from './TwinTooltip';
import styles from './TwinStage.module.css';
import { TwinView } from './TwinView';
import { useClassPoints } from './useClassPoints';
import { useLevelCamera } from './useLevelCamera';
import { useTwinFeed } from './useTwinFeed';
import { useTwinScene } from './useTwinScene';
import { ZoneLabels } from './ZoneLabels';

const NO_ANCHORS: LabelAnchor[] = [];
const NO_BOXES: ReadonlyMap<string, FitBox> = new Map();
const NO_CLASSES: ModelClass[] = [];
const NO_INVALIDATE = (): void => undefined;

/**
 * The 3D twin, as the lazy chunk's entry (ADR-0020): `StageView` loads it with `React.lazy` when the
 * 3D view is in effect, so the 2D view, the fallback and the sign-in screens never download three.js.
 * The `Campus 3D view` landmark, the loading placeholder and the load-failure fallback belong to
 * `StageView` (main chunk): this chunk's CSS is not loaded yet while they show.
 *
 * It owns the scene (`useTwinScene`), the points of the classes that have a model (`useClassPoints`, for the
 * bindings of V2-14.7) and the telemetry feed the models' moving parts follow (`useTwinFeed`, V2-14.8), and
 * renders the WebGL canvas and the DOM over it as siblings: the zone labels, the drag hint, the legend, the
 * building summary (V2-15.9, at building level only), the part callout (V2-15.10, at part level only), the camera
 * controls and the hover tooltip (V2-15.5). The canvas gets the same scene and the refs for what it keeps in step
 * from its frame loop without a React render: the labels' layer (`LabelProjector`, V2-12.7), the compass
 * (`CompassSync`, V2-12.10) and the part callout's leader (`LeaderProjector`, V2-15.10).
 *
 * For assistive technology the picture is one group (`TwinView`, V2-12.12): the canvas and the labels are
 * inside it, and the canvas is hidden because a summary of the site and the Assets tab are its accessible
 * twin. The controls, the legend and the hint come after the group, so Tab goes from the view to the
 * camera controls to the legend and then leaves the stage.
 *
 * A default export, the console's exception to named exports: `React.lazy` needs one.
 */
export default function TwinStage() {
  const scene = useTwinScene();
  // The box of every building: the rig's first view reads it, and the camera follows the level with it (V2-15.6).
  const boxes = useMemo(
    () => (scene ? buildingBoxes(scene.zones, scene.frame) : NO_BOXES),
    [scene],
  );
  // The box of every asset: the camera flies to the one that is isolated (V2-15.7).
  const assetFits = useMemo(() => (scene ? assetBoxes(scene.assets) : NO_BOXES), [scene]);
  useLevelCamera(boxes, assetFits);
  // Read here, not in the canvas: a query hook has no client inside `<Canvas>` (V2-14.7).
  const classPoints = useClassPoints(scene?.classes ?? NO_CLASSES);
  // The telemetry feed lives here for the same reason (it reads the query cache). The canvas's `invalidate`
  // only exists once the canvas does, so the feed calls it through a ref the canvas fills (V2-14.8).
  const invalidateRef = useRef<() => void>(NO_INVALIDATE);
  const feed = useTwinFeed({ invalidate: () => invalidateRef.current() });
  const labelLayer = useRef<HTMLDivElement>(null);
  // The part callout's leader (V2-15.10): the overlay's two elements are drawn into by the canvas's writer, and the card
  // reports where the line starts. The refs are this stage's, so no child writes to a ref it was handed; the card's
  // report asks the sleeping canvas for a frame through the `invalidate` it handed back.
  const leaderLineRef = useRef<SVGLineElement>(null);
  const leaderDotRef = useRef<SVGCircleElement>(null);
  const leaderStartRef = useRef<LeaderStart | null>(null);
  const onLeaderStart = useCallback((start: LeaderStart | null) => {
    leaderStartRef.current = start;
    invalidateRef.current();
  }, []);
  const compass = useRef<HTMLButtonElement>(null);
  return (
    <div className={styles.fill}>
      <TwinView>
        {/* The canvas is a picture of what the lists hold; `TwinView` names the group for it. */}
        <div className={styles.fill} aria-hidden="true">
          <TwinCanvas
            scene={scene}
            classPoints={classPoints}
            feed={feed}
            boxes={boxes}
            assetBoxes={assetFits}
            onInvalidate={(invalidate) => {
              invalidateRef.current = invalidate;
            }}
            labelLayer={labelLayer}
            compassRef={compass}
            leaderLineRef={leaderLineRef}
            leaderDotRef={leaderDotRef}
            leaderStartRef={leaderStartRef}
          />
        </div>
        <ZoneLabels anchors={scene?.anchors ?? NO_ANCHORS} layerRef={labelLayer} />
      </TwinView>
      <DragHint />
      {/* The legend explains what is drawn: with no scene there is nothing to explain (frame 06 has none while loading). */}
      {scene && <TwinLegend />}
      {/* The card of the building in focus (V2-15.9): nothing at other levels, and nothing before the scene is there. */}
      {scene && <BuildingSummary />}
      {/* The leader of the part callout (V2-15.10) under its card, which shows at part level only. */}
      <LeaderOverlay lineRef={leaderLineRef} dotRef={leaderDotRef} />
      {scene && <TwinCallout onStart={onLeaderStart} />}
      <TwinControls compassRef={compass} />
      {/* Last, so it paints over the legend and the controls; it draws nothing until a hover rests (V2-15.5). */}
      <TwinTooltip />
    </div>
  );
}
