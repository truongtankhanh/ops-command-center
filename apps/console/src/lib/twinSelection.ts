import type { Asset, Incident } from '@occ/contracts';

/*
 * What `F` flies to (V2-18.2, frame 16): the one choice behind a key that means three things by place (phase-0
 * decision 7). It is a function of what is selected, so there is one handler and no question of which of three
 * registered ones wins. Pure and free of the store and of React, so the rule tests without either; running the
 * flight is `lib/twinFlight.ts`.
 *
 * | Selected                         | Target            | The flight (the same as the control that exists)                    |
 * | -------------------------------- | ----------------- | ------------------------------------------------------------------- |
 * | an asset and one of its parts    | `part`            | "Focus": the part's fit                                             |
 * | an asset                         | `asset`           | "Focus": the asset's fit                                            |
 * | an incident whose asset is known | `incident-asset`  | "Show in 3D": frames the asset, selects nothing                     |
 * | any other incident               | `incident`        | the toast's "Fly to": the incident's beacon                         |
 * | nothing                          | `null`            | none: the key does nothing and no control advertises it             |
 */

/** Where `F` goes, and which flight gets it there. */
export type SelectionTarget =
  | { kind: 'part'; assetCode: string; part: string }
  | { kind: 'asset'; assetCode: string }
  | { kind: 'incident-asset'; assetCode: string }
  | { kind: 'incident'; incidentId: string };

export interface SelectionInput {
  selectedPart: string | null;
  selectedAssetCode: string | null;
  selectedIncidentId: string | null;
  /** The selected incident as the cache has it, `undefined` while it is on its way. */
  incident: Pick<Incident, 'assetId'> | undefined;
  /** The catalogue, `undefined` while it is on its way. */
  assets: readonly Pick<Asset, 'id' | 'code'>[] | undefined;
}

/**
 * The target for what is selected, or `null` when nothing is. The store keeps an asset and an incident exclusive
 * and a part needs its asset, so the order below only matters if that ever changes; it is stated here anyway.
 *
 * An incident goes to its asset only when the catalogue knows it (`assetId` is an id and only a telemetry rule's
 * incident has one). Otherwise, and while the incident's detail or the catalogue is still loading, it goes to the
 * beacon, which every incident the stage draws has: a moment later the same key would choose the asset, which is a
 * flight to the same incident either way.
 */
export function selectionTargetOf({
  selectedPart,
  selectedAssetCode,
  selectedIncidentId,
  incident,
  assets,
}: SelectionInput): SelectionTarget | null {
  if (selectedAssetCode !== null) {
    return selectedPart === null
      ? { kind: 'asset', assetCode: selectedAssetCode }
      : { kind: 'part', assetCode: selectedAssetCode, part: selectedPart };
  }
  if (selectedIncidentId === null) return null;
  const assetId = incident?.assetId;
  const asset = assetId ? assets?.find((candidate) => candidate.id === assetId) : undefined;
  return asset
    ? { kind: 'incident-asset', assetCode: asset.code }
    : { kind: 'incident', incidentId: selectedIncidentId };
}
