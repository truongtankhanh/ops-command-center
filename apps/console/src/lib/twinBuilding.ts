import type { Asset, Incident, Zone } from '@occ/contracts';
import { type AssetState, matchesAssetFilter } from './assets/assets';
import { compareIncidents, isActive } from './incidents/incidents';
import type { HeatReading } from './twinHeat';

/*
 * What the 3D view's building summary says (V2-15.9, frame 12, ADR-0020 "Settled in V2-15.1" and "V2-15.9"), as
 * plain data: no `three`, no store and no clock, so it tests without WebGL. The card (`twin/BuildingSummary.tsx`)
 * only reads this and lays it out. Every number is one the Assets tab, the incident feed or the heat overlay
 * already shows, built from their own rules (`assetStates`, `isActive`, `compareIncidents`, `buildingReadings`) so
 * the card and the lists cannot disagree (brief § Principle 1).
 */

/** The figures of one building. */
export interface BuildingFigures {
  assets: {
    /** The assets whose zone is the building, outdoor and roof ones included (`GEN-01`), as the Assets tab's zone filter counts. */
    total: number;
    /** Of those, the ones the Assets tab lists under "No data": no reading, offline or stale. */
    noData: number;
  };
  incidents: {
    /** Active incidents (`open` or `acknowledged`, the tiles' rule) raised in the building or at one of its assets. */
    count: number;
    /** The first of them in the feed's order (most severe, then newest); `null` when there is none. */
    firstCode: string | null;
  };
  /** The building's indoor temperature in °C, or `null` when no source of it is fresh. */
  indoorC: number | null;
}

/**
 * The summary of `zone`. `states` is `assetStates`' answer for `assets`, and `reading` is the zone's entry in
 * `buildingReadings` (`undefined` while nothing can be said, as for a zone that is not a building).
 *
 * - **Assets without data** are the states the Assets tab's "No data" filter lists (`nodata` and `offline`). A stale
 *   fault reads "fault" in the list, so it counts as reporting here too, although the scene draws it grey: the card
 *   follows the tab, not the scene.
 * - **Incidents** are counted once each, whether they name the zone, an asset of it or both.
 * - **Indoor** is the heat overlay's number, not a rule of its own (V2-17.2, ADR-0020 "Settled in V2-17.1"): the mean
 *   of the zone's fresh sources, so the card and the overlay show the same figure. A silent building, or no reading
 *   at all, gives `null` and the row is left out; the overlay's "No data" is its own label.
 */
export function buildingSummary(
  zone: Pick<Zone, 'id'>,
  assets: readonly Asset[],
  states: ReadonlyMap<string, AssetState>,
  incidents: readonly Incident[],
  reading: HeatReading | undefined,
): BuildingFigures {
  const inZone = assets.filter((asset) => asset.zoneId === zone.id);
  const noData = inZone.filter((asset) =>
    matchesAssetFilter(states.get(asset.code), 'nodata'),
  ).length;

  const assetIds = new Set(inZone.map((asset) => asset.id));
  const raised = incidents
    .filter(
      (incident) =>
        isActive(incident) &&
        (incident.zoneId === zone.id || (!!incident.assetId && assetIds.has(incident.assetId))),
    )
    .sort(compareIncidents);

  return {
    assets: { total: inZone.length, noData },
    incidents: { count: raised.length, firstCode: raised[0]?.code ?? null },
    indoorC: typeof reading === 'object' ? reading.tempC : null,
  };
}

/**
 * The card's eyebrow, "Building · data center": the zone's `use` as a word (ADR-0021's values are snake_case).
 * A zone with no `use`, which an API before the column never sends, reads "Building"; a value this console does
 * not know is shown as it is, spaced, rather than dropped.
 */
export function buildingEyebrow(zone: Pick<Zone, 'use'>): string {
  const use = zone.use?.replace(/_/g, ' ');
  return use ? `Building · ${use}` : 'Building';
}

/** "8 · all reporting" or "8 · 1 without data"; a building with no asset reads "0". */
export function assetsText({ total, noData }: BuildingFigures['assets']): string {
  if (total === 0) return '0';
  return `${total} · ${noData === 0 ? 'all reporting' : `${noData} without data`}`;
}

/** "1 · INC-000105" (the first in the feed's order), or "None": the row's label already says "Open incidents". */
export function incidentsText({ count, firstCode }: BuildingFigures['incidents']): string {
  return count === 0 || firstCode === null ? 'None' : `${count} · ${firstCode}`;
}
