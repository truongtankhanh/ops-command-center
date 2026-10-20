/*
 * What the developer HUD of the 3D twin measures and how (V2-19.1, ADR-0020 § Budgets, brief § Performance): a window of
 * frame times, the rate of a cumulative counter, the six values of frame 00, the `?debug=twin` request and the load
 * marks. Pure: no clock (the caller passes `now`, as `createPickStats` does), no React, no three, so it tests without
 * WebGL. V2-19.2 added `needsFrame`; V2-19.3 the pixel-ratio controller; V2-19.4 the budget guard: every export stands
 * alone, so the build keeps only what shipped code imports (the guard is imported by the development-only probe, so it
 * never reaches `dist`). The labels, formats and warning text of the HUD are in `twinHud.ts`, on purpose not here (see there).
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
  /** The renderer's actual pixel ratio (V2-19.3), which is `min(device ratio, step)` and not the controller's step. */
  pixelRatio: number | null;
}

/** What `read` is given besides the time: `gl.info.render`, and the client's counts (`null` without a client). */
export interface HudInput {
  calls: number;
  triangles: number;
  stats: CounterStats | null;
  /** `gl.getPixelRatio()`, or `null` when there is no renderer to ask. */
  pixelRatio: number | null;
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
    read(now: number, { calls, triangles, stats, pixelRatio }: HudInput): HudReading {
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
        pixelRatio,
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

/**
 * Why the on-demand canvas draws another frame by itself (V2-19.2, ADR-0020 § Scene, brief § Worker and render loop:
 * "the loop runs while something moves"). One field for each loop of ours that **keeps itself alive**, written by that
 * loop in the frame it runs and read by `FrameDriver` at the end of the same frame:
 *
 * - `bound`: a bound value has not settled, or a live part spins (`stepBound`, `useBoundParts`). A spin asks for a frame
 *   every frame while it lasts: it is the one steady load of a quiet scene (V2-19.7 reads what it costs).
 * - `flying`: the camera's fly-to is under way (`Rig`).
 * - `pulsing`: a critical open incident pulses on the visible Incidents layer, motion allowed and the tab in view
 *   (`pulseRunning`, `Beacons`).
 *
 * What is **not** a field, on purpose: a camera in motion (drei's `CameraControls` invalidates on its own `update` event
 * and stops at rest), a pick, a label or leader projection after a camera change, a changed look or layer, a reading
 * that arrived. Each of those is a one-shot request tied to a change (an effect or an event calls `invalidate()` once)
 * and nothing keeps it alive, so there is nothing for a loop to report. A reporter must run at a priority below 0
 * (`FrameDriver`), and must set its field to `false` whenever it has nothing to do, so a flag is never left true.
 */
export interface FrameDemand {
  bound: boolean;
  flying: boolean;
  pulsing: boolean;
}

/**
 * How a loop writes its field of the demand: the canvas's `FrameDriver` hands one to the loops under it
 * (`useReportFrameDemand`). A function and not the object itself, because a loop calls it from the frame loop, outside
 * React's render, and an object handed out by a hook is one React's rules say may not be modified.
 */
export type FrameReport = (field: keyof FrameDemand, asking: boolean) => void;

/** A demand with nothing asking, for a canvas that has just been made. */
export const createFrameDemand = (): FrameDemand => ({
  bound: false,
  flying: false,
  pulsing: false,
});

/**
 * Whether the canvas should draw another frame because a loop of ours asked. A hidden tab asks for nothing, whatever
 * the loops say: the browser draws no frame there anyway, and nothing should be queued for the return.
 */
export const needsFrame = (
  demand: Readonly<FrameDemand>,
  { hidden = false }: { hidden?: boolean } = {},
): boolean => !hidden && (demand.bound || demand.flying || demand.pulsing);

/**
 * The pixel-ratio steps (brief § Performance: "Pixel ratio ≤ 1.5; video wall 1.0"), from the sharpest down. The canvas
 * starts at the first and the controller below only ever moves down the list.
 */
export const DPR_STEPS: readonly number[] = [1.5, 1.25, 1.0];

/**
 * How long a frame may take, at the 95th percentile of a window, before the pixel ratio goes down a step (V2-19.3).
 * **18 ms, not the brief's 14.** The brief's "p95 ≤ 14 ms" is the *cost* of a frame; what the controller is fed is the
 * interval between drawn frames, and a display fixes that: about 16.7 ms at 60 Hz whatever a frame costs, so a budget of
 * 14 ms would step down every healthy 60 Hz machine, and the controller never steps up. 18 ms is above a 60 Hz frame and
 * its jitter, below a 50 fps stutter (20 ms) and far above 120 Hz (8.3 ms): a device that misses vsyncs steps down, one
 * that holds 60 does not. An interval also sees a GPU that cannot keep up (the browser queues the work and the frames come
 * later), which is the usual reason to lower a ratio and which a CPU timer around the frame does not. `unverified` until
 * read on the reference hardware (V2-19.7).
 */
export const DPR_BUDGET_MS = 18;

export interface DprControllerOptions {
  /** The ratios to move down through, sharpest first. Default `DPR_STEPS`. */
  steps?: readonly number[];
  /** The p95 of a window above which the ratio goes down a step. Default `DPR_BUDGET_MS`. */
  budgetMs?: number;
  /** The length of a window, in milliseconds. Default 2,000 (brief: "when frames run long for 2 s"). */
  windowMs?: number;
  /**
   * Nothing is judged until this long after the first frame drawn with a scene. A step is never undone, so one caused
   * by the stage's first seconds (shaders, models, the first layout) would last the whole session. Default one window.
   */
  graceMs?: number;
  /** A window with fewer kept frames than this is not judged: a short fly-to does not decide. Default 30. */
  minFrames?: number;
  /** A frame time above this is an idle canvas waking up, not a frame. Default `MAX_FRAME_GAP_MS`. */
  maxGapMs?: number;
  /**
   * The display's pixel ratio. A step above it changes nothing on screen (`min(device ratio, step)`), so the steps are
   * clamped to it and the duplicates dropped: a laptop at 1.25 goes 1.25 → 1.0 and spends no window on 1.5 → 1.25.
   */
  deviceRatio?: number;
  /** Start at the first step at or below this: where an earlier stage of the same page ended (`rememberedDprStep`). */
  initial?: number;
  /** The video wall (V2-21): pinned to the last step, never judged. */
  wall?: boolean;
}

/** The steps clamped to the device ratio (and never below 1), in order, each once. */
function effectiveSteps(steps: readonly number[], deviceRatio: number | undefined): number[] {
  const clamped = steps.map((step) =>
    deviceRatio === undefined ? step : Math.max(1, Math.min(step, deviceRatio)),
  );
  return clamped.filter((step, index) => clamped.indexOf(step) === index);
}

/**
 * Steps the canvas's pixel ratio down when frames run long (V2-19.3, brief § Performance). Fed every drawn frame's time
 * and the clock (`frame(dtMs, now)`), it judges in **tumbling windows**: a window runs for `windowMs`, and at its end, if
 * it kept at least `minFrames` frames and their p95 is above `budgetMs`, the ratio goes one step down (`frame` returns the
 * new step; otherwise `null`). The next window starts at once, so after a step one full window passes before the next
 * judgment, and one frame's resize cost is not mistaken for the new ratio. **It never steps up**: a resolution that
 * flapped would be worse than a stable lower one (`unverified` as a choice). At the last step it does nothing and keeps
 * nothing. No clock inside: the caller passes `now`, so it tests without timers.
 */
export function createDprController({
  steps = DPR_STEPS,
  budgetMs = DPR_BUDGET_MS,
  windowMs = 2000,
  graceMs = windowMs,
  minFrames = 30,
  maxGapMs = MAX_FRAME_GAP_MS,
  deviceRatio,
  initial,
  wall = false,
}: DprControllerOptions = {}) {
  const effective = effectiveSteps(steps, deviceRatio);
  const last = effective.length - 1;
  let index = 0;
  if (wall) index = last;
  else if (initial !== undefined) {
    const found = effective.findIndex((step) => step <= initial);
    index = found === -1 ? last : found;
  }

  // Preallocated, and capped: a 1,000 Hz clock still keeps 1,024 of a window's frames, which is plenty for a percentile.
  const times = new Float64Array(1024);
  let count = 0;
  let startedAt: number | null = null;
  let windowStart: number | null = null;

  return {
    /** The current ratio. */
    get step(): number {
      return effective[index] ?? 1;
    },
    frame(dtMs: number, now: number): number | null {
      if (index >= last) return null;
      startedAt ??= now;
      if (now - startedAt < graceMs) return null;
      windowStart ??= now;
      // Written so that NaN, zero and a gap all fail the test.
      if (dtMs > 0 && dtMs <= maxGapMs && count < times.length) {
        times[count] = dtMs;
        count += 1;
      }
      if (now - windowStart < windowMs) return null;

      const over = count >= minFrames && percentile(times.subarray(0, count), 95) > budgetMs;
      count = 0;
      windowStart = now;
      if (!over) return null;
      index += 1;
      return effective[index] ?? null;
    },
  };
}

// The step the controller has reached, for the life of the page (V2-19.3): a switch to 2D and back unmounts the stage,
// and a stage that began again at 1.5 would flash a sharper picture and degrade a second time. Not in storage: a reload
// is a fresh start and tries 1.5 again.
let rememberedStep: number | null = null;

/** The step an earlier stage of this page ended on, or `null` when none moved. */
export const rememberedDprStep = (): number | null => rememberedStep;

export function rememberDprStep(step: number): void {
  rememberedStep = step;
}

/** Forgets it. For tests, which share the module. */
export function forgetDprStep(): void {
  rememberedStep = null;
}

/**
 * The most draw calls a frame may cost, and the most triangles it may put on screen (brief § Model contract, budgets
 * table: "Draw calls ≤ 150 per frame", "Triangles on screen ≤ 250,000"; ADR-0020 § Budgets). "At most" means a reading
 * equal to the limit is within budget.
 */
export const DRAW_CALL_BUDGET = 150;
export const TRIANGLE_BUDGET = 250_000;

/** The two budgeted figures, named as the HUD's rows are (`calls`, `triangles`), which is how the probe finds the cell. */
export type BudgetFigure = 'calls' | 'triangles';

export interface BudgetBreach {
  figure: BudgetFigure;
  value: number;
  limit: number;
}

/** What `gl.info.render` reports; a figure that is not a finite number is not measured, so it is never a breach. */
export interface BudgetReading {
  calls: number | null | undefined;
  triangles: number | null | undefined;
}

const LIMITS: readonly { figure: BudgetFigure; limit: number }[] = [
  { figure: 'calls', limit: DRAW_CALL_BUDGET },
  { figure: 'triangles', limit: TRIANGLE_BUDGET },
];

/** Every figure of `reading` above its budget (V2-19.4), calls first; empty when the frame is within both. */
export function budgetBreaches(reading: BudgetReading): BudgetBreach[] {
  const breaches: BudgetBreach[] = [];
  for (const { figure, limit } of LIMITS) {
    const value = reading[figure];
    if (typeof value === 'number' && Number.isFinite(value) && value > limit) {
      breaches.push({ figure, value, limit });
    }
  }
  return breaches;
}

/**
 * Remembers which figures were over budget at the last reading, so a scene that stays over warns once and not twice a
 * second: `check` returns every breach (`over`, for marking) and the ones that **began** at this reading (`fresh`, for the
 * warning). The edge is per figure: calls going over while triangles already were is news, and a figure that returns
 * within budget is armed again on its own. No clock. It judges the last frame's reading, taken twice a second between
 * frames: right for a budget about steady views, and it can miss a one-frame spike. A guard that lives as long as its
 * probe warns once per mount.
 */
export function createBudgetGuard() {
  let was = new Set<BudgetFigure>();
  return {
    check(reading: BudgetReading): {
      over: readonly BudgetBreach[];
      fresh: readonly BudgetBreach[];
    } {
      const over = budgetBreaches(reading);
      const fresh = over.filter(({ figure }) => !was.has(figure));
      was = new Set(over.map(({ figure }) => figure));
      return { over, fresh };
    },
    reset(): void {
      was = new Set();
    },
  };
}
