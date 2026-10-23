import { useSyncExternalStore } from 'react';

/*
 * The report pin while it is being dragged in the 3D view (V2-16.7, ADR-0020 "Settled in V2-16.7"): the place under
 * the pointer, in scene metres, east and north. It is a **preview**, not a location: the console store keeps the real
 * `reportPosition`, which changes only when the pin is dropped inside a zone. Plain module state like
 * `lib/twinPicker.ts`, because only the pin reads it and it changes on every pointer move, which must re-render the
 * pin alone. The pin's height is not here: it is derived from the place by the same rule as at rest (`pinScenePosition`).
 */

/** Where the pin is being dragged to: scene metres, `x` east and `z` = −north. */
export interface PinDrag {
  x: number;
  z: number;
}

let current: PinDrag | null = null;
const listeners = new Set<() => void>();

export const getPinDrag = (): PinDrag | null => current;

/** Sets the preview, or clears it with `null`. Listeners hear only a change. */
export function setPinDrag(next: PinDrag | null): void {
  if (next === null ? current === null : current?.x === next.x && current.z === next.z) return;
  current = next === null ? null : { x: next.x, z: next.z };
  for (const listener of [...listeners]) listener();
}

export function subscribePinDrag(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The preview as a React value: the pin re-renders when it moves, nothing else does. */
export function usePinDrag(): PinDrag | null {
  return useSyncExternalStore(subscribePinDrag, getPinDrag, getPinDrag);
}
