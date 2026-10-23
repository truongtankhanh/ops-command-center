import type { Asset, IncidentCategory, IncidentType, LngLat, Zone } from '@occ/contracts';
import { zoneAt } from './geo';
import { REPORT_TITLE_MAX } from './incidents/incidents';

/*
 * What the report form starts with when an operator reports a fault from an asset's inspector
 * (V2-09.10). Pure: no store, no React, so the zone and pin rule is testable alone.
 */

/** What the report form opens with. `zoneId` and `position` are the map's, the rest the form's. */
export interface ReportPreset {
  /** `null` when the console cannot say the asset's zone: the operator chooses it. */
  zoneId: string | null;
  /** The asset's own position, only when it lies in `zoneId`; `null` lets the API use the centre. */
  position: LngLat | null;
  category: IncidentCategory;
  type: IncidentType;
  title: string;
}

// A fault in equipment is a Facilities incident (ADR-0021); the request carries the type only and
// the API derives the category, which is shown here so the form starts on the right step.
const FAULT_CATEGORY: IncidentCategory = 'facilities';
const FAULT_TYPE: IncidentType = 'equipment_fault';

const TITLE_PREFIX = 'Fault — ';

/**
 * "Fault — Cooling tower 1 (CT-01)". The incident is not linked to the asset (the request has no
 * `assetId`), so the tag in the title is the only trace of which asset it was. A name too long for
 * the limit is cut with "…" and the tag stays.
 */
function faultTitle(name: string, code: string): string {
  const tag = ` (${code})`;
  const room = REPORT_TITLE_MAX - TITLE_PREFIX.length - tag.length;
  const shown = name.length <= room ? name : `${name.slice(0, Math.max(room - 1, 0)).trimEnd()}…`;
  return `${TITLE_PREFIX}${shown}${tag}`;
}

/**
 * The preset for reporting a fault on `asset`. The zone is the asset's, when the console has it in
 * `zones` (still loading, or a zone it does not know, leaves the operator to choose). The pin is
 * the asset's position **only** when it lies inside that zone: the API answers `400` for a pin
 * outside the zone it is sent with, and an asset can stand beside its zone (GEN-01 is 3 m outside
 * the data center), in which case the report is placed at the zone's centre.
 */
export function reportPresetOf(
  asset: Pick<Asset, 'name' | 'code' | 'zoneId' | 'position'>,
  zones: readonly Zone[] | undefined,
): ReportPreset {
  const known = zones?.some((zone) => zone.id === asset.zoneId) ?? false;
  const zoneId = known ? asset.zoneId : null;
  const inside =
    zoneId !== null && zones !== undefined && zoneAt(asset.position, zones)?.id === zoneId;
  return {
    zoneId,
    position: inside ? asset.position : null,
    category: FAULT_CATEGORY,
    type: FAULT_TYPE,
    title: faultTitle(asset.name, asset.code),
  };
}
