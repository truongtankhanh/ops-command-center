import { useEffect, useMemo } from 'react';
import type { ModelClass } from '../lib/twinLoadQueue';
import { type PlacedAsset, visibleAssets } from '../lib/twinPlacement';
import type { TwinFeed } from '../realtime/twinFeed';
import { AssetBoxes } from './AssetBoxes';
import { AssetModel, type ModelInstance } from './AssetModel';
import { instantiate } from './classModel';
import type { ClassPoints } from './useClassPoints';
import { type BoundInstance, useBoundParts } from './useBoundParts';
import { type ModelLookTarget, useModelLooks } from './useAssetLooks';
import { useClassModels } from './useClassModels';

interface EquipmentProps {
  /** Every asset, placed (`useTwinScene`). */
  assets: readonly PlacedAsset[];
  /** The classes that have a model, nearest first (`useTwinScene`). */
  classes: readonly ModelClass[];
  /** Every point of each of those classes (`useClassPoints`), for the bindings. */
  classPoints: ClassPoints;
  /** The telemetry feed the models' bound parts follow; `null` while there is no telemetry client. */
  feed: TwinFeed | null;
}

/**
 * The equipment the canvas draws (V2-14.6 – V2-14.8, frames 03, 08 and 15): a model for each asset whose class's
 * model has arrived, moving with the readings, and the neutral box for every other asset, so a class that is
 * still loading, or failed, or has no model, is a box.
 *
 * It is one component on purpose: the swap from boxes to a model happens in the render in which the class
 * becomes ready, so there is never a frame with both, or with neither. Campus level draws the `outdoor` and
 * `roof` assets (`visibleAssets`); a building in focus will add its `inside` assets (V2-15.8).
 *
 * It makes the model instances and gives the same objects to `AssetModel` (which places them), to
 * `useBoundParts` (which moves their bound parts) and to `useModelLooks` (which paints stale and alarm), and it
 * tells the feed what each ready class binds, so the worker follows those keys. The boxes paint their own
 * looks (`AssetBoxes`). A rebuilt instance starts again from its authored pose and snaps to its first
 * value, which happens when the scene's data changes (the cameras or the assets arrive), not while it runs.
 */
export function Equipment({ assets, classes, classPoints, feed }: EquipmentProps) {
  const ready = useClassModels(classes, classPoints);

  const { boxes, instances, bound, looks } = useMemo(() => {
    const boxes: PlacedAsset[] = [];
    const modelled: PlacedAsset[] = [];
    for (const asset of assets) (ready.has(asset.classCode) ? modelled : boxes).push(asset);

    const instances: ModelInstance[] = [];
    const bound: BoundInstance[] = [];
    const looks: ModelLookTarget[] = [];
    for (const asset of visibleAssets(modelled)) {
      const entry = ready.get(asset.classCode);
      if (entry === undefined) continue;
      const object = instantiate(entry.template);
      instances.push({ assetCode: asset.code, object, pose: asset.pose });
      looks.push({ assetCode: asset.code, object, materials: entry.template.materials });
      if (entry.bindings !== null) {
        bound.push({ assetCode: asset.code, object, bindings: entry.bindings });
      }
    }
    return { boxes, instances, bound, looks };
  }, [assets, ready]);

  // The feed's layout is the bound keys of every asset of a class: it follows what the models say.
  useEffect(() => {
    if (feed === null) return;
    for (const [classCode, { bindings }] of ready) {
      if (bindings !== null) feed.setBindings(classCode, bindings);
    }
  }, [feed, ready]);

  useBoundParts(feed, bound);
  // Every model instance, bound or not, takes the look of its asset's flags (V2-14.9).
  useModelLooks(feed, looks);

  return (
    <>
      <AssetBoxes assets={boxes} feed={feed} />
      <AssetModel instances={instances} />
    </>
  );
}
