import { useThree } from '@react-three/fiber';
import { type RefObject, useEffect, useMemo } from 'react';
import type { Binding } from '../lib/twinBindings';
import type { LeaderStart } from '../lib/twinLeader';
import type { ModelClass } from '../lib/twinLoadQueue';
import { presenceMap } from '../lib/twinLevel';
import type { PlacedAsset } from '../lib/twinPlacement';
import type { TwinFeed } from '../realtime/twinFeed';
import { AssetBoxes } from './AssetBoxes';
import { AssetModel, type ModelInstance } from './AssetModel';
import { instantiate } from './classModel';
import { usePicker } from './PickContext';
import type { ClassPoints } from './useClassPoints';
import { type BoundInstance, useBoundParts } from './useBoundParts';
import { LeaderProjector } from './LeaderProjector';
import { type ModelLookTarget, useModelLooks } from './useAssetLooks';
import { useClassModels } from './useClassModels';
import { useHoverRef } from './useHoverRef';
import { useSceneFocus } from './useSceneFocus';
import { useSelectedPartRef } from './useSelectedPartRef';

interface EquipmentProps {
  /** Every asset, placed (`useTwinScene`). */
  assets: readonly PlacedAsset[];
  /** The classes that have a model, nearest first (`useTwinScene`). */
  classes: readonly ModelClass[];
  /** Every point of each of those classes (`useClassPoints`), for the bindings. */
  classPoints: ClassPoints;
  /** The telemetry feed the models' bound parts follow; `null` while there is no telemetry client. */
  feed: TwinFeed | null;
  /** The part callout's leader (V2-15.10): the overlay's line and dot, and where the line starts (the card's edge). */
  leaderLineRef: RefObject<SVGLineElement | null>;
  leaderDotRef: RefObject<SVGCircleElement | null>;
  leaderStartRef: RefObject<LeaderStart | null>;
}

/**
 * The equipment the canvas draws (V2-14.6 – V2-14.8, frames 03, 08 and 15): a model for each asset whose class's
 * model has arrived, moving with the readings, and the neutral box for every other asset, so a class that is
 * still loading, or failed, or has no model, is a box.
 *
 * It is one component on purpose: the swap from boxes to a model happens in the render in which the class
 * becomes ready, so there is never a frame with both, or with neither. Which assets a level draws, and how, is
 * `presenceOf`'s (`lib/twinLevel.ts`, V2-15.8): campus level draws the `outdoor` and `roof` assets, a building in
 * focus adds its `inside` ones, and the equipment of the other buildings is faded.
 *
 * It makes the model instances and gives the same objects to `AssetModel` (which places them), to
 * `useBoundParts` (which moves their bound parts) and to `useModelLooks` (which paints stale, alarm and hover,
 * V2-15.5, with the nodes the bindings name as the parts a hover can single out), and it tells the feed what
 * each ready class binds, so the worker follows those keys. The boxes paint their own looks (`AssetBoxes`). A rebuilt instance starts again from its authored pose and snaps to its first
 * value, which happens when the scene's data changes (the cameras or the assets arrive), not while it runs.
 *
 * The focus (`useSceneFocus`) becomes one map of presences, `drawn`, `faded` or `hidden` for every asset, handed to
 * both: the boxes use it for the groups of their mesh and their outlines, the models for a faded look
 * (`useModelLooks`) and for which instances are mounted. Boxes and models read the same map, so they cannot
 * disagree; the on-demand canvas is asked for a frame when it changes, because the painters only run inside one.
 *
 * **A change of focus rebuilds nothing** (V2-15.8, AC3): the boxes' geometry is built once from every box asset and
 * the `inside` ones are left out of its groups, and an instance is made once for every modelled asset (so a bound part
 * keeps its pose) and only mounted, and registered with the picker, while its presence is not `hidden`.
 */
export function Equipment({
  assets,
  classes,
  classPoints,
  feed,
  leaderLineRef,
  leaderDotRef,
  leaderStartRef,
}: EquipmentProps) {
  const picker = usePicker();
  const hover = useHoverRef();
  // The selected part (V2-15.10): the selected look's input here, the leader's when it is mounted below.
  const selection = useSelectedPartRef();
  const focus = useSceneFocus();
  const invalidate = useThree((state) => state.invalidate);
  const ready = useClassModels(classes, classPoints);
  const presences = useMemo(() => presenceMap(assets, focus), [assets, focus]);

  const { boxes, instances, bound, looks } = useMemo(() => {
    const boxes: PlacedAsset[] = [];
    const modelled: PlacedAsset[] = [];
    for (const asset of assets) (ready.has(asset.classCode) ? modelled : boxes).push(asset);

    const instances: ModelInstance[] = [];
    const bound: BoundInstance[] = [];
    const looks: ModelLookTarget[] = [];
    for (const asset of modelled) {
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

  // The instances that are drawn: a `hidden` one (an `inside` asset of a building that is not in focus) is neither
  // mounted nor registered with the picker, but is kept, so its bound parts keep their pose across a focus.
  const shown = useMemo(
    () => instances.filter(({ assetCode }) => presences.get(assetCode) !== 'hidden'),
    [instances, presences],
  );

  // Each drawn instance is registered with the picker (V2-15.3), with the nodes its bindings name: those are its
  // parts (every motion, a tint included); any other mesh of the model is the asset. The registry follows what is
  // drawn: a rebuilt or newly hidden instance is removed, and one that appears is registered.
  useEffect(() => {
    if (picker === null) return;
    const partsOf = new Map(bound.map(({ assetCode, bindings }) => [assetCode, nodesOf(bindings)]));
    const removers = shown.map(({ assetCode, object }) =>
      picker.addModel(assetCode, object, partsOf.get(assetCode) ?? NO_PARTS),
    );
    return () => removers.forEach((remove) => remove());
  }, [picker, shown, bound]);

  // The painters run in a frame, and a change of focus is not announced by anything they read.
  useEffect(() => {
    invalidate();
  }, [presences, invalidate]);

  useBoundParts(feed, bound);
  // Every model instance, bound or not, takes the look of its asset's flags, hover and fade (V2-14.9, V2-15.5, V2-15.7),
  // and its selected part the selected look (V2-15.10).
  useModelLooks(feed, looks, hover, presences, selection);

  return (
    <>
      <AssetBoxes assets={boxes} feed={feed} hover={hover} presences={presences} />
      <AssetModel instances={shown} />
      <LeaderProjector
        instances={shown}
        selection={selection}
        lineRef={leaderLineRef}
        dotRef={leaderDotRef}
        startRef={leaderStartRef}
      />
    </>
  );
}

const NO_PARTS: ReadonlySet<string> = new Set();

/** The nodes a class's bindings name: its pickable parts. */
const nodesOf = (bindings: readonly Binding[]): ReadonlySet<string> =>
  new Set(bindings.map(({ node }) => node));
