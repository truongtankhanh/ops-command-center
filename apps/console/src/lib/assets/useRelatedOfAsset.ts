import type { Asset } from '@occ/contracts';
import { useMemo } from 'react';
import { useAssets, useCameras, useIncidents } from '../../api/queries';
import { type RelatedOfAsset, relatedOfAsset } from './relatedItems';

/** What the asset sheet knows about the Related tab (V3-09.8). */
export type AssetRelatedState =
  { status: 'loading' } | { status: 'failed' } | { status: 'ready'; related: RelatedOfAsset };

// Stable, so a sheet that is still loading does not hand its tab a new object every render.
const LOADING: AssetRelatedState = { status: 'loading' };
const FAILED: AssetRelatedState = { status: 'failed' };

/**
 * The asset's Related list (`relatedOfAsset`) and whether it can be trusted yet.
 *
 * It sits **above** the inspector frame because the tab's count is part of the `tabs` the sheet
 * hands the frame; the tab then gets the same `related` object, so the badge and the rows are one
 * source and cannot disagree (`useRelatedOfIncident` does the same for the incident sheet). Nothing
 * is read twice: the three lists are the ones the feed, the map and the camera strip already hold,
 * so the sheet adds no request in the app.
 *
 * `loading` until every list has arrived, and `failed` when one has failed without ever
 * delivering: neither may be told as "nothing is related", which would be a guess drawn as a fact
 * (and a 0 on the tab). All three are needed here: the asset's incidents, the cameras that see it
 * and, unlike an operator's incident, the catalogue, since the siblings are found nowhere else.
 * A refetch that fails after a first load keeps its data, so the list stays `ready`.
 *
 * `related` keeps its identity until a list or the asset's id, zone or position changes, not on
 * each refetch of the asset's own detail (the `AssetDetail` object is not a dependency).
 */
export function useRelatedOfAsset(
  asset: Pick<Asset, 'id' | 'zoneId' | 'position'> | undefined,
): AssetRelatedState {
  const incidents = useIncidents();
  const assets = useAssets();
  const cameras = useCameras();

  const id = asset?.id;
  const zoneId = asset?.zoneId;
  const position = asset?.position;
  const failed = [incidents, assets, cameras].some(
    (list) => list.isError && list.data === undefined,
  );

  const incidentList = incidents.data;
  const assetList = assets.data;
  const cameraList = cameras.data;

  return useMemo<AssetRelatedState>(() => {
    if (id === undefined || zoneId === undefined || position === undefined) return LOADING;
    if (failed) return FAILED;
    if (!incidentList || !assetList || !cameraList) return LOADING;
    return {
      status: 'ready',
      related: relatedOfAsset(
        { id, zoneId, position },
        { incidents: incidentList, assets: assetList, cameras: cameraList },
      ),
    };
  }, [id, zoneId, position, failed, incidentList, assetList, cameraList]);
}
