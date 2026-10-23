import { Group } from 'three';
import type { MockInstance } from 'vitest';
import type { ClassProgress, ModelClass } from '../lib/twin-core/twinLoadQueue';
import { type ClassTemplate, createMaterialTable } from './classModel';
import type { BytesProgress } from './loadGltf';
import {
  createModelCache,
  MODEL_CONCURRENCY,
  type ModelCache,
  PROGRESS_INTERVAL_MS,
} from './modelCache';

/*
 * The cache is tested with a fake `load` that the test settles by hand and a fake `build`, so no file, no
 * network and no `three` loader is involved. Promises settle on real timers here: `settle()` lets them.
 */

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function cls(code: string, modelUrl = `/models/${code}.0123456789ab.glb`): ModelClass {
  return {
    code,
    name: code.toUpperCase(),
    modelUrl,
    assetCount: 1,
    representative: `${code}-1`,
    distanceM: 0,
  };
}

interface Pending {
  resolve(scene: string): void;
  reject(error: unknown): void;
  onProgress(progress: BytesProgress): void;
}

function setup(options: { concurrency?: number; buildFails?: boolean } = {}) {
  const pending = new Map<string, Pending>();
  const load = vi.fn(
    (url: string, onProgress: (progress: BytesProgress) => void) =>
      new Promise<string>((resolve, reject) => {
        pending.set(url, { resolve, reject, onProgress });
      }),
  );
  const templates: ClassTemplate[] = [];
  const build = vi.fn((scene: string): ClassTemplate => {
    if (options.buildFails) throw new Error(`cannot parse ${scene}`);
    const template: ClassTemplate = {
      root: new Group(),
      lod1: null,
      switchDistanceM: Infinity,
      info: { name: scene },
      materials: createMaterialTable(),
      dispose: vi.fn(),
    };
    templates.push(template);
    return template;
  });
  const report = vi.fn<(classCode: string, progress: ClassProgress) => void>();
  let clock = 0;
  const cache: ModelCache = createModelCache({
    load,
    build,
    report,
    now: () => clock,
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
  });
  return {
    cache,
    load,
    build,
    report,
    pending,
    templates,
    at: (ms: number) => {
      clock = ms;
    },
    urls: () => load.mock.calls.map(([url]) => url),
  };
}

describe('createModelCache', () => {
  let logged: MockInstance<typeof console.error>;

  beforeEach(() => {
    logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => logged.mockRestore());

  describe('requests', () => {
    it('asks for the files in the order given, two at a time', async () => {
      const { cache, pending, urls } = setup();
      const [a, b, c] = [cls('a'), cls('b'), cls('c')] as const;

      cache.start([a, b, c]);
      expect(MODEL_CONCURRENCY).toBe(2);
      expect(urls()).toEqual([a.modelUrl, b.modelUrl]);

      pending.get(a.modelUrl)!.resolve('A');
      await settle();

      expect(urls()).toEqual([a.modelUrl, b.modelUrl, c.modelUrl]);
    });

    it('asks for one file at a time when told to', async () => {
      const { cache, pending, urls } = setup({ concurrency: 1 });
      const [a, b] = [cls('a'), cls('b')] as const;

      cache.start([a, b]);
      expect(urls()).toEqual([a.modelUrl]);

      pending.get(a.modelUrl)!.resolve('A');
      await settle();

      expect(urls()).toEqual([a.modelUrl, b.modelUrl]);
    });

    it('asks once for a file, however many classes or calls want it', async () => {
      const { cache, pending, load } = setup();
      const url = '/models/shared.0123456789ab.glb';

      cache.start([cls('a', url), cls('b', url)]);
      cache.start([cls('a', url)]);
      pending.get(url)!.resolve('S');
      await settle();

      expect(load).toHaveBeenCalledTimes(1);
      expect(cache.get('a')).not.toBeNull();
      expect(cache.get('b')).not.toBeNull();
    });

    it('asks once for a class that two calls of start both list', async () => {
      const { cache, load } = setup();

      cache.start([cls('a')]);
      cache.start([cls('a'), cls('b')]);

      expect(load).toHaveBeenCalledTimes(2);
    });
  });

  describe('a model that arrives', () => {
    it('is built, kept, reported ready with its size and announced', async () => {
      const { cache, pending, report, build } = setup();
      const listener = vi.fn();
      cache.subscribe(listener);
      const a = cls('a');

      cache.start([a]);
      expect(cache.get('a')).toBeNull();
      expect(report).toHaveBeenLastCalledWith('a', { state: 'loading', loaded: 0, total: 0 });

      pending.get(a.modelUrl)!.onProgress({ loaded: 5, total: 10 });
      pending.get(a.modelUrl)!.resolve('A');
      await settle();

      expect(build).toHaveBeenCalledWith('A');
      expect(cache.get('a')).toBe(build.mock.results[0]?.value);
      expect(report).toHaveBeenLastCalledWith('a', { state: 'ready', loaded: 10, total: 10 });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('is reported with the bytes it had when the server never said the total', async () => {
      const { cache, pending, report } = setup();
      const a = cls('a');

      cache.start([a]);
      pending.get(a.modelUrl)!.onProgress({ loaded: 7, total: 0 });
      pending.get(a.modelUrl)!.resolve('A');
      await settle();

      expect(report).toHaveBeenLastCalledWith('a', { state: 'ready', loaded: 7, total: 0 });
    });

    it('reports bytes at most every quarter of a second, and a change of state at once', async () => {
      const { cache, pending, report, at } = setup();
      const a = cls('a');
      cache.start([a]);
      const { onProgress } = pending.get(a.modelUrl)!;
      const loading = () =>
        report.mock.calls.filter(([, progress]) => progress.state === 'loading');

      at(1000);
      onProgress({ loaded: 1, total: 10 });
      at(1000 + PROGRESS_INTERVAL_MS - 1);
      onProgress({ loaded: 2, total: 10 });
      onProgress({ loaded: 3, total: 10 });
      // The start (0 of 0) and the first progress; the two inside the interval were dropped.
      expect(loading().map(([, progress]) => progress.loaded)).toEqual([0, 1]);

      at(1000 + PROGRESS_INTERVAL_MS);
      onProgress({ loaded: 4, total: 10 });
      expect(loading().map(([, progress]) => progress.loaded)).toEqual([0, 1, 4]);

      pending.get(a.modelUrl)!.resolve('A');
      await settle();
      expect(report).toHaveBeenLastCalledWith('a', { state: 'ready', loaded: 10, total: 10 });
    });
  });

  describe('a model that fails', () => {
    it('logs once, reports failed, leaves a null template and is announced', async () => {
      const { cache, pending, report } = setup();
      const listener = vi.fn();
      cache.subscribe(listener);
      const a = cls('a');

      cache.start([a]);
      pending.get(a.modelUrl)!.reject(new Error('404'));
      await settle();

      expect(logged).toHaveBeenCalledTimes(1);
      expect(String(logged.mock.calls[0]?.[0])).toContain('A could not be loaded');
      expect(report).toHaveBeenLastCalledWith('a', { state: 'failed', loaded: 0, total: 0 });
      expect(cache.get('a')).toBeNull();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('is not asked for again, by start or by anything else', async () => {
      const { cache, pending, load } = setup();
      const a = cls('a');
      cache.start([a]);
      pending.get(a.modelUrl)!.reject(new Error('404'));
      await settle();

      cache.start([a]);
      cache.start([a, cls('b')]);
      await settle();

      expect(load.mock.calls.filter(([url]) => url === a.modelUrl)).toHaveLength(1);
      expect(logged).toHaveBeenCalledTimes(1);
    });

    it('leaves the other classes alone', async () => {
      const { cache, pending, report } = setup();
      const [a, b] = [cls('a'), cls('b')] as const;
      cache.start([a, b]);

      pending.get(a.modelUrl)!.reject(new Error('404'));
      pending.get(b.modelUrl)!.resolve('B');
      await settle();

      expect(cache.get('a')).toBeNull();
      expect(cache.get('b')).not.toBeNull();
      expect(report).toHaveBeenCalledWith('b', expect.objectContaining({ state: 'ready' }));
    });

    it('goes on to the next class after a failure', async () => {
      const { cache, pending, urls } = setup({ concurrency: 1 });
      const [a, b] = [cls('a'), cls('b')] as const;
      cache.start([a, b]);

      pending.get(a.modelUrl)!.reject(new Error('404'));
      await settle();

      expect(urls()).toEqual([a.modelUrl, b.modelUrl]);
    });

    it('treats a file that cannot be built, such as a model with no class root, as failed', async () => {
      const { cache, pending, report } = setup({ buildFails: true });
      const a = cls('a');

      cache.start([a]);
      pending.get(a.modelUrl)!.resolve('A');
      await settle();

      expect(logged).toHaveBeenCalledTimes(1);
      expect(report).toHaveBeenLastCalledWith('a', { state: 'failed', loaded: 0, total: 0 });
      expect(cache.get('a')).toBeNull();
    });
  });

  describe('subscribe', () => {
    it('stops announcing to a listener that unsubscribed', async () => {
      const { cache, pending } = setup();
      const listener = vi.fn();
      const stop = cache.subscribe(listener);
      stop();
      const a = cls('a');

      cache.start([a]);
      pending.get(a.modelUrl)!.resolve('A');
      await settle();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('frees the templates it holds', async () => {
      const { cache, pending, templates } = setup();
      const a = cls('a');
      cache.start([a]);
      pending.get(a.modelUrl)!.resolve('A');
      await settle();

      cache.dispose();

      expect(templates[0]?.dispose).toHaveBeenCalledTimes(1);
      expect(cache.get('a')).toBeNull();
    });

    it('drops a result that arrives after it: nothing is built or reported', async () => {
      const { cache, pending, build, report } = setup();
      const a = cls('a');
      cache.start([a]);
      report.mockClear();

      cache.dispose();
      pending.get(a.modelUrl)!.onProgress({ loaded: 1, total: 2 });
      pending.get(a.modelUrl)!.resolve('A');
      await settle();

      expect(build).not.toHaveBeenCalled();
      expect(report).not.toHaveBeenCalled();
    });

    it('does not log a failure that arrives after it', async () => {
      const { cache, pending } = setup();
      const a = cls('a');
      cache.start([a]);

      cache.dispose();
      pending.get(a.modelUrl)!.reject(new Error('aborted'));
      await settle();

      expect(logged).not.toHaveBeenCalled();
    });

    it('starts nothing more, neither the queue nor a later start', async () => {
      const { cache, pending, urls } = setup({ concurrency: 1 });
      const [a, b, c] = [cls('a'), cls('b'), cls('c')] as const;
      cache.start([a, b]);

      cache.dispose();
      pending.get(a.modelUrl)!.resolve('A');
      await settle();
      cache.start([c]);

      expect(urls()).toEqual([a.modelUrl]);
    });
  });
});
