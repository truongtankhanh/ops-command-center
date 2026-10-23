import type { Zone } from '@occ/contracts';
import { useEffect, useMemo } from 'react';
import { GROUND_LAYERS } from '../lib/twin-core/twinGround';
import type { MarkerPlacement } from '../lib/twin-core/twinMarkers';
import { usePinDrag } from '../lib/twin-core/twinPinDrag';
import { PIN_BELOW_TIP_PX, pinScenePosition } from '../lib/twin-core/twinPin';
import type { Frame } from '../lib/twin-core/twinScene';
import { useConsole } from '../store';
import { Markers } from './Markers';
import { usePicker } from './PickContext';
import { PIN_CELL_ID, usePinTexture } from './usePinTexture';

/** Over the beacons (the ground, the buildings, the camera markers, then the beacons): the pin is what the operator is placing. */
const PIN_ORDER = GROUND_LAYERS.length + 4;

const NO_SPRITES: readonly MarkerPlacement[] = [];

interface ReportPinProps {
  zones: readonly Zone[];
  frame: Frame;
}

/**
 * The report's pin in the 3D scene (V2-16.7, frame 09): the drop of the 2D map's marker, in the accent, a screen-sized
 * sprite on the point so it keeps its size at every zoom (`Markers`, one draw call), over everything. It is drawn
 * whenever the report form is open and there is a position (`reportPosition`), however the position was set: a click
 * on a roof, the lake or the lawn, the zone select, or an asset's preset. It stands at the roof's height when the
 * position is inside a building's footprint and on the ground otherwise (`pinScenePosition`), and on the floor of the
 * building in focus. It survives orbiting because it is a point of the scene, not of the screen.
 *
 * While it is dragged it follows the pointer (`usePinDrag`, a preview held outside the store: the location changes only
 * when it is dropped inside a zone), at the height the same rule gives for the place it is over. While a location is
 * picked its tip is the pin's grab target, registered with the picker as the beacons are, and only if it is drawn.
 *
 * Nothing is drawn with no scene, no position or a closed form. The pin's tip is the sprite's anchor, so the
 * drawing is moved down by the shadow's few pixels.
 *
 * Not unit-tested: it is R3F glue, and jsdom has no WebGL. Its logic is `lib/twin-core/twinPin.ts` and `lib/twin-core/twinPinDrag.ts`.
 */
export function ReportPin({ zones, frame }: ReportPinProps) {
  const reporting = useConsole((state) => state.reporting);
  const position = useConsole((state) => state.reportPosition);
  const picking = useConsole((state) => state.picking);
  const focusZoneId = useConsole((state) => state.focusZoneId);
  const drag = usePinDrag();
  const atlas = usePinTexture();
  const picker = usePicker();

  const sprites = useMemo(() => {
    const shown = drag === null ? position : frame.fromLocal(drag.x, drag.z);
    if (!reporting || shown === null) return NO_SPRITES;
    return [
      {
        id: PIN_CELL_ID,
        position: pinScenePosition(shown, zones, frame, focusZoneId),
        image: PIN_CELL_ID,
        offset: [0, -PIN_BELOW_TIP_PX] as [number, number],
      },
    ];
  }, [reporting, position, drag, zones, frame, focusZoneId]);

  const tip = atlas !== null && picking ? (sprites[0]?.position ?? null) : null;
  useEffect(() => {
    picker?.setPin(tip);
    return () => picker?.setPin(null);
  }, [picker, tip]);

  if (atlas === null || sprites.length === 0) return null;
  return <Markers sprites={sprites} atlas={atlas} visible renderOrder={PIN_ORDER} />;
}
