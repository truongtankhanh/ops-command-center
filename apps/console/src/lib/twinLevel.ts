import type { Asset, Zone } from '@occ/contracts';
import type { PlacedAsset } from './twinPlacement';

/*
 * The 3D view's four levels as plain data (V2-15.2, ADR-0020 § Scene, "Settled in V2-15.1"): no `three`
 * and no store, so the store, the breadcrumb (V2-15.6) and the scene read one definition and it tests
 * without WebGL. It also holds the visibility rule: how every thing the scene draws looks at each level
 * (`presenceOf`, V2-15.8: as it is, faded, see-through or not drawn; V2-15.9 adds the `Inside` layer to it), which the
 * shells, the boxes, the models, the markers, the pick scope and the hover tint all read, so they cannot disagree. `isolationOf` and `Isolation` are the
 * narrower question the legend and the markers ask: is an asset isolated, and which.
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

/**
 * What the scene is looking at (V2-15.8): the building in focus and, at asset and part level, the isolated asset. Unlike
 * `Isolation` it exists at building level too, with no asset, because a focused building changes how everything is
 * drawn (its walls see-through, its inside equipment drawn, the rest faded). `null` is the campus.
 */
export interface SceneFocus {
  /** The building zone in focus; `null` for an isolated asset outside every building (`TR-01`). */
  zoneId: string | null;
  /** The isolated asset, or `null` at building level. */
  assetCode: string | null;
  /**
   * The `Inside` layer (V2-15.9): off draws the focused shell opaque and not the equipment inside it. It is the
   * building level's layer: at asset and part level `focusOf` makes it `true`, because the isolated asset is drawn
   * and the shell stays see-through whatever the operator chose, who finds the layer as they left it on going up.
   */
  inside: boolean;
}

/**
 * The focus the level means: nothing at campus level, the building at building level, the asset (and its building)
 * below. `inside` is the `Inside` layer (it defaults to shown); only building level reads it.
 */
export function focusOf(state: LevelState, inside = true): SceneFocus | null {
  switch (levelOf(state)) {
    case 'campus':
      return null;
    case 'building':
      return { zoneId: state.focusZoneId, assetCode: null, inside };
    case 'asset':
    case 'part':
      return { zoneId: state.focusZoneId, assetCode: state.selectedAssetCode, inside: true };
  }
}

/**
 * How a thing is drawn: `drawn` as it is, `faded` at `--tw-ghost-opacity`, `xray` see-through (the shell of the building
 * in focus), `hidden` not at all (an `inside` asset of a building that is not in focus, or of the one in focus with
 * `Inside` off).
 */
export type Presence = 'drawn' | 'faded' | 'xray' | 'hidden';

/** A thing the scene draws, as far as `presenceOf` is concerned. */
export type Drawable =
  | { kind: 'building'; zoneId: string }
  | { kind: 'asset'; code: string; zoneId: string; placement: PlacedAsset['placement'] }
  | { kind: 'marker' };

/**
 * The one rule for what is drawn and how (V2-15.8, ADR-0020 "Settled in V2-15.8", which replaces V2-15.7's `isFaded`).
 *
 * - **Building:** with nothing in focus as it is; the building in focus is `xray`, at building, asset and part level
 *   (frames 12 and 15), except at building level with `Inside` off, where it is `drawn` (opaque: V2-15.9); every other
 *   building is `faded`. An isolated asset outside every building has no building in focus, so all of them are faded.
 * - **Asset:** an `inside` asset is drawn only with its building in focus, else `hidden` (nothing of it is drawn at
 *   campus level, ADR-0020 "Settled in V2-15.1"), and `hidden` too at building level with `Inside` off (the roof and
 *   outdoor equipment stay). Otherwise, at asset and part level the isolated asset is `drawn` and
 *   every other `faded`; at building level an asset of the building in focus is `drawn` (`GEN-01`, which stands outside
 *   the footprint, and the roof's `CT-01` included, by zone) and every other `faded`.
 * - **Marker:** the camera markers recede only while an asset is isolated, not at building level (the frames' scene
 *   draws them as they are, and the Cameras layer is a toggle of its own).
 *
 * - **Heat** (V2-17.3, ADR-0020 "Settled in V2-17.1"): with the overlay shown, at campus level only, a `drawn` building
 *   with no reading is `faded` and a `drawn` asset that is not `lifted` (in alarm, or hovered) is `faded`. A focus
 *   already says what recedes, and the overlay draws nothing different at building, asset and part level, so with a
 *   focus `heat` changes nothing. `null` (the default) is no overlay: every caller and test keeps its answer.
 *
 * The ground and the zone labels are not part of this rule (the labels fade by `focusZoneId` alone, in `ZoneLabels`).
 */
export function presenceOf(
  target: Drawable,
  focus: SceneFocus | null,
  heat: HeatFade | null = null,
): Presence {
  const presence = presenceWithoutHeat(target, focus);
  if (heat === null || focus !== null || presence !== 'drawn') return presence;
  switch (target.kind) {
    case 'building':
      return heat.silent.has(target.zoneId) ? 'faded' : presence;
    case 'asset':
      return heat.lifted.has(target.code) ? presence : 'faded';
    case 'marker':
      return presence;
  }
}

/**
 * What the heat overlay changes about how things are drawn at campus level (V2-17.3): the zones whose building has no
 * reading (`silent`, faded) and the asset codes that stay as they are although the rest of the equipment recedes
 * (`lifted`: an open incident of their own, or the one under the pointer). Built from `HeatScene` (`lib/twinHeat.ts`)
 * and the hover; it is `null` while the overlay is not shown.
 */
export interface HeatFade {
  silent: ReadonlySet<string>;
  lifted: ReadonlySet<string>;
}

function presenceWithoutHeat(target: Drawable, focus: SceneFocus | null): Presence {
  switch (target.kind) {
    case 'building':
      if (focus === null) return 'drawn';
      if (target.zoneId !== focus.zoneId) return 'faded';
      return insideOff(focus) ? 'drawn' : 'xray';
    case 'asset':
      if (target.placement === 'inside' && (target.zoneId !== focus?.zoneId || insideOff(focus))) {
        return 'hidden';
      }
      if (focus === null) return 'drawn';
      if (focus.assetCode !== null) return target.code === focus.assetCode ? 'drawn' : 'faded';
      return target.zoneId === focus.zoneId ? 'drawn' : 'faded';
    case 'marker':
      return focus !== null && focus.assetCode !== null ? 'faded' : 'drawn';
  }
}

/** `Inside` is off and nothing is isolated: building level, the only level that layer governs. */
const insideOff = (focus: SceneFocus | null): boolean =>
  focus !== null && focus.assetCode === null && !focus.inside;

/**
 * The presence of every placed asset, by code: one map per change of focus (or of the heat overlay), shared by the
 * boxes and the models.
 */
export function presenceMap(
  assets: readonly Pick<PlacedAsset, 'code' | 'zoneId' | 'placement'>[],
  focus: SceneFocus | null,
  heat: HeatFade | null = null,
): Map<string, Presence> {
  return new Map(
    assets.map(({ code, zoneId, placement }) => [
      code,
      presenceOf({ kind: 'asset', code, zoneId, placement }, focus, heat),
    ]),
  );
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

/**
 * The words of the legend at building level (frame 12, ADR-0020 "Settled in V2-15.1" and "V2-15.8"): the lead sentence,
 * and where `Esc` goes back to, which is always the campus (a building's parent). The key is drawn by the legend
 * between the two: "Walls see-through, other buildings faded. Esc returns to Campus". At asset level the isolation
 * line is shown instead (V2-15.7); frame 15's use of this line there is a "Frames to revise" row.
 */
export function buildingLine(): { lead: string; back: string } {
  return { lead: 'Walls see-through, other buildings faded.', back: 'returns to Campus' };
}
