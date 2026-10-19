import { create } from 'zustand';
import type { ClassProgress } from './twinLoadQueue';

/**
 * How far each equipment model has got (V2-14.7), for the loading card. The twin chunk writes it (the model
 * cache reports a class's bytes and state) and the main chunk reads it (`useTwinLoading`), which is why it
 * lives here and not under `src/twin/`.
 *
 * A store of its own, not part of `useConsole`, as `realtime/telemetryStore.ts` is: bytes arrive at the
 * download's rate, and nothing of that may churn the console's UI state. The writer throttles; `report`
 * ignores a progress equal to the one it holds, so a repeated report renders nothing.
 */
interface TwinModelState {
  /** By `AssetClass.code`. A class that is absent has not been asked for yet. */
  byClass: Readonly<Record<string, ClassProgress>>;
  report(classCode: string, progress: ClassProgress): void;
  /** Forgets everything: the stage that was loading the models is gone. */
  reset(): void;
}

export const useTwinModelStore = create<TwinModelState>((set, get) => ({
  byClass: {},
  report: (classCode, progress) => {
    const known = get().byClass[classCode];
    if (
      known !== undefined &&
      known.state === progress.state &&
      known.loaded === progress.loaded &&
      known.total === progress.total
    ) {
      return;
    }
    set({ byClass: { ...get().byClass, [classCode]: progress } });
  },
  reset: () => {
    if (Object.keys(get().byClass).length > 0) set({ byClass: {} });
  },
}));
