import type { Asset, AssetStatePointKey, Incident, TelemetryValue, Zone } from '@occ/contracts';
import { compareIncidents, fold, isActive } from '../incidents/incidents';
import { statePointOf } from './readings';
import { isStale, staleAfterMs } from '../telemetry/telemetryFreshness';
import type { AssetTelemetryState, TelemetryState } from '../telemetry/telemetryState';

/*
 * What the Assets list and the inspector derive from the catalogue, the incidents and the
 * telemetry the console holds: one state word per asset, the zone groups, search and the place
 * line (V2-09.3). Pure: no store, no timer, no clock. The rules are asset-classes.md
 * § Console presentation, settled in V2-09.1.
 */

/**
 * One word per asset. `unknown` is "no state word": the class has a state point and its value is
 * absent (an older API, or no reading yet). The list never says Running for an asset it does not
 * know.
 */
export type AssetState = 'fault' | 'nodata' | 'offline' | 'standby' | 'running' | 'unknown';

/** The Assets tab's filters. `nodata` holds the stale assets and the offline ones. */
export type AssetFilter = 'all' | 'faults' | 'nodata';

export const ASSET_FILTERS: readonly AssetFilter[] = ['all', 'faults', 'nodata'];

/**
 * Running or Standby from the class's state point. Matching the contract's key union without a
 * default means a key added to `ASSET_STATE_POINT_KEYS` fails to compile here until it is given a
 * meaning, instead of being read as Running.
 */
function stateOfPoint(
  key: AssetStatePointKey,
  value: TelemetryValue | undefined,
): 'running' | 'standby' | 'unknown' {
  switch (key) {
    case 'running':
      return typeof value === 'boolean' ? (value ? 'running' : 'standby') : 'unknown';
    case 'armPosition':
      return typeof value === 'string' ? (value === 'down' ? 'standby' : 'running') : 'unknown';
  }
}

function stateOf(
  asset: Asset,
  hasOpenIncident: boolean,
  entry: AssetTelemetryState | undefined,
  serverNow: number | null,
): AssetState {
  // A fault is never hidden by a stale reading: its values stay drawn as stale (V2-09.1).
  if (hasOpenIncident) return 'fault';
  if (entry === undefined) return 'nodata';
  // The device's last will is a fact; staleness is an inference, and its label says so (V2-08.1).
  if (!entry.online) return 'offline';
  // No server clock yet: nothing can be judged, and "cannot judge" is never stale.
  if (serverNow !== null && isStale(entry.receivedAt, staleAfterMs(asset.headline), serverNow)) {
    return 'nodata';
  }
  const key = statePointOf(asset);
  // A class with no state point is Running whenever nothing above matched.
  return key === null ? 'running' : stateOfPoint(key, entry.values[key]);
}

/**
 * The state of every asset, by asset **code**: fault (an unresolved incident whose `assetId` is
 * the asset) > offline > no data (absent from the overview, or stale) > standby > running.
 * `overview` is the telemetry state's `assets`, and `serverNow` is `useServerNow()`'s value.
 *
 * It changes with the clock, so a caller that renders it every second memoizes on its inputs.
 */
export function assetStates(
  assets: readonly Asset[],
  incidents: readonly Incident[],
  overview: TelemetryState['assets'],
  serverNow: number | null,
): Map<string, AssetState> {
  const withIncident = new Set<string>();
  for (const incident of incidents) {
    if (isActive(incident) && incident.assetId) withIncident.add(incident.assetId);
  }
  const states = new Map<string, AssetState>();
  for (const asset of assets) {
    states.set(
      asset.code,
      stateOf(asset, withIncident.has(asset.id), overview[asset.code], serverNow),
    );
  }
  return states;
}

/**
 * The unresolved incident of `asset`. Among several, the one the feed lists first: most severe,
 * then newest (`compareIncidents`).
 */
export function openIncidentOf(
  asset: Pick<Asset, 'id'>,
  incidents: readonly Incident[],
): Incident | undefined {
  let found: Incident | undefined;
  for (const incident of incidents) {
    if (incident.assetId !== asset.id || !isActive(incident)) continue;
    if (found === undefined || compareIncidents(incident, found) < 0) found = incident;
  }
  return found;
}

/**
 * Whether the asset's reading is current: it has an entry in the overview, its device is online, and the entry
 * is not stale on the server's clock by the asset's own rule (`staleAfterMs`). No server clock yet cannot judge,
 * and "cannot judge" is not stale.
 *
 * It is the bare freshness, not `assetStates`: that puts a fault first, so a stale fault reads "Fault" and an
 * open incident hides how old the reading is. The scene's "not live" look (`hasDimmedAsset`) and the heat
 * overlay's sources (`buildingReadings`, V2-17.2, ADR-0020 "Settled in V2-17.1": "a reading is a reading")
 * both need that, so the test lives here once. `entry` is narrowed, so a caller can read it after the check.
 */
export function hasFreshReading(
  asset: Pick<Asset, 'headline'>,
  entry: AssetTelemetryState | undefined,
  serverNow: number | null,
): entry is AssetTelemetryState {
  if (entry === undefined || !entry.online) return false;
  return serverNow === null || !isStale(entry.receivedAt, staleAfterMs(asset.headline), serverNow);
}

/**
 * Whether any asset is drawn as "not live" in 3D (V2-14.9): it has no entry in the overview, its device is
 * offline, or its latest reading is stale on the server's clock. This is the feed's own rule (`twinFeed.ts`),
 * not `assetStates`, whose fault-first order would call a stale fault "Fault" and hide the legend entry while
 * the asset is grey in the scene. No server clock yet cannot judge, and "cannot judge" is not stale.
 */
export function hasDimmedAsset(
  assets: readonly Asset[],
  overview: TelemetryState['assets'],
  serverNow: number | null,
): boolean {
  return assets.some((asset) => !hasFreshReading(asset, overview[asset.code], serverNow));
}

/** `zone` is `null` for the assets whose zone this console does not have. */
export interface AssetGroup {
  zone: Zone | null;
  assets: Asset[];
}

/**
 * The assets in their zones: groups by zone name A–Z, assets by code within a group, zones with
 * no asset left out. Assets whose `zoneId` is in no zone (the zones still loading, or a zone
 * this console has not got) come last in one group with `zone: null`, so none is hidden.
 */
export function groupByZone(assets: readonly Asset[], zones: readonly Zone[]): AssetGroup[] {
  const known = new Set(zones.map((zone) => zone.id));
  const byZone = new Map<string, Asset[]>();
  const unplaced: Asset[] = [];
  for (const asset of assets) {
    if (!known.has(asset.zoneId)) {
      unplaced.push(asset);
      continue;
    }
    const group = byZone.get(asset.zoneId);
    if (group) group.push(asset);
    else byZone.set(asset.zoneId, [asset]);
  }

  const byCode = (a: Asset, b: Asset) => a.code.localeCompare(b.code);
  const groups = zones
    .filter((zone) => byZone.has(zone.id))
    .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code))
    .map((zone): AssetGroup => ({ zone, assets: (byZone.get(zone.id) ?? []).sort(byCode) }));
  return unplaced.length === 0
    ? groups
    : [...groups, { zone: null, assets: unplaced.sort(byCode) }];
}

/**
 * Whether every search term (`searchTerms(query)`) appears in the asset's name, code or zone name,
 * folded for case and accents as incidents are. No terms match every asset. The line breaks keep a
 * term from spanning two fields.
 */
export function matchesAssetQuery(
  asset: Pick<Asset, 'name' | 'code'>,
  terms: readonly string[],
  zoneName = '',
): boolean {
  if (terms.length === 0) return true;
  const text = fold(`${asset.name}\n${asset.code}\n${zoneName}`);
  return terms.every((term) => text.includes(term));
}

/** Whether an asset in `state` belongs in the tab. `unknown` (and no state at all) is only in `all`. */
export function matchesAssetFilter(state: AssetState | undefined, filter: AssetFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'faults':
      return state === 'fault';
    case 'nodata':
      return state === 'nodata' || state === 'offline';
  }
}

/**
 * How many assets each tab would list, given the filters that apply to every tab (the search and
 * the zone chip, as `matches`). Every filter has a count, as `countByFilter` does for incidents.
 */
export function countAssetFilters(
  assets: readonly Asset[],
  states: ReadonlyMap<string, AssetState>,
  matches: (asset: Asset) => boolean = () => true,
): Record<AssetFilter, number> {
  const counts: Record<AssetFilter, number> = { all: 0, faults: 0, nodata: 0 };
  for (const asset of assets) {
    if (!matches(asset)) continue;
    const state = states.get(asset.code);
    for (const filter of ASSET_FILTERS) {
      if (matchesAssetFilter(state, filter)) counts[filter] += 1;
    }
  }
  return counts;
}

/**
 * The line under an asset's name: its zone, then for a building "roof" when the asset stands at
 * the building's height, or "level n" when its elevation is a multiple of 4 (floors are 4 m apart,
 * ground is level 1). Nothing else is invented: "east yard" is not data. `null` without a zone.
 */
export function placeLabel(
  asset: Pick<Asset, 'elevationM'>,
  zone: Pick<Zone, 'name' | 'kind' | 'heightM'> | undefined,
): string | null {
  if (zone === undefined) return null;
  if (zone.kind !== 'building') return zone.name;
  if (zone.heightM != null && asset.elevationM === zone.heightM) return `${zone.name} · roof`;
  if (asset.elevationM % 4 === 0) return `${zone.name} · level ${asset.elevationM / 4 + 1}`;
  return zone.name;
}
