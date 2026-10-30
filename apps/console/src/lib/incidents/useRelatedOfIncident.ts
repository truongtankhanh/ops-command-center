import type { Incident } from '@occ/contracts';
import { useMemo } from 'react';
import { useAssets, useCameras, useIncidents } from '../../api/queries';
import { type RelatedOfIncident, relatedOfIncident } from '../assets/relatedItems';

/** What the incident sheet knows about the Related tab (V3-09.5). */
export type RelatedState =
  { status: 'loading' } | { status: 'failed' } | { status: 'ready'; related: RelatedOfIncident };

// Stable, so a sheet that is still loading does not hand its tab a new object every render.
const LOADING: RelatedState = { status: 'loading' };
const FAILED: RelatedState = { status: 'failed' };

/**
 * The incident's Related list (`relatedOfIncident`) and whether it can be trusted yet.
 *
 * It sits **above** the inspector frame because the tab's count is part of the `tabs` the sheet
 * hands the frame; the tab then gets the same `related` object, so the badge and the rows are one
 * source and cannot disagree. Nothing is read twice: the three lists are the ones the feed, the map
 * and the camera strip already hold, so the sheet adds no request in the app.
 *
 * `loading` until every list the incident needs has arrived, and `failed` when one of them has
 * failed without ever delivering: neither may be told as "nothing is related", which would be a
 * guess drawn as a fact (and a 0 on the tab). A refetch that fails after a first load keeps its
 * data, so the list stays `ready`. The catalogue is needed **only for an incident with an
 * `assetId`**: `relatedOfIncident` finds the device there and nowhere else, so an operator's
 * incident neither waits for the catalogue nor fails with it. The hook still subscribes to it (hooks
 * cannot be conditional); that costs nothing, the catalogue being loaded app-wide.
 *
 * `related` keeps its identity until a list or the incident's zone or asset changes, not on each
 * refetch of the incident's own detail (the `Detail` object is not a dependency).
 */
export function useRelatedOfIncident(
  incident: Pick<Incident, 'id' | 'zoneId' | 'assetId'> | undefined,
): RelatedState {
  const incidents = useIncidents();
  const assets = useAssets();
  const cameras = useCameras();

  const id = incident?.id;
  const zoneId = incident?.zoneId;
  const assetId = incident?.assetId ?? null;
  const needsAssets = assetId !== null;
  const needed = needsAssets ? [incidents, cameras, assets] : [incidents, cameras];
  const failed = needed.some((list) => list.isError && list.data === undefined);

  const incidentList = incidents.data;
  const cameraList = cameras.data;
  const assetList = assets.data;

  return useMemo<RelatedState>(() => {
    if (id === undefined || zoneId === undefined) return LOADING;
    if (failed) return FAILED;
    if (!incidentList || !cameraList || (needsAssets && !assetList)) return LOADING;
    return {
      status: 'ready',
      related: relatedOfIncident(
        { id, zoneId, assetId },
        { incidents: incidentList, assets: assetList ?? [], cameras: cameraList },
      ),
    };
  }, [id, zoneId, assetId, needsAssets, failed, incidentList, assetList, cameraList]);
}
