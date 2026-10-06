import type { Map as MapLibreMap } from 'maplibre-gl';
import { PULSE_WAVE, PULSE_WAVE_LAYERS } from './mapLayers';

/** Every frame repaints the whole map, so the wave is capped well below the display rate. */
const FRAME_MS = 1000 / 30;
/** Frame 04's `pulse` keyframes: the ring grows from 0.7× to 1.8× while fading from 0.9 to 0. */
const SCALE_FROM = 0.7;
const SCALE_TO = 1.8;
const OPACITY_FROM = 0.9;

/**
 * The wave at `elapsedMs` into a repeating cycle of `periodMs`. The easing approximates
 * `--ease-out` (`cubic-bezier(0, 0, 0.58, 1)`) with a quadratic ease-out.
 */
export function pulseFrame(
  elapsedMs: number,
  periodMs: number,
): { radius: number; opacity: number } {
  const t = (elapsedMs % periodMs) / periodMs;
  const eased = 1 - (1 - t) ** 2;
  return {
    radius: PULSE_WAVE.radius * (SCALE_FROM + (SCALE_TO - SCALE_FROM) * eased),
    opacity: OPACITY_FROM * (1 - eased),
  };
}

/**
 * Animates the pulse wave layers until the returned function is called, which also puts them back
 * in their static form. Start it only while an open critical incident is drawn and reduced motion
 * is off: while it runs the map repaints every frame.
 */
export function startPulse(map: MapLibreMap, periodMs: number): () => void {
  const start = performance.now();
  let last = -Infinity;
  let frame = requestAnimationFrame(function tick(now) {
    frame = requestAnimationFrame(tick);
    if (now - last < FRAME_MS) return;
    last = now;
    const { radius, opacity } = pulseFrame(now - start, periodMs);
    setWave(map, radius, opacity);
  });

  return () => {
    cancelAnimationFrame(frame);
    // `Map.remove()` deletes the style; there is nothing left to reset then.
    if (map.style) setWave(map, PULSE_WAVE.radius, PULSE_WAVE.opacity);
  };
}

function setWave(map: MapLibreMap, radius: number, opacity: number) {
  for (const id of PULSE_WAVE_LAYERS) {
    if (!map.getLayer(id)) continue;
    map.setPaintProperty(id, 'circle-radius', radius);
    map.setPaintProperty(id, 'circle-stroke-opacity', opacity);
  }
}
