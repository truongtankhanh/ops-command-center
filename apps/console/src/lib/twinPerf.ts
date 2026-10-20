/*
 * What the developer HUD of the 3D twin measures and how (V2-19.1, ADR-0020 § Budgets, brief § Performance): a window of
 * frame times, the rate of a cumulative counter, the six values of frame 00, the `?debug=twin` request and the load
 * marks. Pure: no clock (the caller passes `now`, as `createPickStats` does), no React, no three, so it tests without
 * WebGL. V2-19.2 – V2-19.4 add `needsFrame`, the pixel-ratio controller and the budget guard to this file: every export
 * stands alone, so the build keeps only what shipped code imports. The labels and formats of the HUD are in
 * `twinHud.ts`, on purpose not here (see there).
 */

/**
 * The `p`th percentile (0 – 100, nearest rank) of `values`, or `NaN` for none. Works on a copy: the caller's ring
 * is not reordered.
 */
export function percentile(values: ArrayLike<number>, p: number): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.ceil((p * sorted.length) / 100);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? Number.NaN;
}

/** A frame time above this is an idle canvas waking up, not a frame (Q1 of V2-19.1; `unverified` until read in a browser). */
export const MAX_FRAME_GAP_MS = 250;

/**
 * The last `size` frame times, in milliseconds. The canvas draws only on demand (`frameloop="demand"`), and R3F's
 * `delta` is the time since the previous *drawn* frame, so the first frame after an idle spell carries seconds: that
 * would own the p95 until it left the window. A time above `maxGapMs` is therefore refused (`push` returns `false`),
 * as is anything that is not a positive finite number. The ring is preallocated: pushing allocates nothing, which
 * matters because it runs every frame the HUD is on.
 */
export function createFrameWindow({ size = 120, maxGapMs = MAX_FRAME_GAP_MS } = {}) {
  const ring = new Float64Array(size);
  let next = 0;
  let filled = 0;
  return {
    push(dtMs: number): boolean {
      if (!Number.isFinite(dtMs) || dtMs <= 0 || dtMs > maxGapMs) return false;
      ring[next] = dtMs;
      next = (next + 1) % size;
      filled = Math.min(size, filled + 1);
      return true;
    },
    /** The 95th percentile of what the window holds, or `NaN` while it is empty. */
    p95: (): number => percentile(ring.subarray(0, filled), 95),
    get count(): number {
      return filled;
    },
    clear(): void {
      next = 0;
      filled = 0;
    },
  };
}

/** What changed in a counter between two baselines. */
export interface CounterChange {
  delta: number;
  elapsedMs: number;
  /** The change of the auxiliary count passed alongside (frames drawn, for "posts per frame"), over the same span. */
  auxDelta: number;
}

/**
 * Turns a cumulative counter into changes over the real time between them. The telemetry engine posts its counts at
 * most once a second (`STATS_MIN_INTERVAL_MS`), so a 500 ms refresh sees the same number twice: dividing by the tick
 * would halve the rate. The baseline moves only when the counter does.
 *
 * `sample` returns `null` for the first value (it is the baseline), for an unchanged value, for **a decrease** (a
 * replaced client restarts at 0: the baseline is reset, a negative rate is never produced) and for a change after
 * more than `maxSpanMs` of silence (a rate over a long quiet spell would understate the burst that ended it).
 */
export function createChangeTracker({ maxSpanMs = Number.POSITIVE_INFINITY } = {}) {
  let baseline: { value: number; at: number; aux: number } | null = null;
  return {
    sample(value: number, now: number, aux = 0): CounterChange | null {
      if (baseline === null || value < baseline.value) {
        baseline = { value, at: now, aux };
        return null;
      }
      if (value === baseline.value) return null;
      const elapsedMs = now - baseline.at;
      const change = { delta: value - baseline.value, elapsedMs, auxDelta: aux - baseline.aux };
      baseline = { value, at: now, aux };
      return elapsedMs > maxSpanMs ? null : change;
    },
    /** Milliseconds since the baseline last moved, or `null` before the first sample. */
    idleMs: (now: number): number | null => (baseline === null ? null : now - baseline.at),
    reset(): void {
      baseline = null;
    },
  };
}

/** The telemetry client's cumulative counts (`TelemetryStats`, V2-14.4), as far as the HUD needs them. */
export interface CounterStats {
  messages: number;
  targetPosts: number;
}

/** What the HUD shows, one field per row; `null` is "no value" (drawn as a dash), never a made-up zero. */
export interface HudReading {
  /** Frames drawn per second over the last window; `0` while the canvas is idle. */
  fps: number | null;
  /** 95th percentile of the accepted frame times, in milliseconds. */
  frameP95Ms: number | null;
  calls: number;
  triangles: number;
  messagesPerSecond: number | null;
  postsPerFrame: number | null;
}

/** What `read` is given besides the time: `gl.info.render`, and the client's counts (`null` without a client). */
export interface HudInput {
  calls: number;
  triangles: number;
  stats: CounterStats | null;
}

/**
 * The maths of the six values. `frame(dtMs)` is called from the render loop for every frame drawn; `read(now, input)`
 * from a timer, twice a second. FPS is frames drawn since the last read over the real time between reads, so an idle
 * canvas reads 0 (V2-19.2 expects it); the p95 is over the accepted frame times only, so a gap is a frame for FPS
 * and not a data point. A counter that has not moved for `staleMs` reads 0 (no messages is a rate of zero), and
 * without a client both telemetry fields are `null` and the trackers start over.
 */
export function createPerfSampler({ staleMs = 2500 } = {}) {
  const times = createFrameWindow();
  const messages = createChangeTracker({ maxSpanMs: staleMs });
  const posts = createChangeTracker({ maxSpanMs: staleMs });
  let framesInWindow = 0;
  let totalFrames = 0;
  let windowStart: number | null = null;
  let messageRate: number | null = null;
  let postRatio: number | null = null;

  return {
    frame(dtMs: number): void {
      framesInWindow += 1;
      totalFrames += 1;
      times.push(dtMs);
    },
    read(now: number, { calls, triangles, stats }: HudInput): HudReading {
      let fps: number | null = null;
      if (windowStart !== null && now > windowStart) {
        fps = (framesInWindow * 1000) / (now - windowStart);
      }
      windowStart = now;
      framesInWindow = 0;

      if (stats === null) {
        messages.reset();
        posts.reset();
        messageRate = null;
        postRatio = null;
      } else {
        const message = messages.sample(stats.messages, now);
        if (message !== null) messageRate = (message.delta * 1000) / message.elapsedMs;
        const post = posts.sample(stats.targetPosts, now, totalFrames);
        // A change that spans no drawn frame says nothing about posts per frame: the last ratio stays.
        if (post !== null && post.auxDelta > 0) postRatio = post.delta / post.auxDelta;
        if ((messages.idleMs(now) ?? 0) > staleMs) messageRate = 0;
        if ((posts.idleMs(now) ?? 0) > staleMs) postRatio = 0;
      }

      const p95 = times.p95();
      return {
        fps,
        frameP95Ms: Number.isNaN(p95) ? null : p95,
        calls,
        triangles,
        messagesPerSecond: messageRate,
        postsPerFrame: postRatio,
      };
    },
  };
}

/**
 * Whether the address asks for the HUD: a `debug` parameter equal to `twin`. Only half of the gate: the HUD also needs
 * a development build, decided where each piece is imported (a literal `import.meta.env.MODE` there, which the
 * production build folds away; a helper would not be). Never throws.
 */
export function debugTwinRequested(search: string): boolean {
  try {
    return new URLSearchParams(search).get('debug') === 'twin';
  } catch {
    return false;
  }
}

/** The load marks of V2-19.7: `performance.measure('twin:data', 'twin:first-frame')` is the first useful frame. */
export type TwinMark = 'twin:data' | 'twin:first-frame' | 'twin:models-done';

const MARKS: readonly TwinMark[] = ['twin:data', 'twin:first-frame', 'twin:models-done'];
const marked = new Set<TwinMark>();

/**
 * Marks `name` on the performance timeline, once per stage mount. Shipped in every build (V2-19.1, Q4): a mark is a
 * few bytes that stay in the browser, and the cold-load measurement is taken on the production build. A browser
 * without the API, or a mark that throws, costs nothing.
 */
export function markTwin(name: TwinMark): void {
  if (marked.has(name)) return;
  marked.add(name);
  try {
    performance.mark(name);
  } catch {
    // No Performance API here: the measurement is lost, the stage is not.
  }
}

/** Forgets the marks of this stage, so a stage mounted later marks again (`measure` reads the latest of each name). */
export function clearTwinMarks(): void {
  marked.clear();
  try {
    for (const name of MARKS) performance.clearMarks(name);
  } catch {
    // As above.
  }
}
