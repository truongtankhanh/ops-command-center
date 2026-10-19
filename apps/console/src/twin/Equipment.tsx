import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import type { Binding } from '../lib/twinBindings';
import type { ModelClass } from '../lib/twinLoadQueue';
import { type PlacedAsset, visibleAssets } from '../lib/twinPlacement';
import type { TwinFeed } from '../realtime/twinFeed';
import { AssetBoxes } from './AssetBoxes';
import { AssetModel, type ModelInstance } from './AssetModel';
import { instantiate } from './classModel';
import { usePicker } from './PickContext';
import type { ClassPoints } from './useClassPoints';
import { type BoundInstance, useBoundParts } from './useBoundParts';
import { type ModelLookTarget, useModelLooks } from './useAssetLooks';
import { useClassModels } from './useClassModels';
import { useHoverRef } from './useHoverRef';
import { useIsolation } from './useIsolation';

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
 * `useBoundParts` (which moves their bound parts) and to `useModelLooks` (which paints stale, alarm and hover,
 * V2-15.5, with the nodes the bindings name as the parts a hover can single out), and it tells the feed what
 * each ready class binds, so the worker follows those keys. The boxes paint their own looks (`AssetBoxes`). A rebuilt instance starts again from its authored pose and snaps to its first
 * value, which happens when the scene's data changes (the cameras or the assets arrive), not while it runs.
 *
 * While an asset is isolated (V2-15.7, `useIsolation`) every other asset is faded, boxes and models alike: the
 * boxes by the groups of their mesh, the models by a faded look (`useModelLooks`). Which asset that is is one
 * value here, so the two cannot disagree; the on-demand canvas is asked for a frame when it changes, because the
 * painters only run inside one. What is drawn is unchanged: `inside` assets wait for V2-15.8, so an isolated
 * `inside` asset is not on screen yet.
 */
export function Equipment({ assets, classes, classPoints, feed }: EquipmentProps) {
  const picker = usePicker();
  const hover = useHoverRef();
  const isolation = useIsolation();
  const invalidate = useThree((state) => state.invalidate);
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
      looks.push({
        assetCode: asset.code,
        object,
        materials: entry.template.materials,
        parts: entry.bindings === null ? NO_PARTS : nodesOf(entry.bindings),
      });
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

  // Each instance is registered with the picker (V2-15.3), with the nodes its bindings name: those are its
  // parts (every motion, a tint included); any other mesh of the model is the asset. A rebuilt instance is
  // registered again, and the old one goes.
  useEffect(() => {
    if (picker === null) return;
    const partsOf = new Map(bound.map(({ assetCode, bindings }) => [assetCode, nodesOf(bindings)]));
    const removers = instances.map(({ assetCode, object }) =>
      picker.addModel(assetCode, object, partsOf.get(assetCode) ?? NO_PARTS),
    );
    return () => removers.forEach((remove) => remove());
  }, [picker, instances, bound]);

  // The painters run in a frame, and a change of the isolated asset is not announced by anything they read.
  useEffect(() => {
    invalidate();
  }, [isolation, invalidate]);

  useBoundParts(feed, bound);
  // Every model instance, bound or not, takes the look of its asset's flags, hover and fade (V2-14.9, V2-15.5, V2-15.7).
  useModelLooks(feed, looks, hover, isolation);

  return (
    <>
      <AssetBoxes assets={boxes} feed={feed} hover={hover} isolation={isolation} />
      <AssetModel instances={instances} />
    </>
  );
}

const NO_PARTS: ReadonlySet<string> = new Set();

/** The nodes a class's bindings name: its pickable parts. */
const nodesOf = (bindings: readonly Binding[]): ReadonlySet<string> =>
  new Set(bindings.map(({ node }) => node));
