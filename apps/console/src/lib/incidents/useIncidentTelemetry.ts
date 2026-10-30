import type { AssetDetail, Incident } from '@occ/contracts';
import { useMemo } from 'react';
import { useAsset, useAssets } from '../../api/queries';

/**
 * What the incident sheet knows about the Telemetry tab (V3-09.6): `none` when the tab is not
 * offered, `loading` while the asset's detail is on its way, `ready` with the detail to draw.
 */
export type TelemetryTabState =
  { status: 'none' } | { status: 'loading' } | { status: 'ready'; detail: AssetDetail };

// Stable, so a sheet whose tab is not offered does not hand a new object on every render.
const NONE: TelemetryTabState = { status: 'none' };
const LOADING: TelemetryTabState = { status: 'loading' };

/**
 * Whether the incident has a Telemetry tab, and the asset detail it draws.
 *
 * It sits **above** the inspector frame because the tab's existence is part of the `tabs` the sheet
 * hands the frame (as the Related count, `useRelatedOfIncident`). The tab is offered only for an
 * incident a telemetry rule raised on an asset (`source === 'telemetry'` and `assetId`, the only
 * source that sets one) that the catalogue has and whose detail can be read. Anything else is
 * `none`, and **no error is drawn for it**: the Details tab's evidence already says "Rule details
 * could not be loaded" and "Raised at …", and a tab that leads to a message would be a second way
 * to say it. A catalogue that has not arrived, or failed, is `none` too: the tab appears with the
 * Related count, which waits for the same list.
 *
 * The detail comes from the cache entry `IncidentEvidence`, `IncidentDevice` and the camera section
 * already hold, so the hook adds no request. A refetch that fails after a first load keeps its data
 * (TanStack keeps it), so a tab that is on screen does not vanish for a blip. `useAsset` is
 * disabled without a code and a disabled query is `pending`, so the catalogue entry comes first.
 */
export function useIncidentTelemetry(
  incident: Pick<Incident, 'source' | 'assetId'> | undefined,
): TelemetryTabState {
  const assets = useAssets();
  const raisedOnAsset = incident?.source === 'telemetry' && Boolean(incident.assetId);
  const code = raisedOnAsset
    ? assets.data?.find((candidate) => candidate.id === incident?.assetId)?.code
    : undefined;
  const { data: detail, isError } = useAsset(code ?? null);

  return useMemo<TelemetryTabState>(() => {
    if (code === undefined) return NONE;
    if (detail !== undefined) return { status: 'ready', detail };
    return isError ? NONE : LOADING;
  }, [code, detail, isError]);
}
