import type { ClassProgress, ModelClass } from '../lib/twin-core/twinLoadQueue';
import type { ClassTemplate } from './classModel';
import type { BytesProgress } from './loadGltf';

/**
 * How many model files are fetched at once. The classes are started nearest the camera target first
 * (`modelClasses`), so with every file in flight at once that order would mean nothing, and one at a time
 * would leave the connection idle between small files.
 */
export const MODEL_CONCURRENCY = 2;

/** The most often a class's bytes are reported while it downloads; a change of state is reported at once. */
export const PROGRESS_INTERVAL_MS = 250;

export interface ModelCacheOptions<Scene> {
  /** Fetches and parses one file (`loadGltf`). Called at most once per URL. */
  load(url: string, onProgress: (progress: BytesProgress) => void): Promise<Scene>;
  /** Turns a parsed file into a template (`buildTemplate`). May throw: that is a failed model. */
  build(scene: Scene): ClassTemplate;
  /** Where the class's state and bytes go (`useTwinModelStore.report`). */
  report(classCode: string, progress: ClassProgress): void;
  now?(): number;
  concurrency?: number;
}

export interface ModelCache {
  /**
   * Asks for the models of `classes`, in this order, at most `concurrency` at a time. A class that was asked
   * for before is not asked again, whatever happened to it: a failure is final.
   */
  start(classes: readonly ModelClass[]): void;
  /** The class's template once it is ready; `null` while it loads, if it failed, or if it was never asked for. */
  get(classCode: string): ClassTemplate | null;
  /** Calls `listener` whenever a class becomes ready or fails. */
  subscribe(listener: () => void): () => void;
  /** Stops: nothing more is started, the templates are freed and a result that arrives late is dropped. */
  dispose(): void;
}

/**
 * The stage's models (V2-14.7): one request per file however many assets share it, the files fetched nearest
 * first and two at a time, their bytes reported at most four times a second, and a file that cannot be loaded
 * logged **once** and never asked for again (no retry loop: the asset keeps its box, the Assets tab and the
 * inspector are unaffected). It knows nothing of `three`, the network or React; they are the parameters, so it
 * is tested with fakes. A cache belongs to one stage: it holds GPU-bound objects that go with the renderer.
 */
export function createModelCache<Scene>({
  load,
  build,
  report,
  now = () => performance.now(),
  concurrency = MODEL_CONCURRENCY,
}: ModelCacheOptions<Scene>): ModelCache {
  const asked = new Set<string>();
  const queue: ModelClass[] = [];
  const templates = new Map<string, ClassTemplate>();
  const requests = new Map<string, Promise<Scene>>();
  const listeners = new Set<() => void>();
  let active = 0;
  let disposed = false;

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  async function run({ code, name, modelUrl }: ModelClass): Promise<void> {
    let latest: BytesProgress = { loaded: 0, total: 0 };
    let lastReport = -Infinity;
    report(code, { state: 'loading', ...latest });
    try {
      let request = requests.get(modelUrl);
      if (request === undefined) {
        request = load(modelUrl, (bytes) => {
          latest = bytes;
          const at = now();
          if (disposed || at - lastReport < PROGRESS_INTERVAL_MS) return;
          lastReport = at;
          report(code, { state: 'loading', ...bytes });
        });
        requests.set(modelUrl, request);
      }
      const scene = await request;
      if (disposed) return;
      const template = build(scene);
      if (disposed) {
        template.dispose();
        return;
      }
      templates.set(code, template);
      const bytes = latest.total > 0 ? { loaded: latest.total, total: latest.total } : latest;
      report(code, { state: 'ready', ...bytes });
    } catch (error) {
      if (disposed) return;
      console.error(`The model of ${name} could not be loaded; its assets stay boxes`, error);
      report(code, { state: 'failed', loaded: 0, total: 0 });
    }
    notify();
  }

  function pump(): void {
    while (!disposed && active < concurrency) {
      const next = queue.shift();
      if (next === undefined) return;
      active += 1;
      void run(next).finally(() => {
        active -= 1;
        pump();
      });
    }
  }

  return {
    start(classes) {
      if (disposed) return;
      for (const modelClass of classes) {
        if (asked.has(modelClass.code)) continue;
        asked.add(modelClass.code);
        queue.push(modelClass);
      }
      pump();
    },
    get: (classCode) => templates.get(classCode) ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      queue.length = 0;
      listeners.clear();
      for (const template of templates.values()) template.dispose();
      templates.clear();
    },
  };
}
