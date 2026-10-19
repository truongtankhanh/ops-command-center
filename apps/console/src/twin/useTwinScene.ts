import type { Asset, Camera, SitePlan, Zone } from '@occ/contracts';
import { useMemo } from 'react';
import { useAssets, useCameras, useSitePlan, useZones } from '../api/queries';
import { type PlacedAsset, placeAssets } from '../lib/twinPlacement';
import {
  type Bounds,
  type Frame,
  type LabelAnchor,
  labelAnchors,
  sceneBounds,
  sceneFrame,
} from '../lib/twinScene';

/** Everything the 3D stage draws from, derived once from the site's reference data. */
export interface TwinScene {
  /** `undefined` when the site plan is not served (404, or a failure): the zones then draw alone. */
  plan: SitePlan | undefined;
  zones: readonly Zone[];
  /** Empty while they load or if they fail: the markers appear when they arrive. */
  cameras: readonly Camera[];
  /**
   * Every asset placed and posed (V2-14.6), `inside` ones included: which of them a level draws is
   * `visibleAssets`'s answer. Empty while the catalogue loads or if it fails.
   */
  assets: readonly PlacedAsset[];
  frame: Frame;
  bounds: Bounds;
  anchors: LabelAnchor[];
}

const NO_ZONES: Zone[] = [];
const NO_CAMERAS: Camera[] = [];
const NO_ASSETS: Asset[] = [];

/**
 * The scene of the 3D stage (V2-12.7, V2-12.8, V2-14.6): the zones, the site plan, the cameras and the
 * assets the 2D map reads (the same queries, no new request), the frame they are drawn in, the box
 * around them and the anchors of the zone labels. The assets are placed here, not in `AssetBoxes`:
 * `<Canvas>` renders in its own reconciler, where a query hook has no client. One hook, read once by `TwinStage`, so
 * the canvas and the DOM labels are made from the same frame and cannot disagree.
 *
 * `null` while there is nothing to draw: the zones are not there yet (or failed: the 2D map has a
 * retry for that, the 3D stage stays empty until V2-12.11) and no plan is served.
 *
 * This is a hook over TanStack Query, so it lives here and not in `lib/`, which is pure.
 */
export function useTwinScene(): TwinScene | null {
  const { data: zones } = useZones();
  const { data: plan } = useSitePlan();
  const { data: cameras } = useCameras();
  const { data: assets } = useAssets();

  return useMemo(() => {
    const list = zones ?? NO_ZONES;
    const frame = sceneFrame(plan, list);
    const bounds = frame && sceneBounds(plan, list, frame);
    if (frame === null || bounds === null) return null;
    return {
      plan,
      zones: list,
      cameras: cameras ?? NO_CAMERAS,
      assets: placeAssets(assets ?? NO_ASSETS, list, frame),
      frame,
      bounds,
      anchors: labelAnchors(list, frame),
    };
  }, [plan, zones, cameras, assets]);
}
