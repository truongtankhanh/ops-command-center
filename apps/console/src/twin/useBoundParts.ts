import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { type Object3D, Quaternion, Vector3 } from 'three';
import type { Binding } from '../lib/twin-core/twinBindings';
import {
  type BoundState,
  createBoundState,
  frameDt,
  poseOfBound,
  resetBoundState,
  stepBound,
} from '../lib/twin-core/twinMotion';
import { useTelemetryStore } from '../realtime/telemetryStore';
import type { TwinFeed } from '../realtime/twinFeed';
import { useReportFrameDemand } from './FrameDemandContext';

/** A model instance and what its class binds (V2-14.2): the nodes to move, found by name inside `object`. */
export interface BoundInstance {
  /** The asset whose readings move it: the feed is keyed by asset code. */
  assetCode: string;
  object: Object3D;
  bindings: readonly Binding[];
}

/** One bound part of one instance, with everything the frame needs, made once. */
interface Part {
  assetCode: string;
  binding: Binding;
  node: Object3D;
  /** The node's own axis of motion, a unit vector. */
  axis: Vector3;
  /** The pose the model was authored in: motion is applied on top of it, and a part with no value stays in it. */
  restPosition: Vector3;
  restQuaternion: Quaternion;
  state: BoundState;
}

const UNIT_AXES = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
} as const;

/** Scratch objects: the frame writes into them, so nothing is allocated in the loop. */
const scratchRotation = new Quaternion();
const scratchOffset = new Vector3();

/** The parts that move: a `spin`, `turn` or `slide` binding with an axis whose node the model has. A `tint` is V2-14.9's. */
function partsOf(instances: readonly BoundInstance[]): Part[] {
  const parts: Part[] = [];
  for (const { assetCode, object, bindings } of instances) {
    for (const binding of bindings) {
      if (binding.motion === 'tint' || binding.axis === undefined) continue;
      const node = object.getObjectByName(binding.node);
      if (node === undefined) continue;
      parts.push({
        assetCode,
        binding,
        node,
        axis: new Vector3(...UNIT_AXES[binding.axis]),
        restPosition: node.position.clone(),
        restQuaternion: node.quaternion.clone(),
        state: createBoundState(),
      });
    }
  }
  return parts;
}

/**
 * Writes a part's pose onto its node: a rotation about the node's **own** axis on top of the rotation it was
 * authored with (`turn`, and `spin` with its integrated angle), or a slide along that axis (turned by the
 * authored rotation) from the authored position. The signs are `unverified` against the vendor's models (V2-13.8).
 */
function apply(part: Part): void {
  const pose = poseOfBound(part.binding, part.state);
  if (pose === null) return;
  if (part.binding.motion === 'slide') {
    scratchOffset.copy(part.axis).applyQuaternion(part.restQuaternion).multiplyScalar(pose);
    part.node.position.copy(part.restPosition).add(scratchOffset);
  } else {
    scratchRotation.setFromAxisAngle(part.axis, pose);
    part.node.quaternion.copy(part.restQuaternion).multiply(scratchRotation);
  }
}

/**
 * The render loop of the twin's moving parts (V2-14.8, brief § Worker and render loop): **one** `useFrame` for
 * every model instance. Per frame it reads the feed (`feed.read()`, never React state), and for each part
 * steps its eased value toward the reading in its slot (`stepBound`, V2-14.3) and writes the pose onto the
 * node.
 *
 * - A part whose asset is stale or offline is skipped, so it freezes at its last pose and a spinning one stops
 *   (V2-14.1); a part with no slot, or whose reading is `NaN` (an asset nobody watches has no value for a
 *   non-headline key), stays at the authored pose.
 * - The canvas is on demand: it draws when the feed says something arrived (`invalidate`), and this loop reports
 *   `demand.bound` while a value has not settled or a part spins (`FrameDriver` then asks for the next frame), so an
 *   idle scene draws nothing. Frame demand: conditional, the answer of `stepBound` for the parts that are live; a spin
 *   asks for a frame every frame while it lasts (the one steady load of a quiet scene, V2-19.2). The loop runs at
 *   priority −1, below `FrameDriver`'s 0, so the driver reads this frame's flag whatever the mount order.
 * - Slots are looked up once per layout (`reader.layout`), because `slotOf` builds a string per call.
 * - The first value of a part, and the first value after the telemetry socket comes back to `live`, snap
 *   instead of easing (brief § Worker and render loop). The reconnect is watched on the store, not read every
 *   frame, so one that happens while the canvas sleeps is not missed.
 * - The frame's `delta` is clamped (`frameDt`): after a long sleep it is the whole pause.
 *
 * State lives in plain objects and refs, nothing per frame is allocated, and no React state is set.
 */
export function useBoundParts(feed: TwinFeed | null, instances: readonly BoundInstance[]): void {
  const parts = useMemo(() => partsOf(instances), [instances]);
  const reportDemand = useReportFrameDemand();
  // A loop that goes away must not leave its flag up: nothing would ever write it down, and the driver would draw forever.
  useEffect(
    () => () => {
      reportDemand('bound', false);
    },
    [reportDemand],
  );

  // What the loop remembers between frames: the parts and the layout the slots were looked up for, the slots
  // themselves (one per part, `-1` for none: the part stays at rest) and whether a reconnect asked for the next
  // values to snap. The slots live here and not on the parts: the parts are a memo's result, which a hook must
  // not modify after render.
  const loop = useRef<{
    parts: readonly Part[] | null;
    layout: number;
    slots: Int32Array;
    reconnected: boolean;
  }>({ parts: null, layout: -1, slots: new Int32Array(0), reconnected: false });

  useEffect(
    () =>
      useTelemetryStore.subscribe((state, previous) => {
        if (state.view.state.socket === 'live' && previous.view.state.socket !== 'live') {
          loop.current.reconnected = true;
        }
      }),
    [],
  );

  useFrame((_state, delta) => {
    if (feed === null || parts.length === 0) {
      reportDemand('bound', false);
      return;
    }
    const reader = feed.read();
    const memory = loop.current;
    if (memory.parts !== parts || memory.layout !== reader.layout) {
      memory.slots = Int32Array.from(parts, (part) =>
        reader.slotOf(part.assetCode, part.binding.key),
      );
      memory.parts = parts;
      memory.layout = reader.layout;
    }
    if (memory.reconnected) {
      for (const part of parts) resetBoundState(part.state);
      memory.reconnected = false;
    }

    const dtS = frameDt(delta);
    const { targets } = reader;
    const { slots } = memory;
    let moving = false;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const slot = slots[index];
      if (part === undefined || slot === undefined || slot < 0) continue;
      const flags = reader.flags(part.assetCode);
      if (flags.stale || !flags.online) continue;
      const reading = targets[slot];
      if (reading === undefined) continue;
      if (stepBound(part.binding, part.state, reading, dtS)) moving = true;
      apply(part);
    }
    reportDemand('bound', moving);
  }, -1);
}
