import {
  clearTwinMarks,
  createChangeTracker,
  createFrameDemand,
  createFrameWindow,
  createPerfSampler,
  debugTwinRequested,
  type FrameDemand,
  type HudInput,
  markTwin,
  MAX_FRAME_GAP_MS,
  needsFrame,
  percentile,
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
  ])('asks for a frame for %s', (_, field) => {
    expect(needsFrame(asking(field))).toBe(true);
  });

  it('asks while several loops ask', () => {
    expect(needsFrame({ bound: true, flying: true, pulsing: true })).toBe(true);
  });

  it.each<keyof FrameDemand>(['bound', 'flying', 'pulsing'])(
    'asks for nothing in a hidden tab, even for %s',
    (field) => {
      expect(needsFrame(asking(field), { hidden: true })).toBe(false);
    },
  );

  it('asks for nothing in a hidden tab when every loop asks', () => {
    expect(needsFrame({ bound: true, flying: true, pulsing: true }, { hidden: true })).toBe(false);
  });

  it('is not hidden by default and when told it is in view', () => {
    expect(needsFrame(asking('bound'), {})).toBe(true);
    expect(needsFrame(asking('bound'), { hidden: false })).toBe(true);
  });
});

describe('createFrameDemand', () => {
  it('starts with every loop quiet', () => {
    expect(createFrameDemand()).toEqual({ bound: false, flying: false, pulsing: false });
  });

  it('gives a fresh object each time, so two canvases do not share a flag', () => {
    const first = createFrameDemand();
    first.bound = true;

    expect(createFrameDemand().bound).toBe(false);
  });
});
