import { useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';

/** Development only, like `PickLayer`'s timing: the log is read from the browser console, not shipped. */
const LOGGED = import.meta.env.MODE === 'development';

/**
 * Logs how many draw calls and triangles the last frame cost, at most once a second and only when the number of calls
 * changed (V2-15.8, AC2: "draw calls at building level stay within the budget"; brief § Performance: ≤ 150 a frame).
 * A mesh of N geometry groups costs N draw calls, so a building in focus (groups for each look of the shells and of
 * the boxes) is the case to read: focus a building, then leave it, and compare with the campus. It draws nothing.
 *
 * The count is the previous frame's: `renderer.info` is reset when a frame starts to render, after the `useFrame`
 * callbacks, so what a callback reads is the frame before it. The figure covers the whole scene, ground and markers
 * included. Superseded by the developer HUD of V2-19.1, which shows the same number on screen; delete this then.
 *
 * Not unit-tested: it is R3F glue over `renderer.info`, which jsdom has no WebGL for.
 */
export function DrawCallLog() {
  return LOGGED ? <Logger /> : null;
}

/** A component of its own so the hooks run only when the log is on. */
function Logger() {
  const gl = useThree((state) => state.gl);
  const last = useRef({ at: 0, calls: -1 });

  useFrame(() => {
    const { calls, triangles } = gl.info.render;
    const now = performance.now();
    if (calls === 0 || calls === last.current.calls || now - last.current.at < 1000) return;
    last.current = { at: now, calls };
    console.debug(`draw calls: ${calls}, triangles: ${triangles}`);
  });

  return null;
}
