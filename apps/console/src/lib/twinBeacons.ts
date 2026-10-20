import type { Asset, Incident, IncidentSeverity, Zone } from '@occ/contracts';
import { isInRing } from './geo';
import { isActive } from './incidents';
import { fanOut, isPulsing, type MarkerType, markerType } from './mapFeatures';
import { footprintRing } from './sitePlan';
import { type Frame, heightOf } from './twinScene';

/*
 * Incidents as beacons in the 3D scene (V2-16.2, ADR-0020 "Settled in V2-16.1" and "Settled in V2-16.2"): the facts the
 * 2D map derives in `mapFeatures.ts`, in scene metres, as plain data. No `three`, no store, no DOM and no preference
 * is read, so the rules are tested without WebGL. Drawing the beacons is V2-16.3's, picking them V2-16.4's; reduced
 * motion (the pulse off) and fading by level are theirs too, because they are not facts about an incident.
 */

/**
 * How a beacon is filled: a disc while the incident is `open`, hollow while it is `acknowledged`, and neutral while it
 * is `resolved` (a resolved incident is drawn only while it is selected, and looks the same whatever its severity, as
 * on the map).
 */
export type BeaconForm = 'filled' | 'hollow' | 'resolved';

export interface Beacon {
  id: string;
  code: string;
  /**
   * Scene metres: `x` east, `y` up, `z` = −north. `y` is the marker's **ground point**, the foot of its stem
   * (`MarkerPlacement` in `twinMarkers.ts`): the top of the asset, the roof, or 0.
   */
  position: [x: number, y: number, z: number];
  severity: IncidentSeverity;
  /** An unknown type (a newer API) is `UNKNOWN_TYPE_IMAGE`, so a beacon always has a glyph. */
  type: MarkerType;
  form: BeaconForm;
  /** Critical, and not resolved: the frames' one larger beacon (the map's 10 / 11 / 12 px discs are the map's). */
  big: boolean;
  /** Critical and open (`isPulsing`, the map's rule). Whether it animates is the drawing's. */
  pulse: boolean;
  /** The code of the asset a telemetry rule raised the incident on (frame 04), else `null`. */
  tag: string | null;
  selected: boolean;
}

export interface BeaconsInput {
  incidents: readonly Incident[];
  /** The selected incident is drawn even when resolved. */
  selectedId: string | null;
  /** The catalogue: an incident names its asset by `id`, and the tag is the asset's code. */
  assets: readonly Asset[];
  zones: readonly Zone[];
  frame: Frame;
  /**
   * The absolute height of an asset's top, if the caller knows better than the catalogue, e.g. the model once it is
   * loaded. Without it, or when it answers `undefined`, the top is the asset's elevation plus its class's footprint
   * height, which is the box the camera fits (the footprint follows the model, ADR-0020 § Model contract).
   */
  assetTopM?: (asset: Asset) => number | undefined;
}

const formOf = (status: Incident['status']): BeaconForm =>
  status === 'open' ? 'filled' : status === 'acknowledged' ? 'hollow' : 'resolved';

/**
 * The roof an incident stands on: its own zone's height when that zone is a building and the incident's position is
 * inside its footprint (the ring `placementOf` tests an asset against, so 2D and 3D agree); else 0. The position is
 * the incident's own and not its fanned-out one, so a stack of incidents spread on a ring stays on the roof.
 */
function roofOf(incident: Incident, zoneById: ReadonlyMap<string, Zone>): number {
  const zone = zoneById.get(incident.zoneId);
  if (zone === undefined || zone.kind !== 'building') return 0;
  const ring = footprintRing(zone);
  return ring !== null && isInRing(incident.position, ring) ? heightOf(zone) : 0;
}

const byCode = (a: Beacon, b: Beacon): number => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

/**
 * One beacon for each incident the 2D map draws: the active ones, plus the selected one even when resolved.
 *
 * - **Where:** `x` and `z` are the map's fanned-out position (`fanOut`, over the drawn set) in the scene's frame, so
 *   incidents that share a point are spread as they are on the map. `y` is the top of the incident's asset when the
 *   catalogue holds it (an `assetId` it does not hold is "no asset"), else the roof (`roofOf`), else 0.
 * - **How:** `form`, `big`, `pulse` and `type` as on the map; `tag` names the asset.
 * - **Order:** by incident `code`, which is unique and does not change when an incident is acknowledged, so a caller
 *   can compare two lists. (`fanOut` keeps its own report-time order internally, which only decides positions.)
 *
 * Nothing in the arguments is changed.
 */
export function beaconsOf({
  incidents,
  selectedId,
  assets,
  zones,
  frame,
  assetTopM,
}: BeaconsInput): Beacon[] {
  const drawn = incidents.filter((incident) => isActive(incident) || incident.id === selectedId);
  const positions = fanOut(drawn);
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));

  return drawn
    .map((incident): Beacon => {
      const asset = incident.assetId ? assetById.get(incident.assetId) : undefined;
      const [x, z] = frame.toLocal(positions.get(incident.id) ?? incident.position);
      const y =
        asset === undefined
          ? roofOf(incident, zoneById)
          : (assetTopM?.(asset) ?? asset.elevationM + asset.class.footprintM.height);
      const form = formOf(incident.status);
      return {
        id: incident.id,
        code: incident.code,
        position: [x, y, z],
        severity: incident.severity,
        type: markerType(incident.type),
        form,
        big: incident.severity === 'critical' && form !== 'resolved',
        pulse: isPulsing(incident),
        tag: asset?.code ?? null,
        selected: incident.id === selectedId,
      };
    })
    .sort(byCode);
}
