import { useFrame } from '@react-three/fiber';
import { type ReactNode, useCallback, useRef } from 'react';
import { createFrameDemand, type FrameReport, needsFrame } from '../lib/twinPerf';
import { FrameDemandContext } from './FrameDemandContext';

interface FrameDriverProps {
  /** Everything that can report a demand: the rig, the equipment, the beacons. */
  children: ReactNode;
}

/**
 * Keeps the on-demand canvas drawing for as long as one of our loops asks (V2-19.2, ADR-0020 § Scene, brief § Worker
 * and render loop: "the loop runs while something moves"). It makes the `FrameDemand` (`lib/twinPerf.ts`), provides a reporter for it
 * to its children, and at the end of each frame asks R3F for the next one when `needsFrame` says so; a hidden tab asks
 * for none. It draws nothing.
 *
 * Frame demand: this is the one place that turns a loop's flag into an `invalidate()`. A loop that keeps itself alive
 * (`useBoundParts`, `Rig`'s fly-to, `Beacons`' pulse) writes its field and never calls `invalidate()` itself; every
 * other call in the 3D code is a one-shot after a change (an effect, an event) and says so in its own file.
 *
 * Why it is built as it is, because each part is easy to break:
 * - `invalidate()` has to be called from inside a `useFrame`: R3F then schedules a further frame. From a global
 *   after-effect it would be lost (the loop has already decided to stop).
 * - The driver reads the flags written **in the same frame**, so it must run after the reporters. R3F runs subscribers
 *   by ascending priority and then in the order they subscribed, and a model that loads later subscribes after this
 *   component. So the reporters run at a priority **below 0** (`Rig` at −2, `useBoundParts` and `Beacons` at −1) and this
 *   at the default 0. **Never give any subscriber a positive priority**: R3F then stops rendering the scene itself.
 * - It is a parent of the reporters, so on the first mount it subscribes after them as well.
 * - A flag left true by a reporter that stopped running costs one extra frame, which resets it; a reporter that runs
 *   after this one would cost a frame it should have had. The priority rule is what rules the second out.
 */
export function FrameDriver({ children }: FrameDriverProps) {
  const demand = useRef(createFrameDemand());
  const report = useCallback<FrameReport>((field, asking) => {
    demand.current[field] = asking;
  }, []);

  useFrame((state) => {
    if (needsFrame(demand.current, { hidden: document.hidden })) state.invalidate();
  });

  return <FrameDemandContext.Provider value={report}>{children}</FrameDemandContext.Provider>;
}
