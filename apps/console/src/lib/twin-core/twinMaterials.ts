import type { IncidentSeverity } from '@occ/contracts';
import { mapColors, twinColors } from '../../styles/tokens';

/*
 * The console's materials for a model (ADR-0020 § Model contract, "Materials by name"): each glTF material
 * is named for one of these, and the scene replaces what the vendor made with its own, so hover, stale and
 * alarm can tint a part reliably and the vendor supplies baked occlusion only. The colours are the tokens'
 * copies in `twinColors`; the faces' three tones come from the scene's lights, as for the shells. Pure: no
 * `three`, so the table is tested without it.
 *
 * It also decides how an asset *looks* (V2-14.9, brief Principles 2 and 3): `lookOf` turns its flags into a face
 * and an edge by the precedence below, and `faceColour` / `edgeColour` give the colours. The appliers
 * (`twin/useAssetLooks.ts`) only paint what this says.
 */

export const MATERIAL_NAMES = [
  'Part',
  'Steel',
  'Concrete',
  'Rail',
  'Screen',
  'Blade',
  'Hub',
  'Xray',
] as const;

export type MaterialName = (typeof MATERIAL_NAMES)[number];

/** What a console material looks like: its colour and how opaque it is (1 is solid). */
export interface MaterialSpec {
  name: MaterialName;
  color: string;
  opacity: number;
}

/**
 * `--tw-xray-opacity`: how opaque a see-through shell is. One value for the model material `Xray` below and for the
 * shell of the building in focus (V2-15.8), so the two cannot drift apart.
 */
export const XRAY_OPACITY = twinColors.xrayOpacity;

const SPECS: Record<MaterialName, MaterialSpec> = {
  Part: { name: 'Part', color: twinColors.idle.top, opacity: 1 },
  Steel: { name: 'Steel', color: twinColors.steel.top, opacity: 1 },
  Concrete: { name: 'Concrete', color: twinColors.concrete.top, opacity: 1 },
  Rail: { name: 'Rail', color: twinColors.rail, opacity: 1 },
  Screen: { name: 'Screen', color: twinColors.screen, opacity: 1 },
  Blade: { name: 'Blade', color: twinColors.blade, opacity: 1 },
  Hub: { name: 'Hub', color: twinColors.hub, opacity: 1 },
  // The generator's enclosure: the idle material, see-through.
  Xray: { name: 'Xray', color: twinColors.idle.top, opacity: XRAY_OPACITY },
};

const isMaterialName = (name: string): name is MaterialName =>
  (MATERIAL_NAMES as readonly string[]).includes(name);

/**
 * The console material for a glTF material's name. An unknown or missing name is `Part` (the checker,
 * `pnpm models:check`, rejects one, but a model that did not go through it must still draw).
 */
export function materialSpec(name: string | undefined): MaterialSpec {
  return SPECS[name !== undefined && isMaterialName(name) ? name : 'Part'];
}

// --- looks (V2-14.9) -----------------------------------------------------------------------------------------

/**
 * The weight of the accent in a hovered or selected material. The `--tw-hover-*` tokens spell it inline
 * (`color-mix(in srgb, var(--accent) 30%, …)`), so there is no token to copy and `scripts/contrast.ts` cannot
 * check it; `twinMaterials.test.ts` checks that it reproduces `twinColors.hover`.
 */
export const HOVER_MIX = 0.3;

const channels = (hex: string): [number, number, number] => {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

/**
 * `over` mixed into `base` by `weight` (0 – 1), as CSS `color-mix(in srgb, over weight, base)`: the same
 * arithmetic and the same rounding as `scripts/contrast.ts` evaluates the tokens with, so what the scene mixes
 * is what the tokens say. Both are `#rrggbb`.
 */
export function mixInto(base: string, over: string, weight: number): string {
  const first = channels(over);
  const second = channels(base);
  const alpha = weight + (1 - weight);
  const hex = (index: 0 | 1 | 2): string =>
    Math.round((first[index] * weight + second[index] * (1 - weight)) / alpha)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(0)}${hex(1)}${hex(2)}`;
}

/**
 * An alarmed material: `--tw-alarm-mix` (35 %) of the incident's severity into `base`. For the idle part
 * material and critical this is `--tw-alarm-top`; the other severities and materials are mixed here, with the
 * same weight, rather than listed as tokens.
 */
export function tintFor(severity: IncidentSeverity, base: string): string {
  return mixInto(base, mapColors.severity[severity], twinColors.alarmMix);
}

/**
 * The dashes of a stale edge, in metres: a stale outline is dashed so that "not live" is told without colour
 * (brief Principle 3). The mockups' `3 3` is in pixels; these are chosen for a part a few metres across and are
 * `unverified` until looked at in a browser (V2-14.9).
 */
export const EDGE_DASH_M = 0.3;
export const EDGE_GAP_M = 0.2;

/** `--tw-ghost-opacity`: how opaque the rest of the campus is while one asset is isolated (V2-15.7). */
export const GHOST_OPACITY = twinColors.ghostOpacity;

export type FaceLook = 'idle' | 'stale' | 'alarm' | 'hover';
export type EdgeLook = 'idle' | 'stale-dashed' | 'severity' | 'accent';

/** What an asset's flags need of a look: the part of the feed's `AssetFlags` that decides it. */
export interface LookFlags {
  stale: boolean;
  online: boolean;
  alarm: IncidentSeverity | null;
}

export interface AssetLook {
  /** Faded to `GHOST_OPACITY` because another asset is isolated (V2-15.7): the face and the edge below stay what they would be. */
  ghost: boolean;
  face: FaceLook;
  edge: EdgeLook;
  /** The open incident's severity, whatever the face and the edge are (an alarmed asset that is hovered keeps it). */
  severity: IncidentSeverity | null;
  /** `false` for a stale or offline asset: it is frozen at its last pose (V2-14.1, `useBoundParts`). */
  motion: boolean;
}

/**
 * How an asset looks. Stale and offline are one look ("offline: same look as stale", brief § Freshness).
 *
 * - **Face**: hovered or selected, then stale, then alarm, then idle. A stale fault is drawn **grey**: "a fault
 *   is never hidden by a stale reading" is kept by the edge, not by a coloured face on data that is not live
 *   (ADR-0020 § State, V2-14.1).
 * - **Edge**: hovered or selected (the accent), then alarm (the severity, solid), then stale (dashed), then
 *   idle. So a stale fault is grey with a solid severity edge.
 * - Severity is the only loud colour (Principle 2) and the dash is how "not live" is told without colour
 *   (Principle 3).
 * - **Ghost** (V2-15.7) is a state, not a colour: an asset faded because another is isolated keeps the face and the
 *   edge its flags give it, so a faded fault is faintly tinted and a faded stale asset faintly grey, and is restored
 *   exactly when the isolation ends. How faint is `GHOST_OPACITY`; whether its outline is drawn is the appliers'.
 */
export function lookOf(
  flags: LookFlags,
  hovered: boolean,
  selected: boolean,
  ghost = false,
): AssetLook {
  const dimmed = flags.stale || !flags.online;
  const picked = hovered || selected;
  const alarmed = flags.alarm !== null;
  return {
    ghost,
    face: picked ? 'hover' : dimmed ? 'stale' : alarmed ? 'alarm' : 'idle',
    edge: picked ? 'accent' : alarmed ? 'severity' : dimmed ? 'stale-dashed' : 'idle',
    severity: flags.alarm,
    motion: !dimmed,
  };
}

/** The colour of a material (`base`, its idle top tone) under a look. A stale material is one grey for all. */
export function faceColour(base: string, look: Pick<AssetLook, 'face' | 'severity'>): string {
  switch (look.face) {
    case 'stale':
      return twinColors.stale.top;
    case 'alarm':
      return look.severity === null ? base : tintFor(look.severity, base);
    case 'hover':
      return mixInto(base, mapColors.accent, HOVER_MIX);
    default:
      return base;
  }
}

/** The colour of an asset's edge under a look. */
export function edgeColour(look: Pick<AssetLook, 'edge' | 'severity'>): string {
  switch (look.edge) {
    case 'stale-dashed':
      return twinColors.staleEdge;
    case 'severity':
      return look.severity === null ? twinColors.edge : mapColors.severity[look.severity];
    case 'accent':
      return mapColors.accent;
    default:
      return twinColors.edge;
  }
}
