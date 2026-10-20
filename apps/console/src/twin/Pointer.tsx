import type { Zone } from '@occ/contracts';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { placePinAt } from '../lib/reportPin';
import { buildingFocusOf } from '../lib/twinLevel';
import { lastPick, onPick, pinUnderPoint, requestPick } from '../lib/twinPicker';
import { setPinDrag } from '../lib/twinPinDrag';
import type { PlacedAsset } from '../lib/twinPlacement';
import { attachPointer } from '../lib/twinPointer';
import type { Frame } from '../lib/twinScene';
import { useConsole } from '../store';

interface PointerProps {
  /** Every placed asset: a click on one needs the building its zone is. */
  assets: readonly PlacedAsset[];
  zones: readonly Zone[];
  /** The scene's frame: a point the pointer picks in metres is a longitude and latitude for the report's pin (V2-16.7). */
  frame: Frame;
}

/**
 * The pointer of the 3D canvas (V2-15.4): hover, click and drag on `gl.domElement`, through the pick seam
 * (`lib/twinPicker.ts`, answered by `PickLayer`) and the store's actions. A click on a beacon selects its incident
 * (V2-16.4); while the report's location is picked a click places its pin and a drag of the pin moves it (V2-16.7). It renders nothing; the logic is
 * `lib/twinPointer.ts`, which has no `three` and is tested with synthetic events, and this is only the wiring:
 * the canvas element, the store, and the scene's lookups (an asset's building; a point's longitude and latitude).
 * The cursor is refreshed when `picking` changes, which no pointer event announces (the report form opening under a
 * still pointer).
 *
 * Not unit-tested: it is R3F glue, and jsdom has no WebGL. Touch is checked by hand.
 */
export function Pointer({ assets, zones, frame }: PointerProps) {
  const element = useThree((state) => state.gl.domElement);
  const zoneOfAsset = useMemo(
    () => new Map(assets.map(({ code, zoneId }) => [code, zoneId])),
    [assets],
  );

  useEffect(() => {
    const store = () => useConsole.getState();
    const handle = attachPointer(element, {
      requestPick,
      onPick,
      lastPick,
      pinAt: pinUnderPoint,
      isPicking: () => store().picking,
      selection: () => ({
        assetCode: store().selectedAssetCode,
        part: store().selectedPart,
        incidentId: store().selectedIncidentId,
      }),
      focusZoneOf: (code) => {
        const zoneId = zoneOfAsset.get(code);
        return zoneId === undefined ? null : buildingFocusOf({ zoneId }, zones);
      },
      actions: {
        hoverAsset: (code) => store().hoverAsset(code),
        hoverPart: (node) => store().hoverPart(node),
        toggleAsset: (code, focusZoneId) => store().toggleAsset(code, focusZoneId),
        selectPart: (node) => store().selectPart(node),
        focusBuilding: (zoneId) => store().focusBuilding(zoneId),
        openViewer: (cameraId) => store().openViewer(cameraId),
        selectIncident: (id) => store().select(id),
        // While a location is picked: the surface point becomes a longitude and latitude and goes through the
        // map's own rule, which selects the zone it is in or reports a miss (V2-16.7).
        placePin: ([x, , z]) => void placePinAt(frame.fromLocal(x, z), zones),
        // Dragging the pin: it follows the pointer as a preview (not a location), and the drop places it by the same
        // rule as a click, which puts it back where it was if the drop is outside every zone (V2-16.7).
        previewPin: ([x, , z]) => setPinDrag({ x, z }),
        dropPin: (point) => {
          setPinDrag(null);
          if (point !== null) void placePinAt(frame.fromLocal(point[0], point[2]), zones);
        },
      },
    });
    const stopWatching = useConsole.subscribe((state, previous) => {
      if (state.picking !== previous.picking) handle.refresh();
    });
    return () => {
      stopWatching();
      handle.detach();
    };
  }, [element, frame, zoneOfAsset, zones]);

  return null;
}
