import { createContext, useContext } from 'react';
import type { FrameReport } from '../lib/twinPerf';

/**
 * The reporter `FrameDriver` makes (V2-19.2), for the loops that keep the on-demand canvas drawing: `useBoundParts`,
 * `Rig`'s fly-to and `Beacons`' pulse call it in the frame they run to say whether their field of the demand is up.
 * `null` outside a driver. Beside the provider's file, as `PickContext.ts` is, so React Fast Refresh keeps the
 * component and the context apart.
 */
export const FrameDemandContext = createContext<FrameReport | null>(null);

/** What a loop rendered without a driver (a test, a hook outside a canvas) calls: it reports to nobody. */
const NOBODY: FrameReport = () => undefined;

/**
 * The reporter of the canvas this is under, or one that reports to nobody outside a `FrameDriver`, so a loop needs no
 * `if` (as `usePicker` does for the picker). A loop calls it in the frame it runs, with `false` whenever it has nothing
 * to do, and must run at a priority below 0 (see `FrameDriver`).
 */
export function useReportFrameDemand(): FrameReport {
  return useContext(FrameDemandContext) ?? NOBODY;
}
