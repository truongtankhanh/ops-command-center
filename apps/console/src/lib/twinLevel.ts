import type { Asset, Zone } from '@occ/contracts';

/*
 * The 3D view's four levels as plain data (V2-15.2, ADR-0020 § Scene, "Settled in V2-15.1"): no `three`
 * and no store, so the store, the breadcrumb (V2-15.6) and the scene read one definition and it tests
 * without WebGL. It also holds the visibility rule (V2-15.7: what is drawn as it is and what is faded while an
 * asset is isolated); V2-15.8 extends it to the building level, where faded and hidden become possible.
 */

/** Campus, a building in focus, an isolated asset, a part of it (brief § Scene levels). */
export type SceneLevel = 'campus' | 'building' | 'asset' | 'part';

/** What the level is read from. The level itself is never stored: this is the one place that derives it. */
export interface LevelState {
  /** The building zone in focus, or `null`. */
  focusZoneId: string | null;
  selectedAssetCode: string | null;
  /** A node name of the isolated asset's model. Only means something with an asset selected. */
  selectedPart: string | null;
}

/**
 * `part` when a part of a selected asset is selected, else `asset` when one is, else `building` when a
 * building is in focus, else `campus`. A part with no asset is not a level (the store never holds one), so it
 * reads as the level the rest gives.
 */
export function levelOf({ focusZoneId, selectedAssetCode, selectedPart }: LevelState): SceneLevel {
  if (selectedAssetCode !== null) return selectedPart !== null ? 'part' : 'asset';
  return focusZoneId !== null ? 'building' : 'campus';
}

/**
 * The level one step up, which is the order Escape takes (part → asset → building → campus); `null` at
 * campus, where Escape does nothing.
 */
export function parentOf(level: SceneLevel): SceneLevel | null {
  switch (level) {
    case 'part':
      return 'asset';
    case 'asset':
      return 'building';
    case 'building':
      return 'campus';
    case 'campus':
      return null;
  }
}

/** Where a crumb leads. The part has none: it is the callout, not a place to go back to. */
export type LevelTarget =
  { level: 'campus' } | { level: 'building'; zoneId: string } | { level: 'asset'; code: string };

export interface Crumb {
  label: string;
  target: LevelTarget;
}

/**
 * The breadcrumb for `level`: `Campus › Data Center › CT-01`. The last crumb is where the operator is. The
 * building is there at building level and below when `zone` (the focused one) is known, and an asset outside
 * any building has none (`Campus › TR-01`); a zone the console does not have yet leaves it out rather than
 * showing an id. The asset is labelled by its code, as the frames read, and is left out until it is known.
 */
export function crumbsOf(
  level: SceneLevel,
  zone: Pick<Zone, 'id' | 'name'> | undefined,
  asset: Pick<Asset, 'code'> | undefined,
): Crumb[] {
  const crumbs: Crumb[] = [{ label: 'Campus', target: { level: 'campus' } }];
  if (level === 'campus') return crumbs;
  if (zone) crumbs.push({ label: zone.name, target: { level: 'building', zoneId: zone.id } });
  if (level !== 'building' && asset) {
    crumbs.push({ label: asset.code, target: { level: 'asset', code: asset.code } });
  }
  return crumbs;
}

/**
 * The building to focus when `asset` is selected: its zone's id when that zone is a `building`, else `null`
 * (`GEN-01` stands outside its footprint but its zone is `BLD-DC`; `TR-01` is in the utility plant). The one
 * place that says which zones are buildings for focus. `undefined` zones, the reference data still on its
 * way, give `null`: nothing is focused until the zones are known.
 */
export function buildingFocusOf(
  asset: Pick<Asset, 'zoneId'>,
  zones: readonly Pick<Zone, 'id' | 'kind'>[] | undefined,
): string | null {
  return zones?.find((zone) => zone.id === asset.zoneId)?.kind === 'building' ? asset.zoneId : null;
}

/**
 * What the isolated asset is: its code, and the building in focus, which is drawn with it (an asset's building is
 * not "the rest of the campus"). `zoneId` is `null` for an asset in no building (`TR-01`).
 */
export interface Isolation {
  assetCode: string;
  zoneId: string | null;
}

/**
 * The isolation the level means (V2-15.7): at asset and part level the selected asset and the building in focus,
 * else `null`, where nothing is faded. The one place that says when the rest of the scene recedes.
 */
export function isolationOf(state: LevelState): Isolation | null {
  const level = levelOf(state);
  if ((level !== 'asset' && level !== 'part') || state.selectedAssetCode === null) return null;
  return { assetCode: state.selectedAssetCode, zoneId: state.focusZoneId };
}

/** A thing the scene draws, as far as the fade is concerned. */
export type Fadeable =
  { kind: 'building'; zoneId: string } | { kind: 'asset'; code: string } | { kind: 'marker' };

/**
 * Whether `target` is drawn at `--tw-ghost-opacity` rather than as it is (V2-15.7, ADR-0020 "Settled in V2-15.1":
 * the rest of the campus is faded, not removed). With nothing isolated nothing is faded. Otherwise everything but
 * the isolated asset and its building is: other buildings, other assets, and the camera markers (screen-sized
 * symbols that would otherwise shout over the asset). The ground and the zone labels are not part of this rule.
 */
export function isFaded(target: Fadeable, isolation: Isolation | null): boolean {
  if (isolation === null) return false;
  switch (target.kind) {
    case 'building':
      return target.zoneId !== isolation.zoneId;
    case 'asset':
      return target.code !== isolation.assetCode;
    case 'marker':
      return true;
  }
}

/**
 * The words of the legend while an asset is isolated (frames 03 and 17, "Settled in V2-15.1"): the lead sentence,
 * and where `Esc` goes back to, `null` while the building in focus is not known yet. The key itself is drawn by the
 * legend (`Esc` in a `Kbd`) between the two: "Isolated — the rest of the campus is faded. Esc returns to Data Center".
 */
export function isolationLine(parent: string | null): { lead: string; back: string | null } {
  return {
    lead: 'Isolated — the rest of the campus is faded.',
    back: parent === null ? null : `returns to ${parent}`,
  };
}
