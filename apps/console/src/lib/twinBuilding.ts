import type { Asset, Incident, Zone } from '@occ/contracts';
import { type AssetState, matchesAssetFilter } from './assets';
import { compareIncidents, isActive } from './incidents';
import { isStale, staleAfterMs } from './telemetryFreshness';
import type { TelemetryState } from './telemetryState';

/*
 * What the 3D view's building summary says (V2-15.9, frame 12, ADR-0020 "Settled in V2-15.1" and "V2-15.9"), as
 * plain data: no `three`, no store and no clock, so it tests without WebGL. The card (`twin/BuildingSummary.tsx`)
 * only reads this and lays it out. Every number is one the Assets tab or the incident feed already shows, built
 * from their own rules (`assetStates`, `isActive`, `compareIncidents`) so the card and the lists cannot disagree
 * (brief § Principle 1).
 */

/** The point the indoor temperature is read from: the shared key of the air handler and the climate sensor. */
const INDOOR_TEMP_KEY = 'indoorTempC';

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
 * The summary of `zone`. `states` is `assetStates`' answer for `assets`; `overview` and `serverNow` are only needed
 * again for the indoor reading's freshness, which `states` does not carry (a fault hides staleness there).
 *
 * - **Assets without data** are the states the Assets tab's "No data" filter lists (`nodata` and `offline`). A stale
 *   fault reads "fault" in the list, so it counts as reporting here too, although the scene draws it grey: the card
 *   follows the tab, not the scene.
 * - **Incidents** are counted once each, whether they name the zone, an asset of it or both.
 * - **Indoor** is the interim rule until V2-17.2 (`buildingReadings`, which replaces it): every asset of the zone with
 *   an `indoorTempC` point, in code order, the first whose reading is online and not stale on the server clock. A
 *   stale or offline source is skipped, never shown as if it were live; no clock yet cannot judge, and "cannot judge"
 *   is not stale (as `hasDimmedAsset`). The mean of the fresh ones is V2-17.1's proposal, not this rule.
 */
export function buildingSummary(
  zone: Pick<Zone, 'id'>,
  assets: readonly Asset[],
  states: ReadonlyMap<string, AssetState>,
  incidents: readonly Incident[],
  overview: TelemetryState['assets'],
  serverNow: number | null,
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
    indoorC: indoorOf(inZone, overview, serverNow),
  };
}

function indoorOf(
  inZone: readonly Asset[],
  overview: TelemetryState['assets'],
  serverNow: number | null,
): number | null {
  const sources = inZone
    .filter((asset) => asset.headline.some((point) => point.key === INDOOR_TEMP_KEY))
    .sort((a, b) => a.code.localeCompare(b.code));
  for (const asset of sources) {
    const entry = overview[asset.code];
    if (entry === undefined || !entry.online) continue;
    if (serverNow !== null && isStale(entry.receivedAt, staleAfterMs(asset.headline), serverNow)) {
      continue;
    }
    const value = entry.values[INDOOR_TEMP_KEY];
    if (typeof value === 'number') return value;
  }
  return null;
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

/** "22.1 °C": one decimal, as the heat overlay's labels will (V2-17.1). */
export function indoorText(celsius: number): string {
  return `${celsius.toFixed(1)} °C`;
}
