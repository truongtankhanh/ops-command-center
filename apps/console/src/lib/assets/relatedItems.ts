import type { Asset, Camera, Incident } from '@occ/contracts';
import { cameraLink, incidentCameras, prioritise, type StripSubject } from '../cameras/cameras';
import { compareIncidents, isActive } from '../incidents/incidents';
import { incidentsOf } from './assetInspector';

/*
 * What the inspector's Related tab lists (V3-09.2; frame 03's "Related 3"): for an incident, the
 * other incidents in its zone, its device and its cameras; for an asset, its incidents, the cameras
 * that see it and the assets beside it. Pure: the caller hands over the lists it holds (the
 * catalogue and the incidents may still be loading, so every lookup can miss).
 */

/** Everything a Related list is picked from. */
export interface RelatedSource {
  incidents: readonly Incident[];
  assets: readonly Asset[];
  cameras: readonly Camera[];
}

export interface RelatedOfIncident {
  /** Other unresolved incidents in the same zone, in the feed's order. */
  incidents: Incident[];
  /** The asset that raised it, when `assetId` resolves in the catalogue. */
  device: Asset | null;
  cameras: Camera[];
  /** The rows the tab lists: the tab's badge. */
  count: number;
}

export interface RelatedOfAsset {
  /** The asset's own unresolved incidents, in the feed's order. */
  incidents: Incident[];
  /** The cameras that see the asset: online before offline, then by code. */
  cameras: Camera[];
  /** The other assets in the same zone, by code. */
  assets: Asset[];
  /** The rows the tab lists: the tab's badge. */
  count: number;
}

/**
 * The incident's Related list. The other incidents are those in its zone that are not resolved
 * (`isActive`, the repo's word for "not resolved"), never the incident itself, most severe then
 * newest, as the feed lists them. The device is the catalogue's asset for `assetId`, and `null`
 * for an incident without one or one the catalogue does not hold (yet): it is never guessed from
 * the zone. The cameras are the Details tab's own (`incidentCameras`: those that see the device
 * first, then the zone's, an offline camera behind the online ones; the zone's alone without a
 * device), with no cap: the sheet shows two tiles, the tab lists them all.
 */
export function relatedOfIncident(
  incident: Pick<Incident, 'id' | 'zoneId' | 'assetId'>,
  { incidents, assets, cameras }: RelatedSource,
): RelatedOfIncident {
  const inZone = (other: Incident) =>
    other.id !== incident.id && other.zoneId === incident.zoneId && isActive(other);
  const others = incidents.filter(inZone).sort(compareIncidents);
  const { assetId } = incident;
  const device = assetId ? (assets.find((asset) => asset.id === assetId) ?? null) : null;
  // `incidentCameras` takes a mutable list and is shared with the sheet, the strip and the wall.
  const covering = incidentCameras(
    [...cameras],
    incident,
    device ?? undefined,
    Number.POSITIVE_INFINITY,
  ).cameras;

  return {
    incidents: others,
    device,
    cameras: covering,
    count: others.length + (device === null ? 0 : 1) + covering.length,
  };
}

/**
 * The asset's Related list: its own unresolved incidents first (`incidentsOf`, so the same ones
 * and the same order as the head's "Fault · INC-…"), then the cameras that see it, then the
 * other assets in its zone. Only a camera that **sees** the asset is listed (`cameraLink` says
 * `asset`), not every camera of the zone: those are the asset's Details tab. An offline camera
 * that sees it is listed, behind the online ones.
 */
export function relatedOfAsset(
  asset: Pick<Asset, 'id' | 'zoneId' | 'position'>,
  { incidents, assets, cameras }: RelatedSource,
): RelatedOfAsset {
  const subject: StripSubject = { kind: 'asset', position: asset.position, zoneId: asset.zoneId };
  const own = incidentsOf(asset, incidents);
  const seeing = prioritise(
    cameras.filter((camera) => cameraLink(camera, subject) === 'asset'),
    subject,
  );
  const siblings = assets
    .filter((other) => other.id !== asset.id && other.zoneId === asset.zoneId)
    .sort((a, b) => a.code.localeCompare(b.code));

  return {
    incidents: own,
    cameras: seeing,
    assets: siblings,
    count: own.length + seeing.length + siblings.length,
  };
}
