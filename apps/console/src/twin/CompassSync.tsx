import { useFrame, useThree } from '@react-three/fiber';
import { type RefObject, useEffect, useRef } from 'react';
import { Vector3 } from 'three';
import { compassLabel, yawOfDirection } from '../lib/twinCamera';

/** One vector for every frame: nothing is allocated while the camera moves. */
const direction = new Vector3();

interface CompassSyncProps {
  /** The compass button `TwinControls` renders. */
  compassRef: RefObject<HTMLButtonElement | null>;
}

/**
 * Keeps the compass pointing at north (V2-12.10). Rendered inside the canvas, it renders nothing: on every
 * frame that is drawn it reads which way the camera looks, and when the whole-degree yaw has changed it turns
 * the needle (`rotate(ψdeg)`: the needle is rotated by how far the view is turned) and renames the button
 * ("Face north", or "Face north — the view is rotated N°"). Through a ref, so the cluster re-renders for none
 * of it, and a camera that has settled writes nothing.
 *
 * `frameloop="demand"` draws only when asked, so the first value is requested on mount; after that the camera
 * moving is what asks.
 *
 * Frame demand: one-shot. An effect asks for one frame on mount so the needle has a first value; after that the
 *   needle is written in frames the camera asked for.
 */
export function CompassSync({ compassRef }: CompassSyncProps) {
  const invalidate = useThree((state) => state.invalidate);
  const written = useRef<number | null>(null);

  useEffect(() => {
    written.current = null;
    invalidate();
  }, [invalidate]);

  useFrame(({ camera }) => {
    const compass = compassRef.current;
    if (!compass) return;
    camera.getWorldDirection(direction);
    const yaw = Math.round(yawOfDirection(direction.x, direction.z));
    if (yaw === written.current) return;
    written.current = yaw;
    compass.setAttribute('aria-label', compassLabel(yaw));
    const needle = compass.querySelector('svg');
    if (needle) needle.style.transform = `rotate(${yaw}deg)`;
  });

  return null;
}
