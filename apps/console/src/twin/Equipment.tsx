import { useMemo } from 'react';
import type { ModelClass } from '../lib/twinLoadQueue';
import { type PlacedAsset, visibleAssets } from '../lib/twinPlacement';
import { AssetBoxes } from './AssetBoxes';
import { AssetModel } from './AssetModel';
import type { ClassPoints } from './useClassPoints';
import { useClassModels } from './useClassModels';

interface EquipmentProps {
  /** Every asset, placed (`useTwinScene`). */
  assets: readonly PlacedAsset[];
  /** The classes that have a model, nearest first (`useTwinScene`). */
  classes: readonly ModelClass[];
  /** Every point of each of those classes (`useClassPoints`), for the bindings. */
  classPoints: ClassPoints;
}

/**
 * The equipment the canvas draws (V2-14.6, V2-14.7, frames 03, 08 and 15): a model for each asset whose class's
 * model has arrived, and the neutral box for every other asset, so a class that is still loading, or failed,
 * or has no model, is a box.
 *
 * It is one component on purpose: the swap from boxes to a model happens in the render in which the class
 * becomes ready, so there is never a frame with both, or with neither. Campus level draws the `outdoor` and
 * `roof` assets (`visibleAssets`); a building in focus will add its `inside` assets (V2-15.8).
 */
export function Equipment({ assets, classes, classPoints }: EquipmentProps) {
  const ready = useClassModels(classes, classPoints);

  const { boxes, models } = useMemo(() => {
    const boxes: PlacedAsset[] = [];
    const modelled: PlacedAsset[] = [];
    for (const asset of assets) (ready.has(asset.classCode) ? modelled : boxes).push(asset);
    const byClass = new Map<string, PlacedAsset[]>();
    for (const asset of visibleAssets(modelled)) {
      const list = byClass.get(asset.classCode) ?? [];
      list.push(asset);
      byClass.set(asset.classCode, list);
    }
    return { boxes, models: byClass };
  }, [assets, ready]);

  return (
    <>
      <AssetBoxes assets={boxes} />
      {[...ready].map(([code, { template }]) => (
        <AssetModel key={code} template={template} assets={models.get(code) ?? []} />
      ))}
    </>
  );
}
