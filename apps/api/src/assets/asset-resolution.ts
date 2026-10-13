import type { TelemetryRule } from '@occ/contracts';

/**
 * A threshold rule as the API holds it. The contract's `TelemetryRule` is the read model a client
 * sees and has neither `id` nor `assetId` (V2-05.2); resolving needs both, and the incident that a
 * breach raises must point at its rule (V2-07). `TelemetryRuleEntity` satisfies this as it is.
 */
export interface ResolvableRule extends TelemetryRule {
  id: string;
  /** `null` for a class rule; the asset's id for an override of the class rule of that `name`. */
  assetId: string | null;
  enabled: boolean;
}

/**
 * The rules that apply to one asset, given the rules of its class and its own overrides.
 *
 * An override replaces the class rule of the same `name`, and only then are disabled rules
 * dropped, so a disabled override switches that rule off for this asset alone while the class
 * rule keeps applying to every other asset. Filtering `enabled` first would let a disabled
 * override fall away and the class rule alarm again: the one row an operator set to silence it.
 * Anything that raises or evaluates a rule must go through this function, never `WHERE enabled`.
 *
 * Another asset's override in `rules` is ignored, so a caller may pass a wider list. The result is
 * ordered by `name`, whatever the input order, so a response does not depend on the database.
 */
export function resolveAssetRules<R extends ResolvableRule>(
  assetId: string,
  rules: readonly R[],
): R[] {
  const byName = new Map<string, R>();
  for (const rule of rules) {
    if (rule.assetId !== null && rule.assetId !== assetId) continue;
    const current = byName.get(rule.name);
    if (current === undefined || (current.assetId === null && rule.assetId !== null)) {
      byName.set(rule.name, rule);
    }
  }
  return [...byName.values()]
    .filter((rule) => rule.enabled)
    .sort((a, b) => compareStrings(a.name, b.name));
}

/** Larger than any headline rank (1 or 2), so a point that is not a headline sorts after them. */
const NO_HEADLINE_RANK = 3;

/**
 * A class's points in the order a client should list them: the headline points by rank, then the
 * rest by `key`. `telemetry_point` has no ordinal and its rows share one `created_at`, so without
 * this the order would be whatever PostgreSQL returned.
 */
export function orderPoints<P extends { key: string; headline: 1 | 2 | null }>(
  points: readonly P[],
): P[] {
  return [...points].sort(
    (a, b) =>
      (a.headline ?? NO_HEADLINE_RANK) - (b.headline ?? NO_HEADLINE_RANK) ||
      compareStrings(a.key, b.key),
  );
}

/** By code point, not by locale: the order must not change with the host's ICU data. */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}
