import type { Zone } from '@occ/contracts';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { buildingFocusOf } from '../lib/twinLevel';
import { lastPick, onPick, requestPick } from '../lib/twinPicker';
import type { PlacedAsset } from '../lib/twinPlacement';
import { attachPointer } from '../lib/twinPointer';
import { useConsole } from '../store';

interface PointerProps {
  /** Every placed asset: a click on one needs the building its zone is. */
  assets: readonly PlacedAsset[];
  zones: readonly Zone[];
}

/**
 * The pointer of the 3D canvas (V2-15.4; a click on a beacon selects its incident, V2-16.4): hover, click and
 * drag on `gl.domElement`, through the pick seam (`lib/twinPicker.ts`, answered by `PickLayer`) and the store's
 * actions. It renders nothing; the logic is
 * `lib/twinPointer.ts`, which has no `three` and is tested with synthetic events, and this is only the wiring:
 * the canvas element, the store, and the scene's lookup from an asset to its building. The cursor is refreshed
 * when `picking` changes, which no pointer event announces (the report form opening under a still pointer).
 *
 * Not unit-tested: it is R3F glue, and jsdom has no WebGL. Touch is checked by hand.
 */
export function Pointer({ assets, zones }: PointerProps) {
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
      },
    });
    const stopWatching = useConsole.subscribe((state, previous) => {
      if (state.picking !== previous.picking) handle.refresh();
    });
    return () => {
      stopWatching();
      handle.detach();
    };
  }, [element, zoneOfAsset, zones]);

  return null;
}
