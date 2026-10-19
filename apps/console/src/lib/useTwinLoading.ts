import type { Asset, Zone } from '@occ/contracts';
import { useAssets, useSitePlan, useZones } from '../api/queries';
import { isLoading, type LoadStep, type SitePlanState, twinLoadSteps } from './twinLoading';
import { loadTarget, modelClasses, modelSteps } from './twinLoadQueue';
import { useTwinModelStore } from './twinModelStore';

const NO_ASSETS: Asset[] = [];
const NO_ZONES: Zone[] = [];

export interface TwinLoading {
  steps: LoadStep[];
  /** Something is still on its way: the stage is busy. A failed step is not on its way. */
  loading: boolean;
  /** Asks again for what failed. */
  retry(): void;
  /** That request is under way. */
  retrying: boolean;
}

/**
 * What the 3D stage waits for (V2-12.11): the steps of the loading card, from the status of the queries the
 * scene is drawn from (the same cache the 2D map uses, no request of its own) and from whether the lazy chunk
 * has arrived, which only the caller can know.
 *
 * The site plan step follows the zones: a failed zones query is a failed step, because the scene cannot be
 * drawn without them; a plan that did not load is not (`useSitePlan` leaves its data empty and the zones draw
 * alone, as on the 2D map). A query that is retrying is still pending, so the step stays active until the
 * client has given up. Retry asks the zones again.
 *
 * From V2-14.7 one more row per equipment model follows (`modelSteps`): the classes come from the assets the
 * 2D map reads and their bytes from `useTwinModelStore`, which the twin chunk writes. They are added once the
 * site plan is ready, never while it is pending or has failed: the models are not asked for before the scene
 * exists, so a row queued behind a failed plan would keep the stage "busy" for ever. A model that failed is
 * a finished row (the asset keeps its box), so it never holds the card up.
 *
 * In `lib/` with the other hooks, and used by `StageView` (main chunk), which has to show the card before the
 * twin chunk exists.
 */
export function useTwinLoading(codeLoaded: boolean): TwinLoading {
  const zones = useZones();
  const plan = useSitePlan();
  const sitePlan: SitePlanState = zones.isError
    ? 'failed'
    : zones.isPending || plan.isPending
      ? 'pending'
      : 'ready';
  const assets = useAssets();
  const progress = useTwinModelStore((state) => state.byClass);
  const models =
    sitePlan === 'ready'
      ? modelSteps(
          modelClasses(assets.data ?? NO_ASSETS, loadTarget(plan.data, zones.data ?? NO_ZONES)),
          progress,
        )
      : [];
  const steps = [...twinLoadSteps({ codeLoaded, sitePlan }), ...models];

  return {
    steps,
    loading: isLoading(steps),
    retry: () => {
      void zones.refetch();
    },
    retrying: zones.isFetching,
  };
}
