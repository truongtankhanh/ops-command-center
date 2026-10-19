import type { PickRef, ScreenPoint } from './twinPicking';

/*
 * The seam between whoever has the pointer and the canvas that can cast a ray (V2-15.3): `Pointer`
 * (V2-15.4), the keyboard (V2-18) and anything else call `requestPick`, the 3D stage's `PickLayer` registers
 * the implementation when it mounts and unregisters it when it goes. With no canvas (the 2D view, a stage
 * that has not loaded, one that lost its context) a request does nothing, so a caller never has to know
 * whether a 3D view exists. The same pattern as `twinCommands.ts`: plain module state, because nothing
 * renders from it and the store is for what the console shows.
 *
 * The answer comes back later, not as a return value: the ray is cast in the next frame (a pointer move only
 * records its point and asks for a frame), so the result is published and read with `onPick` / `lastPick`.
 */

/**
 * Called with the winner of the ray cast for a request, in the frame that casts it, **whether or not the winner
 * changed** (V2-15.4): a click needs the answer for its own point, and `onPick` is silent when nothing changed.
 */
export type PickDone = (ref: PickRef | null) => void;

/** What the canvas implements: it records `point` and asks for a frame in which to cast the ray. */
export interface PickRequester {
  request(point: ScreenPoint, done?: PickDone): void;
}

/** What is waiting for the next frame: the latest point and the completions of every request since the last. */
export interface PendingPick {
  point: ScreenPoint;
  callbacks: PickDone[];
}

/**
 * The canvas's bookkeeping for requests that arrive between frames, as plain data so it tests without one. A
 * new request replaces the pending point (one ray a frame, for the latest point) but **keeps the completions
 * of the requests it replaced**, so every `done` is called, with the answer for the latest point; the pointer
 * issues no hover request while a click waits, so a click's answer is for its own point.
 */
export function createPendingPick() {
  let point: ScreenPoint | null = null;
  let callbacks: PickDone[] = [];
  return {
    request(next: ScreenPoint, done?: PickDone): void {
      point = next;
      if (done) callbacks.push(done);
    },
    /** The pending request, now taken: it is cleared. `null` when nothing is waiting. */
    take(): PendingPick | null {
      if (point === null) return null;
      const taken = { point, callbacks };
      point = null;
      callbacks = [];
      return taken;
    },
  };
}

let registered: PickRequester | null = null;
let last: PickRef | null = null;
const listeners = new Set<(ref: PickRef | null) => void>();

/**
 * Makes `requester` the implementation. Returns what to call to take it away again; that clears the
 * registration **only if it is still this one**, so a stage that was replaced does not undo its successor
 * when its own cleanup runs late. Taking it away also forgets the last pick: nothing is under a pointer on a
 * canvas that is gone.
 */
export function registerPicker(requester: PickRequester): () => void {
  registered = requester;
  return () => {
    if (registered !== requester) return;
    registered = null;
    publishPick(null);
  };
}

/**
 * Asks the canvas what is under `point` (CSS pixels from its top-left corner). Does nothing without one, `done`
 * included: it is never called for a request no canvas heard.
 */
export function requestPick(point: ScreenPoint, done?: PickDone): void {
  registered?.request(point, done);
}

const same = (a: PickRef | null, b: PickRef | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.kind === b.kind &&
    a.id === b.id &&
    (a.kind !== 'part' || (b.kind === 'part' && a.assetCode === b.assetCode)));

/** Records the winner of a ray and tells the listeners, but only when it is not what they last heard. */
export function publishPick(ref: PickRef | null): void {
  if (same(last, ref)) return;
  last = ref;
  for (const listener of [...listeners]) listener(ref);
}

/** The winner of the latest ray, or `null`. */
export const lastPick = (): PickRef | null => last;

/** Calls `listener` each time the winner changes. Returns what stops it. */
export function onPick(listener: (ref: PickRef | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
