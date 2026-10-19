import { twinColors } from '../styles/tokens';

/*
 * The console's materials for a model (ADR-0020 § Model contract, "Materials by name"): each glTF material
 * is named for one of these, and the scene replaces what the vendor made with its own, so hover, stale and
 * alarm can tint a part reliably and the vendor supplies baked occlusion only. The colours are the tokens'
 * copies in `twinColors`; the faces' three tones come from the scene's lights, as for the shells. Pure: no
 * `three`, so the table is tested without it.
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

const SPECS: Record<MaterialName, MaterialSpec> = {
  Part: { name: 'Part', color: twinColors.idle.top, opacity: 1 },
  Steel: { name: 'Steel', color: twinColors.steel.top, opacity: 1 },
  Concrete: { name: 'Concrete', color: twinColors.concrete.top, opacity: 1 },
  Rail: { name: 'Rail', color: twinColors.rail, opacity: 1 },
  Screen: { name: 'Screen', color: twinColors.screen, opacity: 1 },
  Blade: { name: 'Blade', color: twinColors.blade, opacity: 1 },
  Hub: { name: 'Hub', color: twinColors.hub, opacity: 1 },
  // The generator's enclosure: the idle material, see-through.
  Xray: { name: 'Xray', color: twinColors.idle.top, opacity: twinColors.xrayOpacity },
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
