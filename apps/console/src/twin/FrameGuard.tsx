import { useFrame } from '@react-three/fiber';
import { useState } from 'react';
import { createFallbackDetector } from '../lib/twin-core/twinPerf';
import { useConsole } from '../store';

/**
 * Gives a video wall's 3D view up for the 2D map when it cannot hold its frame rate (V2-21.9, brief Open question 6: "a wall
 * screen whose GPU cannot hold the frame budget falls back to the 2D map like any other device"). Rendered inside the canvas
 * on a wall only, it draws nothing: every drawn frame's time goes to `createFallbackDetector` (`lib/twin-core/twinPerf.ts`), and when
 * that trips it marks the twin lost as `too-slow`, the path of a lost context (V2-12.11), after which `WallStage` shows the map.
 *
 * The pixel-ratio controller cannot help a wall (it starts and stays on the last step), so this is the only answer to a
 * slow one. A person on a laptop is not switched away from their 3D view: there it is the pixel ratio that gives.
 *
 * Frame demand: none. It only observes the frames that others asked for.
 */
export function FrameGuard() {
  const markTwinLost = useConsole((state) => state.markTwinLost);
  const [detector] = useState(() => createFallbackDetector());

  useFrame((_state, delta) => {
    if (detector.frame(delta * 1000, performance.now())) markTwinLost('too-slow');
  });

  return null;
}
