import { act, render, screen, within } from '@testing-library/react';
import { StrictMode, useRef } from 'react';
import type { MockInstance } from 'vitest';
import { HUD_LABEL, HUD_ROWS, NO_VALUE } from '../lib/twin-core/twinHud';
import { DRAW_CALL_BUDGET, TRIANGLE_BUDGET } from '../lib/twin-core/twinPerf';
import type { TelemetryClient, TelemetryStats } from '../realtime/telemetryClient';
import { useTelemetryStore } from '../realtime/telemetryStore';
import { useConsole } from '../store';
import { expectNoAxeViolations, resetStore } from '../test-utils';
import Hud from './Hud';
import HudProbe from './HudProbe';

/*
 * `useFrame`, `useThree` and R3F's global `addEffect` / `addAfterEffect` are replaced: the probe's frame callback and
 * its loop effects are captured so a test can "draw" frames and run the loop around them, and `gl.info.render` is a
 * plain object a test sets. `gl.getContext` is absent unless a case gives it a fake WebGL 2 context (a GPU timer).
 * jsdom has no WebGL, so this is as close as a unit test gets.
 */
type LoopEffect = (timestamp: number) => void;
const canvas = vi.hoisted(() => ({
  frame: null as ((state: unknown, delta: number) => void) | null,
  priority: undefined as unknown,
  pixelRatio: 1.25,
  before: new Set<(timestamp: number) => void>(),
  after: new Set<(timestamp: number) => void>(),
  gl: {
    info: {
      render: { calls: 0, triangles: 0 },
      memory: { geometries: 0, textures: 0 },
    },
    getPixelRatio: (): number => canvas.pixelRatio,
    getContext: undefined as (() => unknown) | undefined,
  },
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: (state: unknown, delta: number) => void, priority?: unknown) => {
    canvas.frame = callback;
    canvas.priority = priority;
  },
  useThree: (select: (state: { gl: typeof canvas.gl }) => unknown) => select({ gl: canvas.gl }),
  addEffect: (callback: LoopEffect) => {
    canvas.before.add(callback);
    return () => canvas.before.delete(callback);
  },
  addAfterEffect: (callback: LoopEffect) => {
    canvas.after.add(callback);
    return () => canvas.after.delete(callback);
  },
}));

function Harness() {
  const listRef = useRef<HTMLDListElement>(null);
  return (
    <>
      <Hud listRef={listRef} />
      <HudProbe listRef={listRef} />
    </>
  );
}

const cell = (id: string) => document.querySelector(`[data-hud="${id}"]`)?.textContent;
const values = () => HUD_ROWS.map(({ id }) => cell(id));

/** `count` drawn frames of `ms` each. */
const draw = (count: number, ms = 16.7) => {
  for (let i = 0; i < count; i += 1) canvas.frame?.({}, ms / 1000);
};
/** The clock `performance.now()` reads while a case controls it (`useClock`). */
let clockMs = 0;
const useClock = () => vi.spyOn(performance, 'now').mockImplementation(() => clockMs);

/**
 * `count` turns of R3F's loop costing `costMs` each: the global effects before, the frame (unless `drawn` is false: a
 * tick whose root drew nothing), the global effects after.
 */
const loop = (count: number, costMs: number, { drawn = true } = {}) => {
  for (let i = 0; i < count; i += 1) {
    for (const effect of canvas.before) effect(clockMs);
    if (drawn) canvas.frame?.({}, 16.7 / 1000);
    clockMs += costMs;
    for (const effect of canvas.after) effect(clockMs);
    clockMs += 16.7 - costMs;
  }
};

/** Lets the probe's timer run for `ms`. */
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

const setHidden = (hidden: boolean) =>
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });

const clientWith = (read: () => TelemetryStats) =>
  ({ getStats: read }) as unknown as TelemetryClient;

describe('Hud (the readout)', () => {
  it('is a named group of eleven labelled values, in frame 00 order, then the pixel ratio, the memory, the cost and the tier, each a dash before the first sample', () => {
    render(<Hud listRef={{ current: null }} />);

    const group = screen.getByRole('group', { name: HUD_LABEL });
    expect(
      within(group)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual([
      'FPS',
      'Frame (p95)',
      'Draw calls',
      'Triangles',
      'Telemetry msgs/s',
      'Worker → main',
      'Pixel ratio',
      'Geometries',
      'Textures',
      'Frame cost (p95)',
      'Quality tier',
    ]);
    expect(
      within(group)
        .getAllByRole('definition')
        .map((value) => value.textContent),
    ).toEqual(HUD_ROWS.map(() => NO_VALUE));
  });

  it('is not a live region, a control or a tab stop', () => {
    const { container } = render(<Hud listRef={{ current: null }} />);

    expect(container.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
    expect(container.querySelector('button, a, input, select, textarea, [tabindex]')).toBeNull();
  });

  it('passes axe', async () => {
    const { container } = render(<Hud listRef={{ current: null }} />);

    await expectNoAxeViolations(container);
  });
});

describe('HudProbe (the measuring)', () => {
  let debug: MockInstance<typeof console.debug>;
  beforeEach(() => {
    vi.useFakeTimers();
    // Without a GPU timer the probe says so once; the cases about it read this spy.
    debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    resetStore(useConsole);
    canvas.frame = null;
    canvas.priority = undefined;
    canvas.before.clear();
    canvas.after.clear();
    canvas.gl.getContext = undefined;
    clockMs = 0;
    canvas.gl.info.render = { calls: 96, triangles: 182_000 };
    canvas.gl.info.memory = { geometries: 31, textures: 4 };
    canvas.pixelRatio = 1.25;
    useTelemetryStore.setState({ client: null });
    // jsdom's own answer depends on how the window was made; the probe reads it, so a case states it.
    setHidden(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, 'hidden');
    useTelemetryStore.setState({ client: null });
    resetStore(useConsole);
  });

  it('subscribes to the frame loop at the default priority, which keeps R3F rendering the scene', () => {
    render(<Harness />);

    expect(canvas.frame).toBeInstanceOf(Function);
    expect(canvas.priority ?? 0).toBe(0);
  });

  it('writes nothing before the first tick', () => {
    render(<Harness />);
    draw(10);

    expect(values()).toEqual(HUD_ROWS.map(() => NO_VALUE));
  });

  it('shows the p95, the draw calls and the triangles at the first tick, and the frame rate at the second', () => {
    render(<Harness />);

    draw(30);
    advance(500);
    // The first tick only opens the window of the frame rate.
    expect(cell('fps')).toBe(NO_VALUE);
    expect(cell('frame')).toBe('16.7 ms');
    expect(cell('calls')).toBe('96');
    expect(cell('triangles')).toBe('182 k');

    draw(30);
    advance(500);
    expect(cell('fps')).toBe('60');
  });

  it('reads 0 frames a second when the canvas is idle, and keeps the last p95', () => {
    render(<Harness />);
    draw(30);
    advance(500);
    draw(30);
    advance(500);

    advance(500);

    expect(cell('fps')).toBe('0');
    expect(cell('frame')).toBe('16.7 ms');
  });

  it('follows the draw calls of the last frame, between frames', () => {
    render(<Harness />);
    draw(10);
    advance(500);

    canvas.gl.info.render = { calls: 17, triangles: 640 };
    advance(500);

    expect(cell('calls')).toBe('17');
    expect(cell('triangles')).toBe('640');
  });

  it('shows the renderer’s pixel ratio at the first tick, and follows a step down', () => {
    render(<Harness />);
    draw(10);
    advance(500);
    expect(cell('ratio')).toBe('1.25');

    canvas.pixelRatio = 1;
    advance(500);

    expect(cell('ratio')).toBe('1');
  });

  it('shows what the GPU holds at the first tick, and follows a rise and a return to where it was (V2-19.6)', () => {
    render(<Harness />);
    draw(10);
    advance(500);
    expect(cell('geometries')).toBe('31');
    expect(cell('textures')).toBe('4');

    canvas.gl.info.memory = { geometries: 38, textures: 5 };
    advance(500);
    expect(cell('geometries')).toBe('38');
    expect(cell('textures')).toBe('5');

    canvas.gl.info.memory = { geometries: 31, textures: 4 };
    advance(500);

    expect(cell('geometries')).toBe('31');
    expect(cell('textures')).toBe('4');
  });

  it('does not let the first frame after an idle spell own the p95', () => {
    render(<Harness />);

    draw(29);
    draw(1, 5000);
    advance(500);

    expect(cell('frame')).toBe('16.7 ms');
  });

  it('shows messages a second and posts a frame from the client, a dash without one', () => {
    let stats: TelemetryStats = { messages: 0, targetPosts: 0 };
    useTelemetryStore.setState({ client: clientWith(() => stats) });
    render(<Harness />);

    // The engine posts its counts once a second: the baseline, a tick with no change, then the change.
    draw(30);
    advance(500);
    draw(30);
    advance(500);
    stats = { messages: 84, targetPosts: 60 };
    draw(30);
    advance(500);

    expect(cell('messages')).toBe('84');
    expect(cell('posts')).toBe('1 / frame');
  });

  it('shows a dash for the telemetry rows while there is no client', () => {
    render(<Harness />);

    draw(30);
    advance(500);
    draw(30);
    advance(500);

    expect(cell('messages')).toBe(NO_VALUE);
    expect(cell('posts')).toBe(NO_VALUE);
  });

  it('writes nothing while the tab is hidden, and writes again when it is back', () => {
    setHidden(true);
    render(<Harness />);

    draw(30);
    advance(1000);
    expect(values()).toEqual(HUD_ROWS.map(() => NO_VALUE));

    setHidden(false);
    advance(500);
    expect(cell('calls')).toBe('96');
  });

  it('survives its list not being there yet', () => {
    render(<HudProbe listRef={{ current: null }} />);

    expect(() => advance(1000)).not.toThrow();
  });

  it('stops its timer on unmount and runs one timer under StrictMode', () => {
    const before = vi.getTimerCount();
    const { unmount } = render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    expect(vi.getTimerCount()).toBe(before + 1);

    unmount();

    expect(vi.getTimerCount()).toBe(before);
  });

  describe('the budget guard (V2-19.4)', () => {
    let warn: MockInstance<typeof console.warn>;
    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => warn.mockRestore());

    // Written against the constants, so the cases hold whatever V3-11.7 sets them to; 10 and 96 are within any budget
    // (none is below Low's, V2's 150 / 250,000).
    const CALLS = DRAW_CALL_BUDGET;
    const TRIANGLES = TRIANGLE_BUDGET;
    const en = (n: number) => n.toLocaleString('en-US');

    const over = (id: string) =>
      document.querySelector(`[data-hud="${id}"]`)?.getAttribute('data-over');

    it('stays quiet and marks nothing while the frame is within both budgets', () => {
      render(<Harness />);
      draw(10);

      advance(2000);

      expect(warn).not.toHaveBeenCalled();
      expect(over('calls')).toBeNull();
      expect(over('triangles')).toBeNull();
    });

    it('counts exactly the limits as within budget', () => {
      canvas.gl.info.render = { calls: CALLS, triangles: TRIANGLES };
      render(<Harness />);

      advance(1000);

      expect(warn).not.toHaveBeenCalled();
      expect(over('calls')).toBeNull();
      expect(over('triangles')).toBeNull();
    });

    it('warns on a scene over the draw-call budget, and marks that value only', () => {
      canvas.gl.info.render = { calls: CALLS + 1, triangles: 10 };
      render(<Harness />);

      advance(500);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain(
        `${en(CALLS + 1)} draw calls (limit ${en(CALLS)})`,
      );
      expect(over('calls')).toBe('true');
      expect(over('triangles')).toBeNull();
    });

    it('warns on a scene over the triangle budget, and marks that value only', () => {
      canvas.gl.info.render = { calls: 10, triangles: TRIANGLES + 1 };
      render(<Harness />);

      advance(500);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain(
        `${en(TRIANGLES + 1)} triangles (limit ${en(TRIANGLES)})`,
      );
      expect(over('triangles')).toBe('true');
      expect(over('calls')).toBeNull();
    });

    it('warns once while the scene stays over, not at every tick', () => {
      canvas.gl.info.render = { calls: CALLS + 1, triangles: 10 };
      render(<Harness />);

      advance(500);
      canvas.gl.info.render = { calls: CALLS + 20, triangles: 10 };
      advance(1500);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(over('calls')).toBe('true');
    });

    it('clears the mark when the scene is back within budget, and warns again at the next breach', () => {
      canvas.gl.info.render = { calls: CALLS + 1, triangles: 10 };
      render(<Harness />);
      advance(500);

      canvas.gl.info.render = { calls: 96, triangles: 10 };
      advance(500);
      expect(over('calls')).toBeNull();

      canvas.gl.info.render = { calls: CALLS + 10, triangles: 10 };
      advance(500);

      expect(warn).toHaveBeenCalledTimes(2);
      expect(over('calls')).toBe('true');
    });

    it('names only the figure that has just gone over, and both when both do at once', () => {
      canvas.gl.info.render = { calls: CALLS + 1, triangles: 10 };
      render(<Harness />);
      advance(500);

      canvas.gl.info.render = { calls: CALLS + 1, triangles: TRIANGLES + 1 };
      advance(500);

      const second = String(warn.mock.calls[1]?.[0]);
      expect(second).toContain('triangles');
      expect(second).not.toContain('draw calls');

      canvas.gl.info.render = { calls: 10, triangles: 10 };
      advance(500);
      canvas.gl.info.render = { calls: CALLS * 3, triangles: TRIANGLES * 4 };
      advance(500);

      const third = String(warn.mock.calls[2]?.[0]);
      expect(warn).toHaveBeenCalledTimes(3);
      expect(third).toContain('draw calls');
      expect(third).toContain('triangles');
    });

    it('says nothing and marks nothing while the tab is hidden, and judges again when it is back', () => {
      canvas.gl.info.render = { calls: CALLS + 1, triangles: 10 };
      setHidden(true);
      render(<Harness />);

      advance(1500);
      expect(warn).not.toHaveBeenCalled();
      expect(over('calls')).toBeNull();

      setHidden(false);
      advance(500);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(over('calls')).toBe('true');
    });

    it('warns again for a scene that is still over when the probe is mounted again', () => {
      canvas.gl.info.render = { calls: CALLS + 1, triangles: 10 };
      const first = render(<Harness />);
      advance(500);
      first.unmount();

      render(<Harness />);
      advance(500);

      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('marks neither the cost nor the tier: they have no budget here (V3-18.5 owns per-tier budgets)', () => {
      canvas.gl.info.render = { calls: CALLS + 1, triangles: TRIANGLES + 1 };
      useClock();
      render(<Harness />);
      loop(30, 30);

      advance(500);

      expect(over('cost')).toBeNull();
      expect(over('tier')).toBeNull();
    });
  });

  describe('the frame cost (V3-11.2)', () => {
    beforeEach(() => {
      useClock();
    });

    it('shows the p95 of what drawn frames cost, apart from the interval', () => {
      render(<Harness />);

      loop(30, 7.4);
      advance(500);

      expect(cell('cost')).toBe('7.4 ms');
      expect(cell('frame')).toBe('16.7 ms');
    });

    it('adds nothing for a tick of the loop that drew nothing', () => {
      render(<Harness />);

      loop(30, 0.1, { drawn: false });
      advance(500);
      expect(cell('cost')).toBe(NO_VALUE);

      loop(30, 6.2);
      advance(500);
      expect(cell('cost')).toBe('6.2 ms');
    });

    it('subscribes once before and once after the loop, and removes both on unmount, under StrictMode too', () => {
      const { unmount } = render(
        <StrictMode>
          <Harness />
        </StrictMode>,
      );
      expect(canvas.before.size).toBe(1);
      expect(canvas.after.size).toBe(1);

      unmount();

      expect(canvas.before.size).toBe(0);
      expect(canvas.after.size).toBe(0);
    });

    it('shows the CPU figure alone without a GPU timer, says so once, and throws nothing', () => {
      render(<Harness />);

      expect(() => {
        loop(30, 7.4);
        advance(1000);
      }).not.toThrow();

      expect(cell('cost')).toBe('7.4 ms');
      expect(debug).toHaveBeenCalledTimes(1);
    });

    it('shows the GPU time beside the cost where a timer exists, and keeps the frames that drew nothing out of it', () => {
      const TIME_ELAPSED_EXT = 0x88bf;
      const GPU_DISJOINT_EXT = 0x8fbb;
      let created = 0;
      let ends = 0;
      const context = {
        QUERY_RESULT: 0x8866,
        QUERY_RESULT_AVAILABLE: 0x8867,
        getExtension: (name: string) =>
          name === 'EXT_disjoint_timer_query_webgl2'
            ? { TIME_ELAPSED_EXT, GPU_DISJOINT_EXT }
            : null,
        createQuery: () => ({ id: (created += 1) }),
        beginQuery: () => {},
        endQuery: () => {
          ends += 1;
        },
        getParameter: () => false,
        // Every result is back at once. The first query timed the tick that drew nothing: 50 ms, which would own the
        // p95 if it were kept. The others are 5.1 ms.
        getQueryParameter: (query: { id: number }, pname: number) =>
          pname === 0x8867 ? true : query.id === 1 ? 50_000_000 : 5_100_000,
        deleteQuery: () => {},
      };
      canvas.gl.getContext = () => context;
      render(<Harness />);

      loop(1, 0.1, { drawn: false });
      loop(1, 7.4);
      advance(500);
      loop(1, 7.4);
      advance(500);

      expect(cell('cost')).toBe('7.4 ms · GPU 5.1');
      expect(debug).not.toHaveBeenCalled();
      expect(ends).toBe(3);
    });
  });

  describe('the quality tier (V3-11.2)', () => {
    it('shows the store’s tier as its word at the first tick, and follows a change', () => {
      render(<Harness />);
      advance(500);
      expect(cell('tier')).toBe('High');

      act(() => useConsole.getState().setTwinTier('standard'));
      advance(500);

      expect(cell('tier')).toBe('Standard');
    });
  });
});
