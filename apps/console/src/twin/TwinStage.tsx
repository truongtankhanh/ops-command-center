import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FitBox } from '../lib/twin-core/twinCamera';
import type { LeaderStart } from '../lib/twin-core/twinLeader';
import { assetBoxes, buildingBoxes } from '../lib/twin-core/twinLevelCamera';
import type { ModelClass } from '../lib/twin-core/twinLoadQueue';
import { clearTwinMarks, debugTwinRequested, markTwin } from '../lib/twin-core/twinPerf';
import type { LabelAnchor } from '../lib/twin-core/twinScene';
import { BuildingSummary } from './BuildingSummary';
import { DragHint } from './DragHint';
import { HeatLegend } from './HeatLegend';
import { PanPad } from './PanPad';
import { PickHint } from './PickHint';
import { LeaderOverlay, TwinCallout } from './TwinCallout';
import { TwinCanvas } from './TwinCanvas';
import { TwinControls } from './TwinControls';
import { TwinLegend } from './TwinLegend';
import { TwinTooltip } from './TwinTooltip';
import styles from './TwinStage.module.css';
import { TwinView } from './TwinView';
import { useClassPoints } from './useClassPoints';
import { useHeatScene } from './useHeatScene';
import { useLevelCamera } from './useLevelCamera';
import { useTwinFeed } from './useTwinFeed';
import { useTwinBeacons } from './useTwinBeacons';
import { useTwinHighlightZone } from './useTwinHighlightZone';
import { useTwinScene } from './useTwinScene';
import { ZoneLabels } from './ZoneLabels';

const NO_ANCHORS: LabelAnchor[] = [];
const NO_BOXES: ReadonlyMap<string, FitBox> = new Map();
const NO_CLASSES: ModelClass[] = [];
const NO_INVALIDATE = (): void => undefined;

/**
 * The developer HUD's readout (V2-19.1): development builds only, with a literal `import.meta.env.MODE` at the
 * `import()` so the production build holds neither (see `TwinCanvas`, which has the probe). `?debug=twin` is the other
 * half of the gate.
 */
const HudReadout = import.meta.env.MODE === 'development' ? lazy(() => import('./Hud')) : null;

/**
 * The 3D twin, as the lazy chunk's entry (ADR-0020): `StageView` loads it with `React.lazy` when the
 * 3D view is in effect, so the 2D view, the fallback and the sign-in screens never download three.js.
 * The `Campus 3D view` landmark, the loading placeholder and the load-failure fallback belong to
 * `StageView` (main chunk): this chunk's CSS is not loaded yet while they show.
 *
 * It owns the scene (`useTwinScene`), the points of the classes that have a model (`useClassPoints`, for the
 * bindings of V2-14.7), the incident beacons (`useTwinBeacons`, V2-16.3), the zone outlined on the ground (`useTwinHighlightZone`, V2-16.4) and the telemetry feed the models' moving parts follow (`useTwinFeed`, V2-14.8), and
 * renders the WebGL canvas and the DOM over it as siblings: the zone labels, the drag hint, the legends (the heat legend over the marker legend, V2-17.4), the
 * building summary (V2-15.9, at building level only), the hint while the report's location is picked (V2-16.7), the part callout (V2-15.10, at part level only), the camera
 * controls and the hover tooltip (V2-15.5). The heat overlay (`useHeatScene`, V2-17.3) is derived here too and handed to the canvas, the
 * labels and the view's name; it is `null` until the layer is on at campus or building level. The canvas gets the same scene and the refs for what it keeps in step
 * from its frame loop without a React render: the labels' layer (`LabelProjector`, V2-12.7), the compass
 * (`CompassSync`, V2-12.10) and the part callout's leader (`LeaderProjector`, V2-15.10).
 *
 * For assistive technology the picture is one group (`TwinView`, V2-12.12): the canvas and the labels are
 * inside it, and the canvas is hidden because a summary of the site and the Assets tab are its accessible
 * twin. The controls, the legend and the hint come after the group, so Tab goes from the view to the
 * camera controls to the legend and then leaves the stage.
 *
 * - **On a video wall** (`wall`, V2-21.6, `WallApp`) it is the picture only: the canvas is locked and pinned to a pixel ratio of
 *   1.0 (`TwinCanvas`), the view is not focusable and takes no key (`TwinView`), the wrapper takes no pointer or touch
 *   (`data-still`), and none of the drawn controls is mounted: the drag hint, the pick hint, the legends, the building
 *   summary, the part callout and its leader, the camera controls and the tooltip. The heat overlay is off whatever the layer
 *   says (no switch to turn it on). The Incidents and Cameras layers are the store's, which are on and which a wall has
 *   nothing to change.
 *
 * A default export, the console's exception to named exports: `React.lazy` needs one.
 *
 * Frame demand: none of its own. `invalidateRef` holds the canvas's `invalidate` behind a wrapper that does nothing
 *   while the tab is hidden (V2-19.2); the feed (`useTwinFeed`) and the callout's leader (`onLeaderStart`) ask
 *   through it, each only after a change.
 */
export default function TwinStage({ wall = false }: { wall?: boolean }) {
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
  // The incident beacons (V2-16.3): derived here, from the incidents and the catalogue, for the same reason.
  const beacons = useTwinBeacons(scene);
  // The zone outlined on the ground (V2-16.4): the selected incident's, or the report's while the form is open.
  const highlightZoneId = useTwinHighlightZone(scene);
  // The heat overlay (V2-17.3): `null` unless the layer is on at campus or building level; one object while nothing in it
  // changes, so the canvas, the labels and the view's name do not render for a second that changed nothing.
  const shownHeat = useHeatScene(scene);
  const heat = wall ? null : shownHeat;
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
  // The developer HUD (V2-19.1): the readout is here, its probe in the canvas; the list is theirs to share.
  const hudRef = useRef<HTMLDListElement>(null);
  const [hudRequested] = useState(() => HudReadout !== null && debugTwinRequested(location.search));
  // The load marks of V2-19.7: `twin:data` is the first time this stage has a scene (the queries are shared with
  // the 2D map and can be older than the stage), and the marks are forgotten with the stage.
  const hasScene = scene !== null;
  useEffect(() => {
    if (hasScene) markTwin('twin:data');
  }, [hasScene]);
  useEffect(() => clearTwinMarks, []);
  return (
    <div className={styles.fill}>
      <TwinView heat={heat} wall={wall}>
        {/* The canvas is a picture of what the lists hold; `TwinView` names the group for it. */}
        <div className={styles.fill} data-still={wall ? 'true' : undefined} aria-hidden="true">
          <TwinCanvas
            scene={scene}
            classPoints={classPoints}
            beacons={beacons}
            highlightZoneId={highlightZoneId}
            feed={feed}
            heat={heat}
            boxes={boxes}
            assetBoxes={assetFits}
            onInvalidate={(invalidate) => {
              // A hidden tab queues no frame (V2-19.2): the feed and the callout's leader ask through this.
              invalidateRef.current = () => {
                if (!document.hidden) invalidate();
              };
            }}
            labelLayer={labelLayer}
            compassRef={compass}
            leaderLineRef={leaderLineRef}
            leaderDotRef={leaderDotRef}
            leaderStartRef={leaderStartRef}
            hudRef={hudRef}
            wall={wall}
          />
        </div>
        <ZoneLabels anchors={scene?.anchors ?? NO_ANCHORS} layerRef={labelLayer} heat={heat} />
      </TwinView>
      {!wall && (
        <>
          <DragHint />
          {/* While the report's location is picked (V2-16.7): where to click and how to stop. */}
          <PickHint />
          {/*
          The legends explain what is drawn: with no scene there is nothing to explain (frame 06 has none while loading).
          The heat legend (V2-17.4) is above the marker legend, in one column: the marker legend still explains the
          beacons and the cameras, and at building level it holds the line that says `Esc` returns to the campus.
        */}
          {scene && (
            <div className={styles.legends}>
              {/* The 8-direction pad (V3-29) sits above the legends in the same column, so none of them overlap. */}
              <PanPad />
              <HeatLegend />
              <TwinLegend />
            </div>
          )}
          {/* The card of the building in focus (V2-15.9): nothing at other levels, and nothing before the scene is there. */}
          {scene && <BuildingSummary />}
          {/* The leader of the part callout (V2-15.10) under its card, which shows at part level only. */}
          <LeaderOverlay lineRef={leaderLineRef} dotRef={leaderDotRef} />
          {scene && <TwinCallout onStart={onLeaderStart} />}
          <TwinControls compassRef={compass} />
        </>
      )}
      {hudRequested && HudReadout && (
        <Suspense fallback={null}>
          <HudReadout listRef={hudRef} />
        </Suspense>
      )}
      {/* Last, so it paints over the legend and the controls; it draws nothing until a hover rests (V2-15.5). */}
      {!wall && <TwinTooltip />}
    </div>
  );
}
