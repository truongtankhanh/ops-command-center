import { Canvas, useFrame } from '@react-three/fiber';
import { lazy, type RefObject, Suspense, useCallback, useRef, useState } from 'react';
import type { Beacon } from '../lib/twin-core/twinBeacons';
import { type FitBox, HOME_FOV_DEG } from '../lib/twin-core/twinCamera';
import type { HeatScene } from '../lib/twin-core/twinHeat';
import type { LeaderStart } from '../lib/twin-core/twinLeader';
import {
  debugTwinRequested,
  DPR_STEPS,
  markTwin,
  rememberDprStep,
  rememberedDprStep,
  WALL_DPR,
} from '../lib/twin-core/twinPerf';
import type { TwinFeed } from '../realtime/twinFeed';
import { mapColors } from '../styles/tokens';
import { Beacons } from './Beacons';
import { Buildings } from './Buildings';
import { CameraMarkers } from './CameraMarkers';
import { CompassSync } from './CompassSync';
import { ContextGuard } from './ContextGuard';
import { Equipment } from './Equipment';
import { FrameDriver } from './FrameDriver';
import { FrameGuard } from './FrameGuard';
import { Ground } from './Ground';
import { LabelProjector } from './LabelProjector';
import { Lights } from './Lights';
import { MarkerScaleContext, useWallMarkerScale } from './markerScale';
import { PickLayer } from './PickLayer';
import { PixelRatio } from './PixelRatio';
import { Pointer } from './Pointer';
import { ReportPin } from './ReportPin';
import { Rig } from './Rig';
import type { ClassPoints } from './useClassPoints';
import type { TwinScene } from './useTwinScene';
import { ZoneHighlight } from './ZoneHighlight';

/**
 * The lens (V2-12.9): the home view is fitted for this field of view. `far` reaches past the longest distance
 * (900 m) plus the campus's radius with room to spare; `near` is fine from 60 m and for the models at 4 m.
 * Position and target are the rig's.
 */
const LENS = { fov: HOME_FOV_DEG, near: 1, far: 2500 };

/**
 * The developer HUD's probe (V2-19.1): development builds only, so the production build holds neither this `import()`
 * nor the module. The check is a literal `import.meta.env.MODE` here, at the import, on purpose: a helper or a constant
 * imported from another module would not be folded away, and the HUD chunk would ship. `scripts/chunk-budget.ts`
 * fails the build if it did. `?debug=twin` (`debugTwinRequested`) is the other half of the gate.
 */
const HudProbe = import.meta.env.MODE === 'development' ? lazy(() => import('./HudProbe')) : null;

/**
 * Marks the first frame drawn with a scene (`twin:first-frame`, V2-19.7). Mounted with the scene, so the empty canvas's
 * first frame does not count. A `useFrame` subscriber runs just before the frame is rendered: the mark is the frame's
 * start, a few milliseconds before it is on screen.
 */
function FirstFrameMark() {
  const marked = useRef(false);
  useFrame(() => {
    if (marked.current) return;
    marked.current = true;
    markTwin('twin:first-frame');
  });
  return null;
}

interface TwinCanvasProps {
  /** What to draw, from `useTwinScene`; `null` while there is nothing (the canvas stays empty). */
  scene: TwinScene | null;
  /** Every point of each class that has a model (`useClassPoints`), for the models' bindings. */
  classPoints: ClassPoints;
  /** The incident beacons in scene metres (`useTwinBeacons`, the stage's: V2-16.3), drawn once the zones are there. */
  beacons: readonly Beacon[];
  /** The zone outlined on the ground (`useTwinHighlightZone`, the stage's: V2-16.4), or `null` for none. */
  highlightZoneId: string | null;
  /** The telemetry feed the models' bound parts follow (`useTwinFeed`, the stage's); `null` without a telemetry client. */
  feed: TwinFeed | null;
  /** The heat overlay (`useHeatScene`, the stage's: V2-17.3), or `null` while it is not shown. */
  heat: HeatScene | null;
  /** The box of every building (`buildingBoxes`), for the rig's first view when the stage starts at building level (V2-15.6). */
  boxes: ReadonlyMap<string, FitBox>;
  /** The box of every asset (`assetBoxes`), for the rig's first view when the stage starts with an asset isolated (V2-15.7). */
  assetBoxes: ReadonlyMap<string, FitBox>;
  /**
   * Called once the canvas exists with its `invalidate`, which the stage's feed calls when a reading arrives so
   * that the on-demand canvas draws a frame.
   */
  onInvalidate: (invalidate: () => void) => void;
  /** The DOM label layer `ZoneLabels` renders, whose labels `LabelProjector` places. */
  labelLayer: RefObject<HTMLDivElement | null>;
  /** The compass button `TwinControls` renders, which `CompassSync` turns and renames from the camera. */
  compassRef: RefObject<HTMLButtonElement | null>;
  /**
   * The part callout's leader (V2-15.10), which `LeaderProjector` (under `Equipment`) draws from the card to the selected
   * part: the overlay's line and dot (`LeaderOverlay`) and where the line starts, the card's edge.
   */
  leaderLineRef: RefObject<SVGLineElement | null>;
  leaderDotRef: RefObject<SVGCircleElement | null>;
  leaderStartRef: RefObject<LeaderStart | null>;
  /** The developer HUD's description list (`Hud`, V2-19.1), which the probe writes into; unused unless the HUD is on. */
  hudRef: RefObject<HTMLDListElement | null>;
  /**
   * The video wall's canvas (V2-21.6): the rig is locked, the pixel ratio is pinned to 1.0, the markers are drawn at the
   * wall's scale, and nothing that takes input is mounted (`PickLayer`, `Pointer`, `ReportPin`, `CompassSync`).
   */
  wall?: boolean;
}

/**
 * The WebGL canvas of the 3D twin (ADR-0020): the lit campus, its ground, its buildings, its equipment
 * (the class models, and neutral boxes for what has no model yet, V2-14.6, V2-14.7) and its cameras
 * (screen-sized markers), seen through the camera rig (`Rig`). The loading card is `StageView`'s (it shows
 * before this chunk exists).
 *
 * - The scene is a prop. `TwinStage` reads the queries and derives it once (`useTwinScene`, and the classes'
 *   points, `useClassPoints`): `<Canvas>` renders in its own reconciler, so its children are not a safe place
 *   for a query hook, and the DOM labels beside the canvas need the same frame. The telemetry feed is the
 *   stage's too, for the same reason (`useTwinFeed` reads the query cache); the canvas hands its `invalidate`
 *   back through `onInvalidate`, so a reading that arrives wakes the sleeping canvas (V2-14.8).
 * - The incident beacons (V2-16.3) are the stage's too (`useTwinBeacons`): `Beacons` draws them over everything, after the
 *   camera markers, independent of the models, as one draw call, and asks for frames only while one pulses. It sits
 *   inside `PickLayer` (V2-16.4) so that it can register what it draws as picks, tested in screen space before any
 *   geometry; `renderOrder` decides what is painted over what, not the place in the tree.
 * - `ReportPin` draws the report's pin whenever the report form has a position (V2-16.7), over the beacons, as a
 *   screen-sized sprite; it sits inside `PickLayer` so that it can be grabbed while the location is picked.
 * - `ZoneHighlight` outlines the zone of the selected incident, or the report's, on the ground (V2-16.4): a ribbon
 *   after the building faces, with no regard for the Incidents layer.
 * - The camera is the rig's: it sets the first view, moves only on a user action or a command, and a
 *   resting stage draws nothing. It gets the beacons too, so that "Fly to" on a toast can fly to one (V2-16.5).
 * - `Buildings` takes the assets too: the building of a hovered `inside` asset is tinted (V2-15.5). With a building
 *   in focus (V2-15.8) it is see-through and the others are faded, and `Equipment` draws its `inside` equipment;
 *   all of it by the focus the store holds (`useSceneFocus`), with no prop and no rebuild of geometry.
 * - The heat overlay (V2-17.3) is the stage's too (`useHeatScene`, which reads the queries and the telemetry): `Buildings`
 *   colours the shells and fades the ones with no reading, `Equipment` ghosts the equipment that is not in alarm or
 *   hovered. With `null` neither does anything, and in neither case is geometry rebuilt or a mesh added.
 * - `HudProbe` (V2-19.1) measures the frame loop for the developer HUD; it exists in development builds with `?debug=twin`
 *   only, and replaces the draw-call log of V2-15.8. `FirstFrameMark` marks the first frame drawn with a scene (V2-19.7).
 * - `PickLayer` wraps what can be hit (the buildings and the equipment) and casts the pointer's ray, at most one
 *   a frame, against BVH-accelerated meshes (V2-15.3); it draws nothing.
 * - `Pointer` listens to the canvas element for hover, click and drag, and asks `PickLayer` what is under it
 *   (V2-15.4); it renders nothing. While the report's location is picked a click places the pin there (V2-16.7), so
 *   it takes the scene's frame to turn the point into a longitude and latitude.
 * - `ContextGuard` watches the WebGL context: a lost one that does not come back within 5 s ends the 3D
 *   session (V2-12.11).
 * - The leader of the part callout (V2-15.10) is an SVG beside the canvas, drawn by `LeaderProjector` under `Equipment` from
 *   the selected part's bounds on each drawn frame, through refs, with no React render.
 * - The compass is a DOM button beside the canvas; `CompassSync` turns and renames it from the camera on each
 *   drawn frame, through a ref.
 * - The zone labels are DOM elements outside the canvas; `LabelProjector` is the one thing inside it
 *   that touches them, placing them from the camera on each drawn frame.
 * - `frameloop="demand"`: a frame is drawn only when something asks for one (a moving part, an
 *   easing value, the camera), so an idle scene costs nothing. `FrameDriver` (V2-19.2) is the one place that keeps it
 *   going for the loops that sustain themselves (the bound parts and their spin, the fly-to, the beacon pulse); every
 *   other `invalidate` here is a one-shot after a change. Frame demand: `onCreated` hands the stage the raw `invalidate`
 *   (the stage's wrapper is a no-op while the tab is hidden); `FirstFrameMark`, `PixelRatio` and `HudProbe` ask for none.
 * - `dpr={[1, ratio]}`: the pixel ratio starts at 1.5 and never exceeds it (brief § Performance). `PixelRatio` (V2-19.3)
 *   watches the frame times and steps `ratio` down when they run long; it is state here because R3F applies the `dpr`
 *   prop again on every configure, so a ratio set from inside the canvas would be undone by the next render. R3F
 *   clamps the display's ratio into the range, so the canvas draws at `min(devicePixelRatio, ratio)`. The step is
 *   remembered for the life of the page (`rememberDprStep`), so a switch to 2D and back does not start again at 1.5.
 * - **On a video wall** (`wall`, V2-21.6) it draws the picture and takes nothing: no `PickLayer` (what is drawn registers no
 *   pick: `usePicker` is `null` outside one), no `Pointer`, no `ReportPin`, no `CompassSync`, and a locked `Rig` that sets the
 *   home view once and moves only for a command. The pixel ratio starts at `WALL_DPR` and `PixelRatio` is pinned there
 *   (`wall`), whatever the display's ratio, and `FrameGuard` gives the 3D view up for the 2D map when frames stay too slow (V2-21.9); the camera markers and the beacons are drawn at the wall's scale
 *   (`markerScale.ts`), as the DOM labels are by `--ui-scale`.
 * - `flat`: no tone mapping, so the colours on screen are the token colours.
 *
 * R3F sizes the canvas to its parent, so the parent must have a size (`TwinStage`).
 */
export function TwinCanvas({
  scene,
  classPoints,
  beacons,
  highlightZoneId,
  feed,
  heat,
  boxes,
  assetBoxes,
  onInvalidate,
  labelLayer,
  compassRef,
  leaderLineRef,
  leaderDotRef,
  leaderStartRef,
  hudRef,
  wall = false,
}: TwinCanvasProps) {
  const [hudRequested] = useState(() => HudProbe !== null && debugTwinRequested(location.search));
  const [ratio, setRatio] = useState(() =>
    wall ? WALL_DPR : (rememberedDprStep() ?? DPR_STEPS[0] ?? 1.5),
  );
  const markerScale = useWallMarkerScale(wall);
  const onStep = useCallback((step: number) => {
    rememberDprStep(step);
    setRatio(step);
  }, []);
  // What is drawn and can be hit: with a `PickLayer` around it, or on its own on a wall.
  const drawn = scene && (
    <>
      <Buildings zones={scene.zones} frame={scene.frame} assets={scene.assets} heat={heat} />
      <Equipment
        assets={scene.assets}
        classes={scene.classes}
        classPoints={classPoints}
        feed={feed}
        heat={heat}
        leaderLineRef={leaderLineRef}
        leaderDotRef={leaderDotRef}
        leaderStartRef={leaderStartRef}
      />
      <Beacons beacons={beacons} />
    </>
  );
  return (
    <Canvas
      camera={LENS}
      frameloop="demand"
      dpr={[1, ratio]}
      flat
      onCreated={({ invalidate }) => onInvalidate(invalidate)}
    >
      {/* `--surface-0`, a copy kept in step by `scripts/contrast.ts --check` (WebGL cannot read CSS). */}
      <color attach="background" args={[mapColors.ground]} />
      {/* Outside the scene: an empty stage has a context to lose too. */}
      <ContextGuard />
      {hudRequested && HudProbe && (
        <Suspense fallback={null}>
          <HudProbe listRef={hudRef} />
        </Suspense>
      )}
      {scene && (
        <MarkerScaleContext.Provider value={markerScale}>
          <FrameDriver>
            <FirstFrameMark />
            <PixelRatio initial={ratio} onStep={onStep} wall={wall} />
            {wall && <FrameGuard />}
            <Rig
              bounds={scene.bounds}
              boxes={boxes}
              assetBoxes={assetBoxes}
              beacons={beacons}
              locked={wall}
            />
            <Lights />
            <Ground plan={scene.plan} zones={scene.zones} frame={scene.frame} />
            {wall ? (
              drawn
            ) : (
              <PickLayer cameras={scene.cameras} frame={scene.frame}>
                {drawn}
                <ReportPin zones={scene.zones} frame={scene.frame} />
              </PickLayer>
            )}
            {!wall && <Pointer assets={scene.assets} zones={scene.zones} frame={scene.frame} />}
            <ZoneHighlight zones={scene.zones} frame={scene.frame} zoneId={highlightZoneId} />
            <CameraMarkers cameras={scene.cameras} frame={scene.frame} />
            <LabelProjector anchors={scene.anchors} layerRef={labelLayer} />
            {!wall && <CompassSync compassRef={compassRef} />}
          </FrameDriver>
        </MarkerScaleContext.Provider>
      )}
    </Canvas>
  );
}
