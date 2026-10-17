/*
 * What the 3D stage is waiting for, as plain data (V2-12.11, frame 06): the loading card draws one row per
 * step. The steps are a list, not two fixed rows, so V2-14.7 appends one per equipment model (V2-12.1: there
 * are no rows for buildings, which have no models).
 */

export type StepState = 'done' | 'active' | 'queued' | 'failed';

export interface LoadStep {
  id: string;
  label: string;
  /** Said on the right of the row (frame 06: "from the API", "0.6 / 1.4 MB"). */
  detail: string;
  state: StepState;
}

/** The zones and the site plan the scene is drawn from, as one state. */
export type SitePlanState = 'pending' | 'ready' | 'failed';

/**
 * The steps in the order the card lists them. The site plan is "ready" once the zones are in: the plan
 * itself is decoration and its absence is tolerated everywhere. The code step is `active` until the lazy chunk
 * has arrived; a chunk that cannot be fetched is the error boundary's, not a step's.
 */
export function twinLoadSteps({
  codeLoaded,
  sitePlan,
}: {
  codeLoaded: boolean;
  sitePlan: SitePlanState;
}): LoadStep[] {
  return [
    {
      id: 'site-plan',
      label: 'Site plan',
      detail: sitePlan === 'failed' ? 'couldn’t load' : 'from the API',
      state: sitePlan === 'ready' ? 'done' : sitePlan === 'failed' ? 'failed' : 'active',
    },
    {
      id: 'code',
      label: '3D view code',
      detail: 'from this site',
      state: codeLoaded ? 'done' : 'active',
    },
  ];
}

/**
 * Whether anything is still on its way. A failed step is not: it is waiting for the operator, not for the
 * network, so the stage is not busy.
 */
export const isLoading = (steps: readonly LoadStep[]): boolean =>
  steps.some(({ state }) => state === 'active' || state === 'queued');

/** How much of the work is done, 0 … 1 (1 when there is none). */
export const loadedShare = (steps: readonly LoadStep[]): number =>
  steps.length === 0 ? 1 : steps.filter(({ state }) => state === 'done').length / steps.length;
