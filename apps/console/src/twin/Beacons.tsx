import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import type { Beacon } from '../lib/twinBeacons';
import {
  type BeaconTarget,
  beaconCells,
  beaconPlacements,
  beaconTargets,
  pulseRunning,
} from '../lib/twinBeaconSprites';
import { GROUND_LAYERS } from '../lib/twinGround';
import type { MarkerPlacement } from '../lib/twinMarkers';
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';
import { useConsole } from '../store';
import { mapMotion } from '../styles/tokens';
import { useReportFrameDemand } from './FrameDemandContext';
import { Markers } from './Markers';
import { usePicker } from './PickContext';
import { useBeaconAtlas } from './useBeaconAtlas';

/** After the camera markers (the ground, the buildings, then the cameras), so a beacon paints over a camera. */
const BEACONS_ORDER = GROUND_LAYERS.length + 3;

const NO_PLACEMENTS: readonly MarkerPlacement[] = [];
const NO_TARGETS: readonly BeaconTarget[] = [];

/** Sets the clock to `ms`. A function of its own so the frame loop does not write to a value a hook made. */
function advance(clock: { value: number }, ms: number): void {
  clock.value = ms;
}

interface BeaconsProps {
  /** `beaconsOf`'s answer, from the stage (`useTwinBeacons`): a query hook has no client inside `<Canvas>`. */
  beacons: readonly Beacon[];
}

/**
 * The incident beacons (V2-16.3, frames 01, 04, 10 and 11): each active incident, and the selected one even when
 * resolved, as a screen-sized sprite on a stem standing on its ground point, over everything. They use the camera
 * markers' layer (`Markers`) and so draw as **one draw call**; the atlas of their bitmaps is the 2D map's own,
 * packed as forms first appear (`useBeaconAtlas`).
 *
 * - **Never faded, and over all geometry.** An incident is what the console is for, so unlike the camera markers a
 *   beacon is as strong at asset and building level as at campus level, and an incident behind a wall is still seen
 *   (the layer has no depth test). It does not wait for any model: it only needs the zones the stage already has.
 * - **Hidden** when the Incidents layer is off (`layers.incidents`, which selecting an incident turns on); the mesh
 *   stays and is not drawn. Nothing is drawn until the first bitmaps have decoded.
 * - **The pulse** of a critical open incident is the map's wave on a shared clock (`Markers`, `clock`). The canvas
 *   draws on demand, so this reports `demand.pulsing` **only while** the layer is shown, motion is allowed, the tab is
 *   in view and a beacon pulses (`pulseRunning`), and `FrameDriver` asks for the frames; at rest it draws nothing.
 *   Frame demand: conditional (the pulse), plus one `invalidate()` in an effect when the placements or the layer
 *   change and one when the tab comes back. The loop runs at priority −1, below the driver's 0 (V2-19.2).
 *   Under reduced motion the pulse ring is not placed at all: the critical beacon keeps its size and its ring.
 * - No React render per frame: the clock is an object this owns and the frame loop writes.
 * - **Picked in screen space** (V2-16.4). Inside `PickLayer`, this registers with the picker the beacons that are
 *   drawn (`beaconTargets`: a beacon whose bitmap has not decoded yet is not a target) and takes them away when it
 *   goes, so what can be hit is what is seen. Whether they may be hit now (the Incidents layer, an isolated asset, a
 *   location being picked) is the pick scope's (`scopeOf`), read when the ray is cast, so this does not follow it.
 *
 * Fly to is V2-16.5's.
 */
export function Beacons({ beacons }: BeaconsProps) {
  const cells = useMemo(() => beaconCells(beacons), [beacons]);
  const atlas = useBeaconAtlas(cells);
  const shown = useConsole((state) => state.layers.incidents);
  const animate = !usePrefersReducedMotion();
  const invalidate = useThree((state) => state.invalidate);
  const reportDemand = useReportFrameDemand();
  // A loop that goes away must not leave its flag up: nothing would ever write it down, and the driver would draw forever.
  useEffect(
    () => () => {
      reportDemand('pulsing', false);
    },
    [reportDemand],
  );
  const clock = useMemo(() => ({ value: 0 }), []);
  const picker = usePicker();

  const placements = useMemo(
    () =>
      atlas === null
        ? NO_PLACEMENTS
        : beaconPlacements(beacons, atlas.layout, atlas.ratio, { animate }),
    [atlas, beacons, animate],
  );

  const targets = useMemo(() => beaconTargets(beacons, placements), [beacons, placements]);
  useEffect(() => {
    picker?.setBeacons(targets);
    return () => picker?.setBeacons(NO_TARGETS);
  }, [picker, targets]);

  // A change of what is drawn (or a layer switched) needs one frame, and it starts the pulse loop below.
  useEffect(() => {
    invalidate();
  }, [placements, shown, invalidate]);

  // The tab came back: the loop stopped while it was hidden.
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) invalidate();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [invalidate]);

  useFrame((state) => {
    advance(clock, state.clock.getElapsedTime() * 1000);
    reportDemand('pulsing', pulseRunning({ shown, animate, hidden: document.hidden, beacons }));
  }, -1);

  if (atlas === null || placements.length === 0) return null;
  return (
    <Markers
      sprites={placements}
      atlas={atlas}
      visible={shown}
      clock={clock}
      periodMs={mapMotion.pulseMs}
      renderOrder={BEACONS_ORDER}
    />
  );
}
