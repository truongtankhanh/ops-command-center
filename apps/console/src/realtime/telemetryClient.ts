import { type AssetTelemetry, TELEMETRY_WATCH_LIMIT } from '@occ/contracts';
import { api } from '../api/client';
import { getAccessToken, renewSession } from '../auth/session';
import { encodeReading } from '../lib/ringBuffer';
import { initialTelemetryState, type TelemetryState } from '../lib/telemetryState';
import { createTelemetryEngine, type SocketFactory, type TelemetryEngine } from './telemetryEngine';
import {
  type FromWorker,
  isFromWorker,
  type SeriesData,
  TELEMETRY_PROTOCOL_VERSION,
  type ToWorker,
} from './telemetryProtocol';

/**
 * The main-thread side of the telemetry path (ADR-0019, ADR-0020 § State): it starts the worker,
 * answers its token requests, seeds the rings of a watched asset from the history route, and
 * keeps the latest state and series for React to read. The sockets and the rules are the engine's;
 * this module has none of its own.
 */

/** One key's recent points, time in epoch ms on the API's clock. */
export interface SeriesView {
  t: Float64Array;
  v: Float32Array;
}

/** What a reader sees. A new object whenever something in it changed, so it suits a store. */
export interface TelemetryView {
  state: TelemetryState;
  /** Keyed by `seriesKey(assetCode, key)`; only watched assets, only numeric and boolean keys. */
  series: ReadonlyMap<string, SeriesView>;
}

export const seriesKey = (assetCode: string, key: string): string => `${assetCode}|${key}`;

/** What the client needs of a `Worker`, so a test can hand it a fake. */
export interface WorkerLike {
  postMessage(message: unknown, options?: { transfer?: Transferable[] }): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

export interface TelemetryClientOptions {
  /** `null` runs the engine on the main thread: jsdom and old browsers have no `Worker`. */
  createWorker?: () => WorkerLike | null;
  /** The socket the in-thread engine uses; a test supplies a fake. Unused with a worker. */
  createSocket?: SocketFactory;
}

export interface TelemetryClient {
  /** Called after every change of the view; returns the way to stop. */
  subscribe(listener: () => void): () => void;
  getView(): TelemetryView;
  /** The assets whose every reading is wanted, in order of preference. Replaces the last set. */
  setWatch(codes: readonly string[]): void;
  /** Reconnects now and sends the watch set again. */
  retry(): void;
  /** Idempotent. */
  dispose(): void;
}

/**
 * A literal `new Worker(new URL(…), { type: 'module' })`, which is the form Vite bundles the worker
 * from. Without one the console runs the engine on the main thread.
 */
function createModuleWorker(): WorkerLike | null {
  if (typeof Worker === 'undefined') return null;
  return new Worker(new URL('./telemetry.worker.ts', import.meta.url), { type: 'module' });
}

/**
 * The history route's buckets as one series per key. Only what a ring can hold: a number or a
 * boolean (as 0 / 1). An enum's string has no number without its `enumValues`, which the console
 * has no catalogue for here, so it is left out (V2-08.4). Time is the bucket's start, which is the
 * API's receive time rounded down to 5 s.
 */
export function seriesFromHistory(history: AssetTelemetry): SeriesData[] {
  const byKey = new Map<string, { t: number[]; v: number[] }>();
  for (const sample of history.samples) {
    const t = Date.parse(sample.at);
    if (!Number.isFinite(t)) continue;
    for (const [key, value] of Object.entries(sample.values)) {
      const n = encodeReading(value, null);
      if (n === null) continue;
      let column = byKey.get(key);
      if (!column) byKey.set(key, (column = { t: [], v: [] }));
      column.t.push(t);
      column.v.push(n);
    }
  }
  return [...byKey].map(([key, { t, v }]) => ({
    key,
    t: Float64Array.from(t),
    v: Float32Array.from(v),
  }));
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((item, index) => item === b[index]);

export function createTelemetryClient({
  createWorker = createModuleWorker,
  createSocket,
}: TelemetryClientOptions = {}): TelemetryClient {
  const version = TELEMETRY_PROTOCOL_VERSION;
  let view: TelemetryView = { state: initialTelemetryState, series: new Map() };
  const listeners = new Set<() => void>();
  let disposed = false;
  let watched: string[] = [];
  let wasLive = false;
  let hasBeenLive = false;

  const update = (next: TelemetryView) => {
    view = next;
    for (const listener of [...listeners]) listener();
  };

  const worker = createWorker();
  let engine: TelemetryEngine | undefined;

  function send(message: ToWorker, transfer?: Transferable[]) {
    if (disposed) return;
    if (worker) worker.postMessage(message, { transfer });
    // A microtask, as a worker would take it: the engine is never re-entered from its own post.
    else queueMicrotask(() => engine?.receive(message));
  }

  async function answerToken(requestId: number, renew: boolean) {
    let token: string | null = null;
    try {
      if (!renew) token = await getAccessToken();
      else if (await renewSession()) token = await getAccessToken();
    } catch {
      token = null;
    }
    send({ v: version, type: 'token', requestId, token });
  }

  /**
   * History fills the rings under the live points after a reload or a reconnect. Best effort: an
   * older replica answers 404, a busy one 429, and either way the live points still arrive, so a
   * failure is "no history", with no toast and no retry.
   */
  async function seedAsset(assetCode: string) {
    try {
      const history = await api.get<AssetTelemetry>(
        `/assets/${encodeURIComponent(assetCode)}/telemetry`,
      );
      if (disposed || !watched.includes(assetCode)) return;
      const series = seriesFromHistory(history);
      if (series.length === 0) return;
      const transfer = series.flatMap(({ t, v }) => [
        t.buffer as ArrayBuffer,
        v.buffer as ArrayBuffer,
      ]);
      send({ v: version, type: 'seed', assetCode, series }, transfer);
    } catch {
      // No history; see above.
    }
  }

  function applyState(message: Extract<FromWorker, { type: 'state' }>) {
    const previous = view.state;
    const state: TelemetryState = {
      upstream: message.upstream,
      upstreamSince: message.upstreamSince,
      socket: message.socket,
      socketSince: message.socketSince,
      // Re-anchored on this thread's own monotonic clock: the worker's has another origin.
      serverClock:
        message.serverNowMs === null
          ? previous.serverClock
          : { at: message.serverNowMs, mono: performance.now() },
      assets:
        Object.keys(message.assets).length === 0
          ? previous.assets
          : { ...previous.assets, ...message.assets },
    };
    const live = state.socket === 'live';
    // Back after a gap: what the rings missed is in the history, and live points are kept.
    if (live && !wasLive && hasBeenLive) for (const code of watched) void seedAsset(code);
    if (live) hasBeenLive = true;
    wasLive = live;
    update({ ...view, state });
  }

  function applySeries(message: Extract<FromWorker, { type: 'series' }>) {
    const series = new Map(view.series);
    for (const entry of message.entries) {
      series.set(seriesKey(entry.assetCode, entry.key), { t: entry.t, v: entry.v });
    }
    update({ ...view, series });
  }

  function receive(data: unknown) {
    if (disposed || !isFromWorker(data)) return;
    switch (data.type) {
      case 'tokenRequest':
        void answerToken(data.requestId, data.renew);
        return;
      case 'state':
        applyState(data);
        return;
      case 'series':
        applySeries(data);
        return;
      case 'targets':
        return; // reserved for V2-14
    }
  }

  if (worker) {
    worker.onmessage = (event) => receive(event.data);
  } else {
    engine = createTelemetryEngine({
      host: { post: (message) => queueMicrotask(() => receive(message)) },
      createSocket,
    });
  }
  send({ v: version, type: 'connect' });

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    getView: () => view,

    setWatch(codes) {
      if (disposed) return;
      const next = [...new Set(codes)].slice(0, TELEMETRY_WATCH_LIMIT);
      if (sameList(next, watched)) return;
      const added = next.filter((code) => !watched.includes(code));
      const dropped = watched.filter((code) => !next.includes(code));
      watched = next;
      send({ v: version, type: 'watch', assets: next });
      if (dropped.length > 0) {
        // An unwatched asset keeps no ring, so its series would only go stale.
        const series = new Map(
          [...view.series].filter(([id]) => !dropped.includes(id.slice(0, id.indexOf('|')))),
        );
        update({ ...view, series });
      }
      for (const code of added) void seedAsset(code);
    },

    retry: () => send({ v: version, type: 'retry' }),

    dispose() {
      if (disposed) return;
      send({ v: version, type: 'dispose' });
      disposed = true;
      // Terminating also closes the worker's socket, so a `dispose` it has not yet read costs
      // nothing; in-thread, the message above is what closes it.
      worker?.terminate();
      listeners.clear();
    },
  };
}
