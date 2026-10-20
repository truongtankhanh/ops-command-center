import { act, render, screen, within } from '@testing-library/react';
import { StrictMode, useRef } from 'react';
import { HUD_LABEL, HUD_ROWS, NO_VALUE } from '../lib/twinHud';
import type { TelemetryClient, TelemetryStats } from '../realtime/telemetryClient';
import { useTelemetryStore } from '../realtime/telemetryStore';
import { expectNoAxeViolations } from '../test-utils';
import Hud from './Hud';
import HudProbe from './HudProbe';

/*
 * `useFrame` and `useThree` are replaced: the probe's frame callback is captured so a test can "draw" frames, and
 * `gl.info.render` is a plain object a test sets. jsdom has no WebGL, so this is as close as a unit test gets.
 */
const canvas = vi.hoisted(() => ({
  frame: null as ((state: unknown, delta: number) => void) | null,
  priority: undefined as unknown,
  pixelRatio: 1.25,
  gl: {
    info: { render: { calls: 0, triangles: 0 } },
    getPixelRatio: (): number => canvas.pixelRatio,
  },
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: (state: unknown, delta: number) => void, priority?: unknown) => {
    canvas.frame = callback;
    canvas.priority = priority;
  },
  useThree: (select: (state: { gl: typeof canvas.gl }) => unknown) => select({ gl: canvas.gl }),
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
/** Lets the probe's timer run for `ms`. */
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

const setHidden = (hidden: boolean) =>
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });

const clientWith = (read: () => TelemetryStats) =>
  ({ getStats: read }) as unknown as TelemetryClient;

describe('Hud (the readout)', () => {
  it('is a named group of seven labelled values, in frame 00 order and then the pixel ratio, each a dash before the first sample', () => {
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
  beforeEach(() => {
    vi.useFakeTimers();
    canvas.frame = null;
    canvas.priority = undefined;
    canvas.gl.info.render = { calls: 96, triangles: 182_000 };
    canvas.pixelRatio = 1.25;
    useTelemetryStore.setState({ client: null });
    // jsdom's own answer depends on how the window was made; the probe reads it, so a case states it.
    setHidden(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(document, 'hidden');
    useTelemetryStore.setState({ client: null });
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
});
