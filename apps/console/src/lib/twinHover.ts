import { type PlacedAsset, visibleAssets } from './twinPlacement';

/*
 * What the 3D scene makes of the store's hover (V2-15.5), as plain data: no `three` and no WebGL, so the rules
 * are tested without them. The store holds two fields, `hoveredAssetCode` and `hoveredPart`, written by the
 * pointer (V2-15.4) and by the Assets tab's rows; the paint loops (`twin/useAssetLooks.ts`) and the shell's tint
 * (`twin/Buildings.tsx`) ask the questions below. Selection is not here: only a selected *part* has a look
 * (V2-15.10), and an inspected asset keeps its own (frames 03, 08, 15 and 17).
 */

/** The hovered asset and, when the pointer is on one of its parts, the part's node name. Replaced, never mutated. */
export interface HoverState {
  readonly asset: string | null;
  readonly part: string | null;
}

export const NO_HOVER: HoverState = Object.freeze({ asset: null, part: null });

/** The hover the store says. The pointer writes a part together with its asset; a row writes the asset alone. */
export function hoverOf(state: {
  hoveredAssetCode: string | null;
  hoveredPart: string | null;
}): HoverState {
  if (state.hoveredAssetCode === null && state.hoveredPart === null) return NO_HOVER;
  return { asset: state.hoveredAssetCode, part: state.hoveredPart };
}

/** What a hover means for one asset's drawing. */
export interface AssetHover {
  /** The whole asset takes the hover look. */
  readonly whole: boolean;
  /** The one part that takes it instead (the asset keeps its own look), or `null`. */
  readonly part: string | null;
}

const NOT_HOVERED: AssetHover = Object.freeze({ whole: false, part: null });
const WHOLE: AssetHover = Object.freeze({ whole: true, part: null });

/**
 * How `hover` touches the asset `code`. Another asset, or none, is not hovered. A hovered part is tinted alone:
 * the pointer writes the asset together with its part, and tinting both would leave the part
 * indistinguishable from the body around it (V2-15.5, brief § Hover: "the part takes the hover tint").
 */
export function assetHover(code: string, hover: HoverState): AssetHover {
  if (hover.asset !== code) return NOT_HOVERED;
  return hover.part === null ? WHOLE : { whole: false, part: hover.part };
}

/**
 * The zone whose building takes the hover tint for the hovered asset `code`: its own, when the asset is
 * `inside` a building that is not the one in focus, because nothing of it is drawn then (ADR-0020, V2-15.1).
 * `null` for an asset that is drawn (`outdoor`, `roof`, or inside the focused building), one the scene does
 * not hold, and no asset. Until V2-15.8 draws a building's `inside` assets, `focusedZoneId` is `null`.
 */
export function hoveredShellZone(
  code: string | null,
  placed: readonly PlacedAsset[],
  focusedZoneId: string | null = null,
): string | null {
  if (code === null) return null;
  const asset = placed.find((candidate) => candidate.code === code);
  if (asset === undefined || asset.placement !== 'inside') return null;
  return visibleAssets([asset], focusedZoneId).length === 0 ? asset.zoneId : null;
}
