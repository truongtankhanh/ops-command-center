/*
 * The GPU time of a drawn frame for the developer HUD (V3-11.2, V3-11.1's metric), where the browser exposes
 * `EXT_disjoint_timer_query_webgl2`. Information only: the frame **cost** (the CPU's, `createFrameCostClock`) is the
 * figure the target is read from, and whether either reference machine exposes the extension is `unverified`.
 *
 * Why a module of its own: a timer query answers frames later, so the timer keeps a small pool of queries, reads the
 * finished ones in the order they were ended, and drops every pending one when the GPU reports a disjoint (a clock
 * change or a context switch makes those spans meaningless). That bookkeeping is the error-prone part and, kept apart
 * from WebGL here, a spec reaches it with a fake context (jsdom has no WebGL). three's `WebGLRenderer` starts no timer
 * query of its own, so a `TIME_ELAPSED` query around the render cannot collide with one.
 *
 * Every WebGL call sits in `try/catch`: a lost context (`ContextGuard`) leaves the queries invalid, and a call that
 * throws stops the timer for good (it answers nothing from then on) rather than throwing inside R3F's loop.
 *
 * Imported only by the development-only `HudProbe`, so a production build drops it. Pure: no `three`, no React.
 */

/** The extension's two constants this timer needs. */
interface TimerQueryExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

/** The part of `WebGL2RenderingContext` the timer uses, so a spec can pass a fake. */
export interface TimerQueryContext {
  getExtension(name: string): unknown;
  createQuery(): WebGLQuery | null;
  beginQuery(target: number, query: WebGLQuery): void;
  endQuery(target: number): void;
  getQueryParameter(query: WebGLQuery, pname: number): unknown;
  getParameter(pname: number): unknown;
  deleteQuery(query: WebGLQuery | null): void;
  readonly QUERY_RESULT: number;
  readonly QUERY_RESULT_AVAILABLE: number;
}

export interface GpuTimer {
  /** Starts timing this frame on a free query; with none free (results not back yet) the frame is not timed. */
  begin(): void;
  /**
   * Ends the query `begin` started, if it started one. `keep: false` (the default is `true`) drops its result when it
   * arrives: a tick of R3F's loop that drew nothing, whose time would be a near-zero sample (`createFrameCostClock`).
   */
  end(keep?: boolean): void;
  /** The finished frames' GPU times in milliseconds, oldest first; none after a disjoint, which drops the pending ones. */
  poll(): number[];
  /** Deletes every query. The timer answers nothing afterwards. */
  dispose(): void;
}

const isExtension = (value: unknown): value is TimerQueryExtension =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Partial<TimerQueryExtension>).TIME_ELAPSED_EXT === 'number' &&
  typeof (value as Partial<TimerQueryExtension>).GPU_DISJOINT_EXT === 'number';

/** The timer, or `null` when the extension is missing or asking for it throws. */
export function createGpuTimer(
  gl: TimerQueryContext,
  { poolSize = 4 }: { poolSize?: number } = {},
): GpuTimer | null {
  let ext: TimerQueryExtension;
  try {
    const found = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!isExtension(found)) return null;
    ext = found;
  } catch {
    return null;
  }

  const free: WebGLQuery[] = [];
  /** Ended and not read yet, oldest first: results become available in that order. */
  const pending: { query: WebGLQuery; keep: boolean }[] = [];
  let active: WebGLQuery | null = null;
  let created = 0;
  let stopped = false;

  const release = () => {
    const all = [...free, ...pending.map(({ query }) => query)];
    if (active !== null) all.push(active);
    free.length = 0;
    pending.length = 0;
    active = null;
    for (const query of all) {
      try {
        gl.deleteQuery(query);
      } catch {
        // A lost context has nothing left to delete.
      }
    }
  };

  /** Runs `step`; a throw stops the timer and frees what it holds. */
  const guard = <T>(step: () => T, fallback: T): T => {
    if (stopped) return fallback;
    try {
      return step();
    } catch {
      stopped = true;
      release();
      return fallback;
    }
  };

  return {
    begin(): void {
      guard(() => {
        if (active !== null) return;
        let query = free.pop() ?? null;
        if (query === null && created < poolSize) {
          query = gl.createQuery();
          if (query !== null) created += 1;
        }
        if (query === null) return;
        // Held before the call, so a `beginQuery` that throws still leaves the query where `release` deletes it.
        active = query;
        gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      }, undefined);
    },
    end(keep = true): void {
      guard(() => {
        if (active === null) return;
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        pending.push({ query: active, keep });
        active = null;
      }, undefined);
    },
    poll(): number[] {
      return guard(() => {
        if (pending.length === 0) return [];
        if (gl.getParameter(ext.GPU_DISJOINT_EXT) === true) {
          free.push(...pending.splice(0).map(({ query }) => query));
          return [];
        }
        const times: number[] = [];
        for (let next = pending[0]; next !== undefined; next = pending[0]) {
          if (gl.getQueryParameter(next.query, gl.QUERY_RESULT_AVAILABLE) !== true) break;
          const ns = next.keep ? gl.getQueryParameter(next.query, gl.QUERY_RESULT) : null;
          pending.shift();
          free.push(next.query);
          if (typeof ns === 'number' && Number.isFinite(ns)) times.push(ns / 1e6);
        }
        return times;
      }, []);
    },
    dispose(): void {
      stopped = true;
      release();
    },
  };
}
