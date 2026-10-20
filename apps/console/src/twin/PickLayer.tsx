import type { Camera } from '@occ/contracts';
import { useFrame, useThree } from '@react-three/fiber';
import { type ReactNode, useEffect, useMemo } from 'react';
import { cameraMarkers } from '../lib/twinMarkers';
import { createPendingPick, publishPick, registerPicker } from '../lib/twinPicker';
import { createPickStats, scopeOf } from '../lib/twinPicking';
import type { Frame } from '../lib/twinScene';
import { useConsole } from '../store';
import { createPicker } from './picker';
import { PickContext } from './PickContext';

interface PickLayerProps {
  /** The cameras whose markers are hit in screen space; they are sprites, not meshes. */
  cameras: readonly Camera[];
  frame: Frame;
  /** What registers with the picker: the buildings and the equipment (meshes), and the beacons (V2-16.4, sprites). */
  children: ReactNode;
}

/** The development timing is read from the console, once a second, to check the brief's 0.5 ms (V2-15.3). */
const TIMED = import.meta.env.MODE === 'development';

/**
 * The picking of the 3D view (V2-15.3, ADR-0020 § Scene): it makes the picker, offers it to what is drawn, and
 * casts **at most one ray per frame**. A request (`requestPick`, from the pointer of V2-15.4) only records its
 * point and asks the on-demand canvas for a frame; the ray is cast in that frame, against the scope the level
 * allows, and the winner is published for whoever listens (`onPick`) and handed to the completion of every
 * request that had one, changed or not (a click needs the answer for its own point). Requests that arrive
 * between two frames share the frame: the latest point is cast, and all their completions get its answer
 * (`createPendingPick`). A frame with no request casts nothing.
 *
 * The scope is read from the store at the moment of the frame (`getState`, no subscription), so a selection
 * never re-renders this layer, and the result goes to a plain module, not to React state. It draws nothing.
 * Disposal of what it holds is the owners': the picker keeps only references and bounds trees, which go with
 * their geometry (V2-19.6).
 *
 * Not unit-tested: it is R3F glue, and jsdom has no WebGL. Its logic is `twin/picker.ts` and `lib/twinPicking.ts`.
 *
 * Frame demand: one-shot. A pick request records its point and asks for one frame; the ray is cast in that frame
 *   and nothing keeps it asking.
 */
export function PickLayer({ cameras, frame, children }: PickLayerProps) {
  const picker = useMemo(() => createPicker(), []);
  const pending = useMemo(() => createPendingPick(), []);
  const invalidate = useThree((state) => state.invalidate);
  const get = useThree((state) => state.get);

  const markers = useMemo(() => cameraMarkers(cameras, frame), [cameras, frame]);
  useEffect(() => picker.setCameras(markers), [picker, markers]);

  useEffect(
    () =>
      registerPicker({
        request(point, done) {
          pending.request(point, done);
          invalidate();
        },
        // Answered at once with the camera as it is now: a press on the pin decides before the controls hear it.
        pinAt(point) {
          const { camera, size } = get();
          return picker.pinAt(point, { camera, width: size.width, height: size.height });
        },
      }),
    [get, invalidate, pending, picker],
  );

  useEffect(() => () => picker.clear(), [picker]);

  const stats = useMemo(
    () =>
      TIMED
        ? createPickStats(({ count, meanMs, maxMs }) =>
            console.debug(
              `picking: ${count} picks, mean ${meanMs.toFixed(3)} ms, max ${maxMs.toFixed(3)} ms`,
            ),
          )
        : null,
    [],
  );

  useFrame(({ camera, size }) => {
    const request = pending.take();
    if (request === null) return;
    const started = TIMED ? performance.now() : 0;
    const ref = picker.pick(
      request.point,
      { camera, width: size.width, height: size.height },
      scopeOf(useConsole.getState()),
    );
    if (stats !== null) stats.record(performance.now() - started, performance.now());
    publishPick(ref);
    for (const done of request.callbacks) done(ref);
  });

  return <PickContext.Provider value={picker}>{children}</PickContext.Provider>;
}
