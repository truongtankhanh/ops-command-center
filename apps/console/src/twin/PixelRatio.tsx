import { useFrame } from '@react-three/fiber';
import { useState } from 'react';
import { createDprController } from '../lib/twinPerf';

interface PixelRatioProps {
  /** The step the canvas starts at (`TwinCanvas`'s state): the controller begins at the first step at or below it. */
  initial: number;
  /** Called with the new step when the controller moves down; `TwinCanvas` keeps it and re-renders `<Canvas dpr>`. */
  onStep: (step: number) => void;
}

/**
 * Lowers the canvas's pixel ratio when frames run long (V2-19.3, brief § Performance: "Pixel ratio ≤ 1.5 … drops one
 * step when frames run long for 2 s"). Rendered inside the canvas, it draws nothing: every drawn frame's time goes to
 * `createDprController` (`lib/twinPerf.ts`), and a step it returns is reported out through `onStep`. It does not call
 * `setDpr` itself: R3F applies the `dpr` prop again on every configure, so a ratio set from inside is undone by the
 * next render of `TwinCanvas`, which therefore holds the step as state and passes it down.
 *
 * - **What is judged** is the interval between drawn frames (R3F's `delta`), against an 18 ms budget and not the brief's
 *   14 ms, which is a frame's cost: an interval is about 16.7 ms on a 60 Hz display whatever a frame costs, and
 *   14 ms would step down every healthy 60 Hz machine (see `DPR_BUDGET_MS`).
 * - **When**: it is mounted with the scene, so the controller's grace (one window) starts at the first frame drawn
 *   with one, and the load's shader compiles and model uploads are not mistaken for a slow device. A step is never
 *   undone.
 * - A display whose pixel ratio is below the first steps is clamped (`deviceRatio`): a laptop at 1.25 goes 1.25 → 1.0.
 *
 * Frame demand: none. It only observes the frames that others asked for; its `useFrame` stays at the default priority,
 * which keeps R3F rendering the scene. Not unit-tested against WebGL (jsdom has none): its logic is the controller,
 * tested in `lib/twinPerf.test.ts`.
 */
export function PixelRatio({ initial, onStep }: PixelRatioProps) {
  const [controller] = useState(() =>
    createDprController({ initial, deviceRatio: window.devicePixelRatio || 1 }),
  );

  useFrame((_state, delta) => {
    const next = controller.frame(delta * 1000, performance.now());
    if (next !== null) onStep(next);
  });

  return null;
}
