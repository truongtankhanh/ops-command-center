import { render } from '@testing-library/react';
import { FALLBACK_AFTER_MS } from '../lib/twinPerf';
import { useConsole } from '../store';
import { resetStore } from '../test-utils';
import { FrameGuard } from './FrameGuard';

// R3F's `useFrame` needs a canvas; the stand-in keeps the callback so a test can draw frames by hand.
const frames = vi.hoisted(() => ({
  draw: null as null | ((state: unknown, delta: number) => void),
}));
vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: (state: unknown, delta: number) => void) => {
    frames.draw = callback;
  },
}));

/** Draws a frame every `frameMs` for `forMs`, on a clock the test owns (the detector is handed `performance.now()`). */
function drawFrames(frameMs: number, forMs: number): void {
  const draw = frames.draw;
  if (draw === null) throw new Error('FrameGuard did not subscribe to the frame loop');
  const now = vi.spyOn(performance, 'now');
  for (let t = 0; t <= forMs; t += frameMs) {
    now.mockReturnValue(t);
    draw({}, frameMs / 1000);
  }
}

describe('FrameGuard', () => {
  beforeEach(() => {
    resetStore(useConsole);
    frames.draw = null;
  });

  afterEach(() => vi.restoreAllMocks());

  it('marks the twin lost as too slow when frames stay long for a minute, and puts the stage on 2D', () => {
    render(<FrameGuard />);

    drawFrames(50, FALLBACK_AFTER_MS + 10_000);

    expect(useConsole.getState().twinFault).toBe('too-slow');
    expect(useConsole.getState().view).toBe('2d');
  });

  it('leaves a healthy view alone', () => {
    render(<FrameGuard />);

    drawFrames(1000 / 60, 3 * 60_000);

    expect(useConsole.getState().twinFault).toBeNull();
  });
});
