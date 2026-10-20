import { useFrame, useThree } from '@react-three/fiber';
import { type RefObject, useEffect, useMemo } from 'react';
import { formatHud, HUD_ROWS } from '../lib/twinHud';
import { createPerfSampler } from '../lib/twinPerf';
import { useTelemetryStore } from '../realtime/telemetryStore';

/** How often the figures are rewritten (V2-19.1: twice a second). */
const TICK_MS = 500;

interface HudProbeProps {
  /** The `Hud`'s description list, whose cells (`data-hud`) get the figures. May not be there yet: `Hud` loads lazily too. */
  listRef: RefObject<HTMLDListElement | null>;
}

/**
 * Measures the 3D view for the developer HUD (V2-19.1, ADR-0020 § Budgets) from inside the canvas and renders nothing,
 * as `CompassSync` and `LabelProjector` do: the stage owns the DOM, this writes into it through a ref.
 *
 * - **Frame times.** `useFrame` at the default priority 0 hands each drawn frame's delta to the sampler: one counter
 *   increment and one array store, no allocation. **Never give it a priority above 0**: R3F then stops rendering
 *   the scene itself and the stage goes blank. With `frameloop="demand"` a delta spans the idle time before the
 *   frame, so the sampler drops what is too long to be a frame (`MAX_FRAME_GAP_MS`) and takes FPS from the frames
 *   drawn per window: an idle canvas reads 0.
 * - **Draw calls and triangles** are read from the timer, between frames: `gl.info.render` then still holds the last
 *   completed frame (it is reset when the next render starts), whereas a `useFrame` callback would see the frame
 *   before. The figures cover the whole scene, ground and markers included.
 * - **Telemetry.** The client's cumulative counts (`getStats()`, V2-14.4; the engine posts them at most once a second)
 *   become messages per second and posts per frame in the sampler; without a client the cells show a dash.
 * - **Writes.** Twice a second, into the cells' `textContent`, and only where the text changed. Nothing is written
 *   while the tab is hidden (a hidden tab draws no frames; V2-19.2 makes that a rule of the whole canvas).
 *
 * Mounted by `TwinCanvas` behind a literal development check and `?debug=twin`. Not unit-tested against WebGL (jsdom
 * has none); `Hud.test.tsx` drives it with a stubbed `useFrame` and `gl.info`. A default export for `React.lazy`.
 */
export default function HudProbe({ listRef }: HudProbeProps) {
  const gl = useThree((state) => state.gl);
  const sampler = useMemo(() => createPerfSampler(), []);

  useFrame((_state, delta) => {
    sampler.frame(delta * 1000);
  });

  useEffect(() => {
    const tick = () => {
      const list = listRef.current;
      if (document.hidden || list === null) return;
      const { calls, triangles } = gl.info.render;
      const stats = useTelemetryStore.getState().client?.getStats() ?? null;
      const shown = formatHud(sampler.read(performance.now(), { calls, triangles, stats }));
      for (const { id } of HUD_ROWS) {
        const cell = list.querySelector<HTMLElement>(`[data-hud="${id}"]`);
        if (cell !== null && cell.textContent !== shown[id]) cell.textContent = shown[id];
      }
    };
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [gl, listRef, sampler]);

  return null;
}
