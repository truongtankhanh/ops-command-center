import { useFrame, useThree } from '@react-three/fiber';
import { type RefObject, useEffect, useMemo } from 'react';
import { formatBudgetWarning, formatHud, HUD_ROWS } from '../lib/twinHud';
import { createBudgetGuard, createPerfSampler } from '../lib/twinPerf';
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
 * - **Pixel ratio** (V2-19.3) is the renderer's own (`gl.getPixelRatio()`), not the controller's step: it is
 *   `min(device ratio, step)`, which is what the operator actually sees.
 * - **Memory** (V2-19.6). `gl.info.memory`'s geometries and textures: what the GPU holds right now, read between frames
 *   like the draw calls. A resource enters the count the first time it is drawn and stays until it is disposed, so
 *   the evidence that a change of level releases what it made is a count that is **steady** over round trips after a
 *   first one has uploaded what the views need; one that rises by a fixed amount per trip is a leak.
 * - **Budgets** (V2-19.4). The same two figures are judged against the brief's 150 draw calls and 250,000 triangles
 *   (`createBudgetGuard`): a figure over budget gets `data-over="true"` on its cell, and a figure that **becomes** over
 *   budget is warned about once on the console (`console.warn`), again only after it has been back within budget. It
 *   sees the last frame's reading twice a second, so it judges steady views and can miss a one-frame spike. It lives
 *   here, in the development-only probe, so a production build has neither the check nor its words.
 * - **Telemetry.** The client's cumulative counts (`getStats()`, V2-14.4; the engine posts them at most once a second)
 *   become messages per second and posts per frame in the sampler; without a client the cells show a dash.
 * - **Writes.** Twice a second, into the cells' `textContent`, and only where the text changed. Nothing is written
 *   while the tab is hidden (a hidden tab draws no frames; V2-19.2 makes that a rule of the whole canvas).
 *
 * Mounted by `TwinCanvas` behind a literal development check and `?debug=twin`. Not unit-tested against WebGL (jsdom
 * has none); `Hud.test.tsx` drives it with a stubbed `useFrame` and `gl.info`. A default export for `React.lazy`.
 *
 * Frame demand: none. It only observes the frames that others asked for; its `useFrame` stays at the default
 *   priority, which keeps R3F rendering the scene.
 */
export default function HudProbe({ listRef }: HudProbeProps) {
  const gl = useThree((state) => state.gl);
  const sampler = useMemo(() => createPerfSampler(), []);
  const guard = useMemo(() => createBudgetGuard(), []);

  useFrame((_state, delta) => {
    sampler.frame(delta * 1000);
  });

  useEffect(() => {
    const tick = () => {
      const list = listRef.current;
      if (document.hidden || list === null) return;
      const { calls, triangles } = gl.info.render;
      const { geometries, textures } = gl.info.memory;
      const stats = useTelemetryStore.getState().client?.getStats() ?? null;
      const pixelRatio = gl.getPixelRatio();
      const { over, fresh } = guard.check({ calls, triangles });
      if (fresh.length > 0) console.warn(formatBudgetWarning(fresh));
      const overIds = new Set<string>(over.map(({ figure }) => figure));
      const shown = formatHud(
        sampler.read(performance.now(), {
          calls,
          triangles,
          stats,
          pixelRatio,
          geometries,
          textures,
        }),
      );
      for (const { id } of HUD_ROWS) {
        const cell = list.querySelector<HTMLElement>(`[data-hud="${id}"]`);
        if (cell === null) continue;
        if (cell.textContent !== shown[id]) cell.textContent = shown[id];
        const isOver = overIds.has(id);
        if (cell.hasAttribute('data-over') !== isOver) {
          if (isOver) cell.setAttribute('data-over', 'true');
          else cell.removeAttribute('data-over');
        }
      }
    };
    const timer = setInterval(tick, TICK_MS);
    return () => {
      clearInterval(timer);
      // A probe that mounts again starts armed: a scene still over budget warns once more.
      guard.reset();
    };
  }, [gl, guard, listRef, sampler]);

  return null;
}
