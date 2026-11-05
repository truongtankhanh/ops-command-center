/*
 * The quality tiers of the 3D view (V3-11.3, brief § Quality tiers and § Status bar): High holds the whole look, Standard
 * steps down when frames run long, Low is V2's look and the fallback. Deciding the tier is V3-18's; until then the store
 * holds `'high'` and nothing moves it, so V3-11.2's HUD row, V3-12.4's shadow and the status bar read one field instead
 * of inventing their own.
 *
 * Main-chunk code: the store imports the type, so it lives here and never imports `src/twin/` or `three`. The store's
 * tier is not the `data-twin-tier` attribute on the root (V3-04.1's contract in `tokens.css`, which turns the panels'
 * blur on); only V3-18.3 sets that.
 */

/** The tiers from the richest down: the order V3-18 steps through. */
export const TWIN_TIERS = ['high', 'standard', 'low'] as const;

export type TwinTier = (typeof TWIN_TIERS)[number];

/** A `Record` over the union, so a tier added to the list cannot lack its word. */
const TIER_WORDS: Record<TwinTier, string> = { high: 'High', standard: 'Standard', low: 'Low' };

/** The tier's word, as the status bar ("3D · High") and the developer HUD say it. */
export function tierWord(tier: TwinTier): string {
  return TIER_WORDS[tier];
}
