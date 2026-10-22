import {
  budgetBreaches,
  clearTwinMarks,
  createBudgetGuard,
  createChangeTracker,
  createDprController,
  createFallbackDetector,
  createFrameDemand,
  createFrameWindow,
  createPerfSampler,
  DPR_BUDGET_MS,
  DPR_STEPS,
  FALLBACK_AFTER_MS,
  FALLBACK_BUDGET_MS,
  debugTwinRequested,
  DRAW_CALL_BUDGET,
  forgetDprStep,
  type FrameDemand,
  type HudInput,
  markTwin,
  MAX_FRAME_GAP_MS,
  needsFrame,
  percentile,
  rememberDprStep,
  rememberedDprStep,
  TRIANGLE_BUDGET,
} from './twinPerf';

describe('percentile', () => {
  it('takes the nearest rank of a known list', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(100);
    expect(percentile(values, 10)).toBe(10);
    expect(percentile(values, 11)).toBe(20);
  });

  it('is the value itself for one value and NaN for none', () => {
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 95)).toBeNaN();
  });

  it('counts ties once each and does not reorder its input', () => {
    const values = [5, 1, 5, 1, 5];

    expect(percentile(values, 40)).toBe(1);
    expect(percentile(values, 41)).toBe(5);
    expect(values).toEqual([5, 1, 5, 1, 5]);
  });

  it('picks rank 114 of 120 for the 95th percentile', () => {
    const values = Array.from({ length: 120 }, (_, i) => i + 1);

    expect(percentile(values, 95)).toBe(114);
  });
});

describe('createFrameWindow', () => {
  it('keeps the last 120 times: the oldest drop out', () => {
    const window = createFrameWindow();
    for (let i = 0; i < 120; i += 1) window.push(10);
    for (let i = 0; i < 120; i += 1) window.push(20);

    expect(window.count).toBe(120);
    expect(window.p95()).toBe(20);
  });

  it('reports the p95 of what it holds, NaN while empty', () => {
    const window = createFrameWindow();
    expect(window.p95()).toBeNaN();

    for (let i = 1; i <= 100; i += 1) window.push(i);

    expect(window.count).toBe(100);
    expect(window.p95()).toBe(95);
  });

  it('refuses a gap above the cut-off and accepts the cut-off itself', () => {
    const window = createFrameWindow();

    expect(window.push(MAX_FRAME_GAP_MS + 1)).toBe(false);
    expect(window.push(MAX_FRAME_GAP_MS)).toBe(true);
    expect(window.count).toBe(1);
  });

  it.each([0, -3, Number.NaN, Number.POSITIVE_INFINITY])('refuses %s', (value) => {
    const window = createFrameWindow();

    expect(window.push(value)).toBe(false);
    expect(window.count).toBe(0);
  });

  it('starts over after clear', () => {
    const window = createFrameWindow();
    window.push(16);

    window.clear();

    expect(window.count).toBe(0);
    expect(window.p95()).toBeNaN();
  });
});

describe('createChangeTracker', () => {
  it('takes the first value as the baseline and an unchanged value as nothing', () => {
    const tracker = createChangeTracker();

    expect(tracker.sample(10, 0)).toBeNull();
    expect(tracker.sample(10, 500)).toBeNull();
  });

  it('measures a change over the real time since the last baseline', () => {
    const tracker = createChangeTracker();
    tracker.sample(0, 0);

    expect(tracker.sample(0, 500)).toBeNull();
    expect(tracker.sample(84, 1000)).toEqual({ delta: 84, elapsedMs: 1000, auxDelta: 0 });
    expect(tracker.sample(84, 1500)).toBeNull();
    expect(tracker.sample(180, 2000)).toEqual({ delta: 96, elapsedMs: 1000, auxDelta: 0 });
  });

  it('carries an auxiliary count over the same span', () => {
    const tracker = createChangeTracker();
    tracker.sample(0, 0, 100);

    expect(tracker.sample(2, 1000, 160)).toEqual({ delta: 2, elapsedMs: 1000, auxDelta: 60 });
  });

  it('resets on a decrease and never returns a negative change', () => {
    const tracker = createChangeTracker();
    tracker.sample(500, 0);

    expect(tracker.sample(3, 1000)).toBeNull();
    expect(tracker.sample(13, 2000)).toEqual({ delta: 10, elapsedMs: 1000, auxDelta: 0 });
  });

  it('drops a change that ends a silence longer than maxSpanMs, and moves the baseline', () => {
    const tracker = createChangeTracker({ maxSpanMs: 2500 });
    tracker.sample(0, 0);

    expect(tracker.sample(50, 10_000)).toBeNull();
    expect(tracker.sample(60, 11_000)).toEqual({ delta: 10, elapsedMs: 1000, auxDelta: 0 });
  });

  it('says how long the baseline has stood, and forgets it on reset', () => {
    const tracker = createChangeTracker();
    expect(tracker.idleMs(100)).toBeNull();

    tracker.sample(1, 100);
    expect(tracker.idleMs(700)).toBe(600);

    tracker.reset();
    expect(tracker.idleMs(900)).toBeNull();
  });
});

describe('createPerfSampler', () => {
  const input = (overrides: Partial<HudInput> = {}): HudInput => ({
    calls: 96,
    triangles: 182_000,
    stats: null,
    pixelRatio: 1.25,
    geometries: 31,
    textures: 4,
    ...overrides,
  });
  const drawFrames = (sampler: ReturnType<typeof createPerfSampler>, count: number, dt = 16.7) => {
    for (let i = 0; i < count; i += 1) sampler.frame(dt);
  };

  it('has no frame rate before it has a window, then reads frames over the real time', () => {
    const sampler = createPerfSampler();
    drawFrames(sampler, 5);

    expect(sampler.read(1000, input()).fps).toBeNull();

    drawFrames(sampler, 30);
    expect(sampler.read(1500, input()).fps).toBe(60);
  });

  it('reads 0 frames a second for an idle window', () => {
    const sampler = createPerfSampler();
    sampler.read(0, input());
    drawFrames(sampler, 10);
    sampler.read(500, input());

    expect(sampler.read(1000, input()).fps).toBe(0);
  });

  it('keeps the p95 of the last accepted frames while idle', () => {
    const sampler = createPerfSampler();
    sampler.read(0, input());
    drawFrames(sampler, 20, 12);

    sampler.read(500, input());
    const idle = sampler.read(1000, input());

    expect(idle.fps).toBe(0);
    expect(idle.frameP95Ms).toBe(12);
  });

  it('has no p95 before a frame was accepted', () => {
    const sampler = createPerfSampler();

    expect(sampler.read(0, input()).frameP95Ms).toBeNull();
  });

  it('counts a gap frame for the frame rate and leaves it out of the p95', () => {
    const sampler = createPerfSampler();
    sampler.read(0, input());
    drawFrames(sampler, 29, 16);
    sampler.frame(5000);

    const reading = sampler.read(500, input());

    expect(reading.fps).toBe(60);
    expect(reading.frameP95Ms).toBe(16);
  });

  it('passes the pixel ratio through, and a missing one as null', () => {
    expect(createPerfSampler().read(0, input()).pixelRatio).toBe(1.25);
    expect(createPerfSampler().read(0, input({ pixelRatio: null })).pixelRatio).toBeNull();
  });

  it('passes what the GPU holds through, and a missing figure as null (V2-19.6)', () => {
    const reading = createPerfSampler().read(0, input({ geometries: 12, textures: 0 }));

    expect(reading.geometries).toBe(12);
    expect(reading.textures).toBe(0);
    const unknown = createPerfSampler().read(0, input({ geometries: null, textures: null }));
    expect(unknown.geometries).toBeNull();
    expect(unknown.textures).toBeNull();
  });

  it('passes the draw calls and triangles through', () => {
    const reading = createPerfSampler().read(0, input({ calls: 12, triangles: 3400 }));

    expect(reading.calls).toBe(12);
    expect(reading.triangles).toBe(3400);
  });

  it('reads messages a second and posts per frame over the span of a change', () => {
    const sampler = createPerfSampler();
    sampler.read(0, input({ stats: { messages: 0, targetPosts: 0 } }));
    // Half a second: the engine has posted nothing new yet.
    drawFrames(sampler, 30);
    const quiet = sampler.read(500, input({ stats: { messages: 0, targetPosts: 0 } }));
    expect(quiet.messagesPerSecond).toBeNull();
    expect(quiet.postsPerFrame).toBeNull();

    // One second after the baseline: 84 messages and 60 posts over 60 frames.
    drawFrames(sampler, 30);
    const moving = sampler.read(1000, input({ stats: { messages: 84, targetPosts: 60 } }));

    expect(moving.messagesPerSecond).toBe(84);
    expect(moving.postsPerFrame).toBe(1);

    // The next tick sees the same stats: the last rates stay.
    drawFrames(sampler, 30);
    const held = sampler.read(1500, input({ stats: { messages: 84, targetPosts: 60 } }));
    expect(held.messagesPerSecond).toBe(84);
    expect(held.postsPerFrame).toBe(1);
  });

  it('reads a fraction of a post a frame', () => {
    const sampler = createPerfSampler();
    sampler.read(0, input({ stats: { messages: 0, targetPosts: 0 } }));
    drawFrames(sampler, 60);

    const reading = sampler.read(1000, input({ stats: { messages: 10, targetPosts: 30 } }));

    expect(reading.postsPerFrame).toBe(0.5);
  });

  it('keeps the last ratio when a change spans no drawn frame', () => {
    const sampler = createPerfSampler();
    sampler.read(0, input({ stats: { messages: 0, targetPosts: 0 } }));
    drawFrames(sampler, 60);
    sampler.read(1000, input({ stats: { messages: 10, targetPosts: 60 } }));

    const reading = sampler.read(2000, input({ stats: { messages: 20, targetPosts: 70 } }));

    expect(reading.postsPerFrame).toBe(1);
    expect(reading.messagesPerSecond).toBe(10);
  });

  it('reads 0 for counters that stopped, after the stale time', () => {
    const sampler = createPerfSampler({ staleMs: 2500 });
    sampler.read(0, input({ stats: { messages: 0, targetPosts: 0 } }));
    sampler.read(1000, input({ stats: { messages: 50, targetPosts: 10 } }));

    const stale = sampler.read(3600, input({ stats: { messages: 50, targetPosts: 10 } }));

    expect(stale.messagesPerSecond).toBe(0);
    expect(stale.postsPerFrame).toBe(0);
  });

  it('has no telemetry values without a client, and starts over when one comes back', () => {
    const sampler = createPerfSampler();
    sampler.read(0, input({ stats: { messages: 100, targetPosts: 10 } }));
    sampler.read(1000, input({ stats: { messages: 200, targetPosts: 20 } }));

    const none = sampler.read(1500, input({ stats: null }));
    expect(none.messagesPerSecond).toBeNull();
    expect(none.postsPerFrame).toBeNull();

    // The new client starts at 0: the first sample is a baseline, never a negative rate.
    const restarted = sampler.read(2000, input({ stats: { messages: 5, targetPosts: 1 } }));
    expect(restarted.messagesPerSecond).toBeNull();
  });
});

describe('debugTwinRequested', () => {
  it.each([
    ['?debug=twin', true],
    ['debug=twin', true],
    ['?a=1&debug=twin', true],
    ['?debug=twin&a=1', true],
    ['', false],
    ['?debug', false],
    ['?debug=', false],
    ['?debug=twin2', false],
    ['?debug=twins', false],
    ['?Debug=twin', false],
    ['?debug=Twin', false],
    ['?twin=1', false],
  ])('%j → %s', (search, expected) => {
    expect(debugTwinRequested(search)).toBe(expected);
  });

  it('does not throw on a malformed string', () => {
    expect(debugTwinRequested('?debug=twin&%E0%A4%A')).toBe(true);
    expect(debugTwinRequested('%')).toBe(false);
  });
});

describe('markTwin', () => {
  const mark = vi.fn();
  const clearMarks = vi.fn();

  beforeEach(() => {
    mark.mockReset();
    clearMarks.mockReset();
    vi.stubGlobal('performance', { mark, clearMarks });
    clearTwinMarks();
    clearMarks.mockClear();
  });
  afterEach(() => {
    clearTwinMarks();
    vi.unstubAllGlobals();
  });

  it('marks a name once', () => {
    markTwin('twin:data');
    markTwin('twin:data');

    expect(mark).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledWith('twin:data');
  });

  it('marks each of the three names on its own', () => {
    markTwin('twin:data');
    markTwin('twin:first-frame');
    markTwin('twin:models-done');

    expect(mark.mock.calls.map(([name]) => name)).toEqual([
      'twin:data',
      'twin:first-frame',
      'twin:models-done',
    ]);
  });

  it('marks again after the marks were cleared, and clears all three on the timeline', () => {
    markTwin('twin:data');

    clearTwinMarks();
    markTwin('twin:data');

    expect(mark).toHaveBeenCalledTimes(2);
    expect(clearMarks.mock.calls.map(([name]) => name)).toEqual([
      'twin:data',
      'twin:first-frame',
      'twin:models-done',
    ]);
  });

  it('costs nothing where the Performance API is missing or throws', () => {
    vi.stubGlobal('performance', {});
    expect(() => markTwin('twin:data')).not.toThrow();
    expect(() => clearTwinMarks()).not.toThrow();

    vi.stubGlobal('performance', {
      mark: () => {
        throw new Error('no');
      },
      clearMarks: () => {
        throw new Error('no');
      },
    });
    expect(() => markTwin('twin:first-frame')).not.toThrow();
    expect(() => clearTwinMarks()).not.toThrow();
  });
});

describe('needsFrame', () => {
  const asking = (field: keyof FrameDemand): FrameDemand => ({
    ...createFrameDemand(),
    [field]: true,
  });

  it('asks for nothing when no loop asks', () => {
    expect(needsFrame(createFrameDemand())).toBe(false);
  });

  it.each<[string, keyof FrameDemand]>([
    ['a bound value that has not settled, or a spin', 'bound'],
    ['a fly-to', 'flying'],
    ['a pulsing beacon', 'pulsing'],
    ['a held pan button', 'panning'],
  ])('asks for a frame for %s', (_, field) => {
    expect(needsFrame(asking(field))).toBe(true);
  });

  it('asks while several loops ask', () => {
    expect(needsFrame({ bound: true, flying: true, pulsing: true, panning: true })).toBe(true);
  });

  it.each<keyof FrameDemand>(['bound', 'flying', 'pulsing', 'panning'])(
    'asks for nothing in a hidden tab, even for %s',
    (field) => {
      expect(needsFrame(asking(field), { hidden: true })).toBe(false);
    },
  );

  it('asks for nothing in a hidden tab when every loop asks', () => {
    expect(
      needsFrame({ bound: true, flying: true, pulsing: true, panning: true }, { hidden: true }),
    ).toBe(false);
  });

  it('is not hidden by default and when told it is in view', () => {
    expect(needsFrame(asking('bound'), {})).toBe(true);
    expect(needsFrame(asking('bound'), { hidden: false })).toBe(true);
  });
});

describe('createFrameDemand', () => {
  it('starts with every loop quiet', () => {
    expect(createFrameDemand()).toEqual({
      bound: false,
      flying: false,
      pulsing: false,
      panning: false,
    });
  });

  it('gives a fresh object each time, so two canvases do not share a flag', () => {
    const first = createFrameDemand();
    first.bound = true;

    expect(createFrameDemand().bound).toBe(false);
  });
});

describe('createDprController', () => {
  type Controller = ReturnType<typeof createDprController>;
  interface Move {
    at: number;
    step: number;
  }

  /** Frames of `dt` ms for `seconds` of the clock, from `from`; every step the controller returns, and when. */
  function run(
    controller: Controller,
    { dt, seconds, from = 0 }: { dt: number; seconds: number; from?: number },
  ) {
    const moves: Move[] = [];
    for (let now = from; now <= from + seconds * 1000; now += dt) {
      const step = controller.frame(dt, now);
      if (step !== null) moves.push({ at: now, step });
    }
    return moves;
  }

  /** The task's examples count from the first frame: no grace. */
  const make = (options: Parameters<typeof createDprController>[0] = {}) =>
    createDprController({ graceMs: 0, ...options });

  afterEach(() => forgetDprStep());

  it('starts at the sharpest step and uses the brief’s steps and an interval budget above a 60 Hz frame', () => {
    expect(createDprController().step).toBe(1.5);
    expect(DPR_STEPS).toEqual([1.5, 1.25, 1.0]);
    expect(DPR_BUDGET_MS).toBeGreaterThan(1000 / 60);
    expect(DPR_BUDGET_MS).toBeLessThan(20);
  });

  describe('the task’s examples', () => {
    it('frames of 20 ms: 1.5 drops to 1.25 after 2 s and to 1.0 after 4 s, and stops', () => {
      const controller = make();

      expect(run(controller, { dt: 20, seconds: 14 })).toEqual([
        { at: 2000, step: 1.25 },
        { at: 4000, step: 1.0 },
      ]);
      expect(controller.step).toBe(1.0);
    });

    it('frames of 8 ms: never moves', () => {
      const controller = make();

      expect(run(controller, { dt: 8, seconds: 30 })).toEqual([]);
      expect(controller.step).toBe(1.5);
    });
  });

  describe('a healthy display', () => {
    it('a 60 Hz display (16.7 ms frames) never moves, with the defaults and without the grace', () => {
      expect(run(createDprController(), { dt: 16.7, seconds: 60 })).toEqual([]);
      expect(run(make(), { dt: 16.7, seconds: 60 })).toEqual([]);
    });

    it('a 120 Hz display (8.3 ms frames) never moves', () => {
      expect(run(createDprController(), { dt: 8.3, seconds: 30 })).toEqual([]);
    });

    it('a display that holds only 30 fps (33 ms frames) steps down', () => {
      expect(run(make(), { dt: 33, seconds: 5 })).toHaveLength(2);
    });
  });

  describe('the budget', () => {
    it('does not step at exactly the budget and steps just above it', () => {
      expect(run(make({ budgetMs: 18 }), { dt: 18, seconds: 10 })).toEqual([]);
      expect(run(make({ budgetMs: 18 }), { dt: 18.1, seconds: 3 })).toHaveLength(1);
    });

    it('does not step for a few long frames among many short ones (under 5 %)', () => {
      const controller = make();
      const moves: Move[] = [];
      for (let i = 0; i <= 100; i += 1) {
        const step = controller.frame(i % 30 === 0 ? 30 : 10, i * 20);
        if (step !== null) moves.push({ at: i * 20, step });
      }

      expect(moves).toEqual([]);
    });
  });

  describe('what it does not judge', () => {
    it('a window with fewer frames than the minimum, however slow, and judges the next full one', () => {
      const controller = make();

      expect(run(controller, { dt: 100, seconds: 2 })).toEqual([]);
      expect(run(controller, { dt: 20, seconds: 2, from: 2020 })).toEqual([
        { at: 4000, step: 1.25 },
      ]);
    });

    it('a frame time above the gap is not a frame: a run of them keeps nothing', () => {
      const controller = make();
      const moves: Move[] = [];
      for (let now = 0; now <= 6000; now += 20) {
        const step = controller.frame(300, now);
        if (step !== null) moves.push({ at: now, step });
      }

      expect(moves).toEqual([]);
    });

    it.each([0, -5, Number.NaN])('a frame time of %s is not a frame', (dt) => {
      const controller = make();
      const moves: Move[] = [];
      for (let now = 0; now <= 6000; now += 20) {
        const step = controller.frame(dt, now);
        if (step !== null) moves.push({ at: now, step });
      }

      expect(moves).toEqual([]);
    });
  });

  describe('the grace', () => {
    it('by default nothing is judged before a window of grace and a window: 20 ms frames step at 4 s and 6 s', () => {
      expect(run(createDprController(), { dt: 20, seconds: 10 })).toEqual([
        { at: 4000, step: 1.25 },
        { at: 6000, step: 1.0 },
      ]);
    });

    it('a slow load inside the grace is ignored', () => {
      const controller = createDprController();

      expect(run(controller, { dt: 50, seconds: 1.9 })).toEqual([]);
      expect(run(controller, { dt: 10, seconds: 10, from: 2000 })).toEqual([]);
      expect(controller.step).toBe(1.5);
    });

    it('counts the grace from the first frame, whenever that is', () => {
      const controller = createDprController();

      expect(run(controller, { dt: 20, seconds: 10, from: 60_000 })).toEqual([
        { at: 64_000, step: 1.25 },
        { at: 66_000, step: 1.0 },
      ]);
    });
  });

  describe('a step', () => {
    it('is followed by one full window before the next', () => {
      const moves = run(make(), { dt: 20, seconds: 10 });

      expect(moves[1]!.at - moves[0]!.at).toBe(2000);
    });

    it('is never undone: frames that get fast again leave the ratio where it is', () => {
      const controller = make();
      run(controller, { dt: 20, seconds: 2 });
      expect(controller.step).toBe(1.25);

      expect(run(controller, { dt: 8, seconds: 20, from: 2020 })).toEqual([]);
      expect(controller.step).toBe(1.25);
    });

    it('returns the new step from frame, and null otherwise', () => {
      const controller = make({ minFrames: 1 });

      expect(controller.frame(20, 0)).toBeNull();
      expect(controller.frame(20, 2000)).toBe(1.25);
      expect(controller.frame(20, 2020)).toBeNull();
    });
  });

  describe('the device ratio', () => {
    it('a laptop at 1.25 goes 1.25 → 1.0 and spends no window on a step that changes nothing', () => {
      const controller = make({ deviceRatio: 1.25 });

      expect(controller.step).toBe(1.25);
      expect(run(controller, { dt: 20, seconds: 10 })).toEqual([{ at: 2000, step: 1.0 }]);
    });

    it('a display at 1 has nothing to give up: it never moves, however slow', () => {
      const controller = make({ deviceRatio: 1 });

      expect(controller.step).toBe(1);
      expect(run(controller, { dt: 50, seconds: 10 })).toEqual([]);
    });

    it('a display at 2 keeps all three steps', () => {
      const controller = make({ deviceRatio: 2 });

      expect(controller.step).toBe(1.5);
      expect(run(controller, { dt: 20, seconds: 10 }).map(({ step }) => step)).toEqual([1.25, 1.0]);
    });

    it('never goes below a ratio of 1', () => {
      expect(make({ deviceRatio: 0.8 }).step).toBe(1);
    });
  });

  describe('starting where an earlier stage ended', () => {
    it('starts at the first step at or below the one given', () => {
      expect(make({ initial: 1.25 }).step).toBe(1.25);
      expect(make({ initial: 1.4 }).step).toBe(1.25);
      expect(make({ initial: 1.5 }).step).toBe(1.5);
      expect(make({ initial: 3 }).step).toBe(1.5);
    });

    it('starts at the last step when the one given is below them all', () => {
      expect(make({ initial: 0.5 }).step).toBe(1.0);
    });

    it('continues from there: from 1.25 one more step is the last', () => {
      expect(run(make({ initial: 1.25 }), { dt: 20, seconds: 10 })).toEqual([
        { at: 2000, step: 1.0 },
      ]);
    });
  });

  describe('the video wall', () => {
    it('is pinned to the last step from the start and never judges', () => {
      const controller = make({ wall: true });

      expect(controller.step).toBe(1.0);
      expect(run(controller, { dt: 100, seconds: 10 })).toEqual([]);
      expect(controller.step).toBe(1.0);
    });
  });
});

describe('the remembered pixel-ratio step', () => {
  afterEach(() => forgetDprStep());

  it('is none until a step is remembered, then the last one, until it is forgotten', () => {
    expect(rememberedDprStep()).toBeNull();

    rememberDprStep(1.25);
    expect(rememberedDprStep()).toBe(1.25);

    rememberDprStep(1.0);
    expect(rememberedDprStep()).toBe(1.0);

    forgetDprStep();
    expect(rememberedDprStep()).toBeNull();
  });
});

describe('budgetBreaches', () => {
  it('holds the brief’s limits', () => {
    expect(DRAW_CALL_BUDGET).toBe(150);
    expect(TRIANGLE_BUDGET).toBe(250_000);
  });

  it('counts a reading equal to a limit as within budget and one above it as a breach', () => {
    expect(budgetBreaches({ calls: 150, triangles: 250_000 })).toEqual([]);
    expect(budgetBreaches({ calls: 151, triangles: 250_000 })).toEqual([
      { figure: 'calls', value: 151, limit: 150 },
    ]);
    expect(budgetBreaches({ calls: 150, triangles: 250_001 })).toEqual([
      { figure: 'triangles', value: 250_001, limit: 250_000 },
    ]);
  });

  it('lists both figures, calls first, when both are over', () => {
    expect(budgetBreaches({ calls: 400, triangles: 900_000 })).toEqual([
      { figure: 'calls', value: 400, limit: 150 },
      { figure: 'triangles', value: 900_000, limit: 250_000 },
    ]);
  });

  it('finds nothing in an empty scene', () => {
    expect(budgetBreaches({ calls: 0, triangles: 0 })).toEqual([]);
  });

  it('never calls an unmeasured figure a breach', () => {
    expect(budgetBreaches({ calls: Number.NaN, triangles: Number.NaN })).toEqual([]);
    expect(budgetBreaches({ calls: undefined, triangles: null })).toEqual([]);
    expect(budgetBreaches({ calls: Number.POSITIVE_INFINITY, triangles: 1 })).toEqual([]);
  });
});

describe('createBudgetGuard', () => {
  const within = { calls: 96, triangles: 182_000 };

  it('reports a first reading over budget as fresh', () => {
    const guard = createBudgetGuard();

    const { over, fresh } = guard.check({ calls: 151, triangles: 10 });

    expect(over).toEqual([{ figure: 'calls', value: 151, limit: 150 }]);
    expect(fresh).toEqual(over);
  });

  it('does not report the same breach again while it lasts, though it is still over', () => {
    const guard = createBudgetGuard();
    guard.check({ calls: 151, triangles: 10 });

    const second = guard.check({ calls: 160, triangles: 10 });

    expect(second.over).toHaveLength(1);
    expect(second.fresh).toEqual([]);
  });

  it('arms a figure again once it is back within budget', () => {
    const guard = createBudgetGuard();
    guard.check({ calls: 151, triangles: 10 });

    const back = guard.check(within);
    const again = guard.check({ calls: 152, triangles: 10 });

    expect(back).toEqual({ over: [], fresh: [] });
    expect(again.fresh).toEqual([{ figure: 'calls', value: 152, limit: 150 }]);
  });

  it('treats each figure on its own: a second figure going over is fresh, the first is not', () => {
    const guard = createBudgetGuard();
    guard.check({ calls: 151, triangles: 10 });

    const { over, fresh } = guard.check({ calls: 151, triangles: 250_001 });

    expect(over.map(({ figure }) => figure)).toEqual(['calls', 'triangles']);
    expect(fresh.map(({ figure }) => figure)).toEqual(['triangles']);
  });

  it('reports both figures as fresh when both go over at once', () => {
    const guard = createBudgetGuard();

    const { fresh } = guard.check({ calls: 400, triangles: 900_000 });

    expect(fresh.map(({ figure }) => figure)).toEqual(['calls', 'triangles']);
  });

  it('re-arms one figure while the other stays over', () => {
    const guard = createBudgetGuard();
    guard.check({ calls: 400, triangles: 900_000 });
    guard.check({ calls: 100, triangles: 900_000 });

    const { fresh } = guard.check({ calls: 400, triangles: 900_000 });

    expect(fresh.map(({ figure }) => figure)).toEqual(['calls']);
  });

  it('starts over after reset', () => {
    const guard = createBudgetGuard();
    guard.check({ calls: 151, triangles: 10 });
    guard.reset();

    expect(guard.check({ calls: 151, triangles: 10 }).fresh).toHaveLength(1);
  });

  it('counts an unmeasurable reading as within budget, which re-arms', () => {
    const guard = createBudgetGuard();
    guard.check({ calls: 151, triangles: 10 });

    expect(guard.check({ calls: Number.NaN, triangles: 10 })).toEqual({ over: [], fresh: [] });
    expect(guard.check({ calls: 151, triangles: 10 }).fresh).toHaveLength(1);
  });
});

describe('createFallbackDetector (V2-21.9)', () => {
  /** Feeds frames of `frameMs` from `from` for `forMs` and returns the times at which it tripped (it should be once at most). */
  function run(
    detector: ReturnType<typeof createFallbackDetector>,
    frameMs: number,
    from: number,
    forMs: number,
  ): number[] {
    const trips: number[] = [];
    for (let t = from; t <= from + forMs; t += frameMs) {
      if (detector.frame(frameMs, t)) trips.push(t);
    }
    return trips;
  }

  it('is above the pixel-ratio controller’s budget, which a wall cannot act on', () => {
    expect(FALLBACK_BUDGET_MS).toBeGreaterThan(DPR_BUDGET_MS);
  });

  it('never trips on a healthy run, at 60 Hz or at 40 fps', () => {
    const detector = createFallbackDetector();

    expect(run(detector, 1000 / 60, 0, 10 * 60_000)).toEqual([]);
    expect(run(createFallbackDetector(), 25, 0, 10 * 60_000)).toEqual([]);
  });

  it('trips once, after the afterMs of bad windows, and not before', () => {
    const detector = createFallbackDetector();

    const trips = run(detector, 50, 0, 3 * 60_000);

    expect(trips).toHaveLength(1);
    // The grace window (2 s) and then the minute of bad ones, to the second.
    expect(trips[0]).toBeGreaterThanOrEqual(2000 + FALLBACK_AFTER_MS);
    expect(trips[0]).toBeLessThan(2000 + FALLBACK_AFTER_MS + 4000);
  });

  it('is judged on the p95, so a few long frames in a good window do not make it bad', () => {
    const detector = createFallbackDetector();
    let now = 0;
    const trips: boolean[] = [];
    // One frame in forty is 60 ms (2.5 %, so about three in a window); the rest are 16 ms: the p95 is 16 ms (nearest rank).
    for (let i = 0; now < 3 * 60_000; i += 1) {
      const dt = i % 40 === 0 ? 60 : 16;
      now += dt;
      trips.push(detector.frame(dt, now));
    }

    expect(trips).not.toContain(true);
  });

  it('starts the run again after a good window', () => {
    const detector = createFallbackDetector();

    // 50 s bad, a good window, 50 s bad: neither stretch is a minute on its own.
    const first = run(detector, 50, 0, 50_000);
    const good = run(detector, 16, 50_000, 6000);
    const second = run(detector, 50, 56_000, 50_000);

    expect([...first, ...good, ...second]).toEqual([]);
  });

  it('does not count a quiet canvas as slow: windows with few frames end the run', () => {
    const detector = createFallbackDetector();

    // One frame every 200 ms is 10 frames in a window, below the 30 that make a window worth judging.
    expect(run(detector, 200, 0, 5 * 60_000)).toEqual([]);
  });

  it('ignores the first seconds, where shaders compile and models upload', () => {
    const detector = createFallbackDetector({ afterMs: 4000 });

    const slowStart = run(detector, 100, 0, 2000);
    expect(slowStart).toEqual([]);
  });

  it('latches: once tripped it never says so again', () => {
    const detector = createFallbackDetector({ afterMs: 4000 });

    const trips = run(detector, 50, 0, 60_000);

    expect(trips).toHaveLength(1);
    expect(detector.frame(100, 100_000)).toBe(false);
  });

  it('refuses a gap, zero and NaN as frames', () => {
    const detector = createFallbackDetector({ afterMs: 2000 });
    let now = 0;
    const trips: boolean[] = [];
    for (let i = 0; i < 400; i += 1) {
      now += 50;
      trips.push(detector.frame([0, Number.NaN, 5000][i % 3] ?? 0, now));
    }

    expect(trips).not.toContain(true);
  });
});
