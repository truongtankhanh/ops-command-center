import { type ResolvableRule, resolveAssetRules } from '../../assets/asset-resolution';
import type { CatalogueAsset } from '../../assets/assets.service';

/**
 * A rule the machine can evaluate, with the interval of the point it watches. Built once per
 * catalogue read, so the per-reading path allocates nothing for it.
 */
export type EvaluableRule = ResolvableRule & { expectedIntervalS: number };

/**
 * The rules to evaluate for one asset, by the `key` they watch, which is how a reading finds them.
 *
 * Which rule applies, and which override silences it, is `resolveAssetRules`' call and is not
 * repeated here (it is idempotent, so `CatalogueAsset.rules`, already resolved, and a raw list of
 * class rules and overrides give the same result). What this adds is the kind check the database
 * does not make: a rule on an `enum` point cannot be compared and is dropped, as is one whose key
 * is not a point of the asset (asset-classes.md: "Enum points have no rules in V2.0").
 *
 * Rules of one key are in name order. `Map`, not an object: a device chooses the keys it sends,
 * and `__proto__` must stay a key.
 */
export function selectEvaluableRules(
  asset: Pick<CatalogueAsset, 'id' | 'points' | 'rules'>,
): Map<string, EvaluableRule[]> {
  const points = new Map(asset.points.map((point) => [point.key, point]));
  const byKey = new Map<string, EvaluableRule[]>();
  for (const rule of resolveAssetRules(asset.id, asset.rules)) {
    const point = points.get(rule.key);
    if (point === undefined || point.kind === 'enum') continue;
    const evaluable: EvaluableRule = { ...rule, expectedIntervalS: point.expectedIntervalS };
    const ofKey = byKey.get(rule.key);
    if (ofKey) ofKey.push(evaluable);
    else byKey.set(rule.key, [evaluable]);
  }
  return byKey;
}
