import { presenceOf, type SceneFocus } from './twinLevel';
import type { PlacedAsset } from './twinPlacement';

/*
 * What the 3D scene makes of the store's hover (V2-15.5), as plain data: no `three` and no WebGL, so the rules
 * are tested without them. The store holds two fields, `hoveredAssetCode` and `hoveredPart`, written by the
 * pointer (V2-15.4) and by the Assets tab's rows; the paint loops (`twin/useAssetLooks.ts`) and the shell's tint
 * (`twin/Buildings.tsx`) ask the questions below. Only a selected *part* has a look of its own (V2-15.10, the
 * selection below), and an inspected asset keeps its own (frames 03, 08, 15 and 17).
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

/** The selected asset and its selected part's node name, or none: the two store fields of the part level (V2-15.2). */
export interface SelectedPart {
  readonly asset: string | null;
  readonly part: string | null;
}

export const NO_SELECTION: SelectedPart = Object.freeze({ asset: null, part: null });

/**
 * The selected part the store says. A part belongs to the selected asset (the store never holds one without), so no
 * part, or no asset, is no selection: the one shared empty object, which a reader tells apart by identity.
 */
export function selectionOf(state: {
  selectedAssetCode: string | null;
  selectedPart: string | null;
}): SelectedPart {
  if (state.selectedAssetCode === null || state.selectedPart === null) return NO_SELECTION;
  return { asset: state.selectedAssetCode, part: state.selectedPart };
}

/** Why a part node of a model is drawn in a look of its own. */
export type PickedKind = 'hover' | 'selected';

export interface PickedPart {
  readonly node: string;
  readonly kind: PickedKind;
}

/**
 * The part nodes of the model of `assetCode` that take a look of their own (V2-15.5, V2-15.10), at most two: the part
 * the pointer is on (`hover`) and the selected part (`selected`), which keeps its look after the pointer leaves and
 * until it is deselected. A part that is both is `selected` and listed once. `has` says which nodes the model has:
 * a node it does not have is no part and changes nothing (as with a box, which has none), and a hover or a
 * selection of another asset is not this one's.
 */
export function partsPicked(
  assetCode: string,
  hover: HoverState,
  selection: SelectedPart,
  has: (node: string) => boolean,
): PickedPart[] {
  const picked: PickedPart[] = [];
  const selected = selection.asset === assetCode ? selection.part : null;
  if (selected !== null && has(selected)) picked.push({ node: selected, kind: 'selected' });
  const hovered = hover.asset === assetCode ? hover.part : null;
  if (hovered !== null && hovered !== selected && has(hovered)) {
    picked.unshift({ node: hovered, kind: 'hover' });
  }
  return picked;
}

/**
 * The zone whose building takes the hover tint for the hovered asset `code`: its own, when the asset is `inside` a
 * building and the scene does not draw it (`presenceOf` says `hidden`: at campus level, with another building in
 * focus, or, since V2-15.9, in the building in focus with the `Inside` layer off, whose shell is opaque then), because
 * nothing of it is on screen to light (ADR-0020, V2-15.1). `null` for an asset that is drawn (`outdoor`, `roof`, or
 * inside the focused building with the layer on), one the scene does not hold, and no asset. `focus` is the scene's
 * (`useSceneFocus`), `null` at campus level.
 */
export function hoveredShellZone(
  code: string | null,
  placed: readonly PlacedAsset[],
  focus: SceneFocus | null = null,
): string | null {
  if (code === null) return null;
  const asset = placed.find((candidate) => candidate.code === code);
  if (asset === undefined || asset.placement !== 'inside') return null;
  return presenceOf({ kind: 'asset', ...asset }, focus) === 'hidden' ? asset.zoneId : null;
}
