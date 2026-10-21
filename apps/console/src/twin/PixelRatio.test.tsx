import { render } from '@testing-library/react';
import { PixelRatio } from './PixelRatio';

// R3F's `useFrame` needs a canvas; the stand-in keeps the callback so a test can draw frames by hand.
const frames = vi.hoisted(() => ({
  draw: null as null | ((state: unknown, delta: number) => void),
}));
vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: (state: unknown, delta: number) => void) => {
    frames.draw = callback;
  },
}));

/** Draws a frame every `frameMs` for `forMs`, on a clock the test owns (the controller is handed `performance.now()`). */
function drawFrames(frameMs: number, forMs: number): void {
  const draw = frames.draw;
  if (draw === null) throw new Error('PixelRatio did not subscribe to the frame loop');
  const now = vi.spyOn(performance, 'now');
  for (let t = 0; t <= forMs; t += frameMs) {
    now.mockReturnValue(t);
    draw({}, frameMs / 1000);
  }
}

describe('PixelRatio', () => {
  const deviceRatio = window.devicePixelRatio;

  beforeEach(() => {
    // A display sharper than the first step, or every step collapses to 1.0 and a wall could not be told from a laptop.
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
    frames.draw = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: deviceRatio });
  });

  it('steps the ratio down when frames run long, on the console', () => {
    const onStep = vi.fn();
    render(<PixelRatio initial={1.5} onStep={onStep} />);

    drawFrames(40, 10_000);

    expect(onStep).toHaveBeenCalledWith(1.25);
  });

  it('never steps on a wall, however long the frames run (V2-21.6)', () => {
    const onStep = vi.fn();
    render(<PixelRatio initial={1.5} onStep={onStep} wall />);

    drawFrames(40, 10_000);

    expect(onStep).not.toHaveBeenCalled();
  });
});
