import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { type Binding, bindingsFromNodes, type Problem } from '../lib/twin-core/twinBindings';
import type { ModelClass } from '../lib/twin-core/twinLoadQueue';
import { useTwinModelStore } from '../lib/twin-core/twinModelStore';
import { markTwin } from '../lib/twin-core/twinPerf';
import { buildTemplate, type ClassTemplate, createMaterialTable } from './classModel';
import { loadGltf } from './loadGltf';
import { releaseGltfLoaders } from './loaders';
import { createModelCache, type ModelCache } from './modelCache';
import type { ClassPoints } from './useClassPoints';

/** A class whose model has arrived, with what its `extras` say about moving it. */
export interface ReadyClass {
  template: ClassTemplate;
  /**
   * The bindings of the model's bound parts, built from its `extras` and the class's points (V2-14.2). `null`
   * until the points are known: the model draws meanwhile, as it would without bindings. V2-14.8 applies them.
   */
  bindings: Binding[] | null;
  /** The bound parts the model has but the catalogue cannot bind; logged once per class. */
  problems: Problem[];
}

interface Snapshot {
  cache: ModelCache | null;
  /** Changes whenever a class becomes ready or fails, so a render that read the cache reads it again. */
  version: number;
}

const NONE: Snapshot = { cache: null, version: 0 };

/**
 * Where the effect publishes the cache and render reads it, as an external store (the same shape as
 * `useTwinFeed`'s): publishing is a call on this object and not a `setState` in the effect body, which
 * would render twice for what is one resource.
 */
function createHolder() {
  let current: Snapshot = NONE;
  const listeners = new Set<() => void>();
  const publish = (next: Snapshot): void => {
    current = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => current,
    publish,
  };
}

/**
 * The classes of `cache` that are ready, with their bindings. `version` is not read: it is the cache's
 * change count, passed so that a memo of this call is recomputed when a class becomes ready or fails.
 */
function readyClasses(
  cache: ModelCache | null,
  _version: number,
  classes: readonly ModelClass[],
  points: ClassPoints,
): Map<string, ReadyClass> {
  const result = new Map<string, ReadyClass>();
  if (cache === null) return result;
  for (const { code } of classes) {
    const template = cache.get(code);
    if (template === null) continue;
    const classPoints = points[code];
    const built = classPoints ? bindingsFromNodes(template.info, classPoints) : null;
    result.set(code, {
      template,
      bindings: built?.bindings ?? null,
      problems: built?.problems ?? [],
    });
  }
  return result;
}

/**
 * The stage's equipment models (V2-14.7), read inside the canvas: it needs the renderer, for the KTX2
 * transcoder's formats, and the canvas's `invalidate`.
 *
 * It owns a model cache for the stage's lifetime. The cache is made in an effect and freed in its cleanup,
 * with the console materials and the card's progress, so React StrictMode's mount, cleanup, mount leaves one
 * live cache (a second mount asks again; the file is immutable, so the browser's HTTP cache answers). The
 * classes are started in the order given, nearest first; a class asked for before is not asked again.
 *
 * It returns the classes that are ready, by class code. A class that is loading, or failed, is absent: its
 * assets keep their boxes (`Equipment`). Nothing here touches the telemetry feed: V2-14.8 mounts it and
 * applies the bindings this returns.
 *
 * Frame demand: one-shot. One frame is asked for each time a class becomes ready or fails; nothing keeps it asking.
 */
export function useClassModels(
  classes: readonly ModelClass[],
  points: ClassPoints,
): ReadonlyMap<string, ReadyClass> {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const latestInvalidate = useRef(invalidate);
  useEffect(() => {
    latestInvalidate.current = invalidate;
  }, [invalidate]);

  const [holder] = useState(createHolder);
  const { cache, version } = useSyncExternalStore(holder.subscribe, holder.getSnapshot);

  useEffect(() => {
    const table = createMaterialTable();
    const made = createModelCache({
      load: (url, onProgress) => loadGltf(url, gl, onProgress),
      build: (scene) => buildTemplate(scene, table),
      report: (classCode, progress) => useTwinModelStore.getState().report(classCode, progress),
    });
    let changes = 0;
    holder.publish({ cache: made, version: changes });
    const stop = made.subscribe(() => {
      changes += 1;
      holder.publish({ cache: made, version: changes });
      latestInvalidate.current();
    });
    return () => {
      stop();
      made.dispose();
      table.dispose();
      // The KTX2 loader's workers belong to this renderer's stage; a switch to 2D and back makes a new renderer (V2-19.6).
      releaseGltfLoaders(gl);
      useTwinModelStore.getState().reset();
      holder.publish(NONE);
    };
  }, [gl, holder]);

  useEffect(() => {
    cache?.start(classes);
  }, [cache, classes]);

  // The load mark of V2-19.7: every class is ready or has failed (a failure is final), or there is none to load.
  useEffect(() => {
    const check = (): void => {
      const { byClass } = useTwinModelStore.getState();
      const settled = classes.every(({ code }) => {
        const state = byClass[code]?.state;
        return state === 'ready' || state === 'failed';
      });
      if (settled) markTwin('twin:models-done');
    };
    check();
    return useTwinModelStore.subscribe(check);
  }, [classes]);

  const ready = useMemo(
    () => readyClasses(cache, version, classes, points),
    [cache, version, classes, points],
  );

  // A bound part the catalogue cannot bind is logged once per class: the model loads without that binding.
  const logged = useRef(new Set<string>());
  useEffect(() => {
    for (const [code, { problems }] of ready) {
      if (problems.length === 0 || logged.current.has(code)) continue;
      logged.current.add(code);
      console.warn(
        `The model of ${code} has parts that cannot be bound, which stay still`,
        problems.map(({ node, reason, detail }) => `${node || '(unnamed)'}: ${reason} (${detail})`),
      );
    }
  }, [ready]);

  return ready;
}
