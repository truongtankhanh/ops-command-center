import { useFrame } from '@react-three/fiber';
import { act, fireEvent, render } from '@testing-library/react';
import { forwardRef, useImperativeHandle } from 'react';
import { PENDING_SHOW_MS, twinCommands } from '../lib/twin-core/twinCommands';
import { useConsole } from '../store';
import { resetStore } from '../test-utils';
import { Rig } from './Rig';

/**
 * The rig against stand-ins for the canvas and for drei's controls (jsdom has no WebGL): what is asserted is what the rig
 * tells the controls to do. `stage.size` is what R3F's `useThree` reports and a test changes between renders.
 */
const stage = vi.hoisted(() => {
  const state = {
    size: { width: 1240, height: 700 },
    invalidate: vi.fn(),
    gl: { domElement: document.createElement('canvas') },
    get: () => state,
  };
  return state;
});

const controls = vi.hoisted(() => ({
  props: {} as { enabled?: boolean },
  rig: {
    mouseButtons: { left: -1, right: -1, wheel: -1, middle: -1 },
    touches: { one: -1, two: -1, three: -1 },
    minDistance: 0,
    maxDistance: 0,
    setLookAt: vi.fn(() => Promise.resolve()),
    setBoundary: vi.fn(),
    getPosition: vi.fn(),
    getTarget: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dollyTo: vi.fn(() => Promise.resolve()),
    rotate: vi.fn(() => Promise.resolve()),
    truck: vi.fn((_x: number, _y: number, _transition?: boolean) => Promise.resolve()),
    forward: vi.fn((_distance: number, _transition?: boolean) => Promise.resolve()),
  },
}));

vi.mock('@react-three/fiber', () => ({
  useThree: (select: (state: typeof stage) => unknown) => select(stage),
  useFrame: vi.fn(),
}));

vi.mock('@react-three/drei', () => ({
  CameraControlsImpl: {
    ACTION: {
      ROTATE: 1,
      SCREEN_PAN: 2,
      DOLLY: 3,
      TOUCH_ROTATE: 4,
      TOUCH_DOLLY_SCREEN_PAN: 5,
      TOUCH_DOLLY_TRUCK: 6,
      TOUCH_SCREEN_PAN: 7,
    },
  },
  CameraControls: forwardRef<unknown, { enabled?: boolean }>(function CameraControls(props, ref) {
    controls.props = props;
    useImperativeHandle(ref, () => controls.rig);
    return null;
  }),
}));

// The sheet's offset reads the DOM around the canvas; a wall has no sheet, and the rig's own logic is what is tested here.
vi.mock('./useSheetOffset', () => ({
  sheetInset: () => 0,
  sheetInsetOpen: () => 0,
  useSheetOffset: () => undefined,
}));

const BOUNDS = { minX: -200, maxX: 200, minZ: -150, maxZ: 150 };
const NO_BOXES = new Map();

const rig = (
  locked?: boolean,
  beacons: { id: string; position: [number, number, number] }[] = [],
) => (
  <Rig
    bounds={BOUNDS}
    boxes={NO_BOXES}
    assetBoxes={NO_BOXES}
    beacons={beacons}
    {...(locked === undefined ? {} : { locked })}
  />
);

describe('Rig', () => {
  beforeEach(() => {
    stage.size = { width: 1240, height: 700 };
    stage.invalidate.mockClear();
    controls.rig.mouseButtons = { left: -1, right: -1, wheel: -1, middle: -1 };
    controls.rig.touches = { one: -1, two: -1, three: -1 };
    controls.rig.setLookAt.mockClear();
  });

  describe('on the console', () => {
    it('takes input and maps the mouse', () => {
      render(rig());

      expect(controls.props.enabled).toBe(true);
      expect(controls.rig.mouseButtons.left).toBe(1);
      expect(controls.rig.touches.one).toBe(4);
    });

    it('keeps the view it was given when the stage changes shape', () => {
      const { rerender } = render(rig());
      expect(controls.rig.setLookAt).toHaveBeenCalledTimes(1);

      stage.size = { width: 1920, height: 700 };
      rerender(rig());

      expect(controls.rig.setLookAt).toHaveBeenCalledTimes(1);
    });
  });

  describe('locked, on a video wall (V2-21.6)', () => {
    it('turns the controls off, so a wheel, a drag or a touch does nothing', () => {
      render(rig(true));

      expect(controls.props.enabled).toBe(false);
    });

    it('sets no mouse or touch mapping and listens to no key', () => {
      const add = vi.spyOn(window, 'addEventListener');

      render(rig(true));

      expect(controls.rig.mouseButtons).toEqual({ left: -1, right: -1, wheel: -1, middle: -1 });
      expect(controls.rig.touches).toEqual({ one: -1, two: -1, three: -1 });
      expect(add).not.toHaveBeenCalledWith('keydown', expect.any(Function));
      add.mockRestore();
    });

    it('sets the home view once, and nothing moves the camera after it', () => {
      const { rerender } = render(rig(true));

      expect(controls.rig.setLookAt).toHaveBeenCalledTimes(1);
      expect(controls.rig.setLookAt).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        false,
      );

      rerender(rig(true));
      expect(controls.rig.setLookAt).toHaveBeenCalledTimes(1);
    });

    it('fits the home view again when the stage changes shape, and draws a frame for it', () => {
      const { rerender } = render(rig(true));
      stage.invalidate.mockClear();

      stage.size = { width: 2480, height: 1400 };
      rerender(rig(true));

      expect(controls.rig.setLookAt).toHaveBeenCalledTimes(2);
      expect(stage.invalidate).toHaveBeenCalledOnce();
    });

    it('still answers the commands: V2-21.8 flies the wall with them', () => {
      render(rig(true));
      stage.invalidate.mockClear();

      expect(twinCommands.current()).not.toBeNull();
      twinCommands.home();

      expect(stage.invalidate).toHaveBeenCalledOnce();
    });

    describe('flying to an incident whose beacon has not arrived yet', () => {
      const BEACON = { id: 'i1', position: [10, 0, 20] as [number, number, number] };

      it('waits for the beacon and then flies', () => {
        const { rerender } = render(rig(true));
        stage.invalidate.mockClear();

        twinCommands.flyToIncident('i1');
        expect(stage.invalidate).not.toHaveBeenCalled();

        rerender(rig(true, [BEACON]));

        expect(stage.invalidate).toHaveBeenCalledOnce();
      });

      it('flies at once when the beacon is already there, and only once', () => {
        const { rerender } = render(rig(true, [BEACON]));
        stage.invalidate.mockClear();

        twinCommands.flyToIncident('i1');
        expect(stage.invalidate).toHaveBeenCalledOnce();

        rerender(rig(true, [BEACON, { id: 'i2', position: [0, 0, 0] }]));
        expect(stage.invalidate).toHaveBeenCalledOnce();
      });

      it('forgets the request when the camera is sent home first', () => {
        const { rerender } = render(rig(true));
        twinCommands.flyToIncident('i1');
        twinCommands.home();
        stage.invalidate.mockClear();

        rerender(rig(true, [BEACON]));

        expect(stage.invalidate).not.toHaveBeenCalled();
      });

      it('forgets the request after it has waited too long', () => {
        vi.useFakeTimers();
        try {
          const { rerender } = render(rig(true));
          twinCommands.flyToIncident('i1');
          vi.advanceTimersByTime(PENDING_SHOW_MS + 1);
          stage.invalidate.mockClear();

          rerender(rig(true, [BEACON]));

          expect(stage.invalidate).not.toHaveBeenCalled();
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });

  it('on the console, an incident with no beacon still does nothing, now or later', () => {
    const { rerender } = render(rig());
    stage.invalidate.mockClear();

    twinCommands.flyToIncident('i1');
    rerender(rig(false, [{ id: 'i1', position: [10, 0, 20] }]));

    expect(stage.invalidate).not.toHaveBeenCalled();
  });
  // The Pan tool, the pad and a held button (V3-29). The stand-in `ACTION` numbers are ROTATE 1, SCREEN_PAN 2, DOLLY 3,
  // TOUCH_ROTATE 4 and TOUCH_SCREEN_PAN 7.
  describe('the pan tool and the pad (V3-29)', () => {
    const ROTATE = 1;
    const SCREEN_PAN = 2;
    const TOUCH_ROTATE = 4;
    const TOUCH_SCREEN_PAN = 7;

    beforeEach(() => {
      resetStore(useConsole);
      vi.mocked(useFrame).mockClear();
      controls.rig.truck.mockClear();
      controls.rig.forward.mockClear();
      // A camera 100 m up and 100 m back from a target at the origin: a distance of about 141 m.
      controls.rig.getPosition.mockImplementation((vector: { set: (...n: number[]) => void }) =>
        vector.set(0, 100, 100),
      );
      controls.rig.getTarget.mockImplementation((vector: { set: (...n: number[]) => void }) =>
        vector.set(0, 0, 0),
      );
    });

    afterEach(() => vi.unstubAllGlobals());

    /** The frame callback that moves a held pad button: the last one registered at priority -2. */
    const holdFrame = () => {
      const calls = vi.mocked(useFrame).mock.calls.filter((call) => call[1] === -2);
      return calls[calls.length - 1]![0] as (state: unknown, delta: number) => void;
    };

    it('maps the left button to Orbit by default, and Shift flips it while held', () => {
      render(rig());

      expect(controls.rig.mouseButtons.left).toBe(ROTATE);
      expect(controls.rig.touches.one).toBe(TOUCH_ROTATE);

      fireEvent.keyDown(window, { key: 'Shift' });
      expect(controls.rig.mouseButtons.left).toBe(SCREEN_PAN);

      fireEvent.keyUp(window, { key: 'Shift' });
      expect(controls.rig.mouseButtons.left).toBe(ROTATE);
    });

    it('maps the left button and one finger to Pan while the tool is on, and Shift orbits', () => {
      render(rig());

      act(() => useConsole.getState().setPanTool(true));

      expect(controls.rig.mouseButtons.left).toBe(SCREEN_PAN);
      expect(controls.rig.touches.one).toBe(TOUCH_SCREEN_PAN);

      fireEvent.keyDown(window, { key: 'Shift' });
      expect(controls.rig.mouseButtons.left).toBe(ROTATE);
      // A finger has no Shift: it follows the tool alone.
      expect(controls.rig.touches.one).toBe(TOUCH_SCREEN_PAN);

      fireEvent.keyUp(window, { key: 'Shift' });
      expect(controls.rig.mouseButtons.left).toBe(SCREEN_PAN);
    });

    it('keeps the flip right when the tool changes while Shift is held, and when the window blurs', () => {
      render(rig());

      fireEvent.keyDown(window, { key: 'Shift' });
      expect(controls.rig.mouseButtons.left).toBe(SCREEN_PAN);

      act(() => useConsole.getState().setPanTool(true));
      expect(controls.rig.mouseButtons.left).toBe(ROTATE);

      fireEvent.blur(window);
      expect(controls.rig.mouseButtons.left).toBe(SCREEN_PAN);
    });

    it('leaves the right button, the wheel and two fingers as they were, in both tools', () => {
      render(rig());
      act(() => useConsole.getState().setPanTool(true));

      expect(controls.rig.mouseButtons.right).toBe(SCREEN_PAN);
      expect(controls.rig.mouseButtons.wheel).toBe(3);
      expect(controls.rig.touches.two).toBe(5);
      expect(controls.rig.touches.three).toBe(TOUCH_SCREEN_PAN);
    });

    it('removes its key listeners when it goes away', () => {
      const remove = vi.spyOn(window, 'removeEventListener');
      const { unmount } = render(rig());

      unmount();

      for (const type of ['keydown', 'keyup', 'blur']) {
        expect(remove).toHaveBeenCalledWith(type, expect.any(Function));
      }
      remove.mockRestore();
    });

    it('sets no mapping for the tool on a wall', () => {
      render(rig(true));

      act(() => useConsole.getState().setPanTool(true));

      expect(controls.rig.mouseButtons).toEqual({ left: -1, right: -1, wheel: -1, middle: -1 });
      expect(controls.rig.touches).toEqual({ one: -1, two: -1, three: -1 });
    });

    it('moves one pad step by a share of the distance, with the glide', () => {
      render(rig());

      twinCommands.panStep(0, 1);

      expect(controls.rig.truck).toHaveBeenCalledWith(0, 0, true);
      const [forward, glide] = controls.rig.forward.mock.calls[0]!;
      expect(forward).toBeGreaterThan(0);
      expect(glide).toBe(true);
      // A share of the distance: well below a whole distance, well above nothing.
      expect(forward).toBeLessThan(141);
      expect(forward).toBeGreaterThan(5);
    });

    it('moves a step the other way for the opposite direction', () => {
      render(rig());

      twinCommands.panStep(1, 0);
      twinCommands.panStep(-1, 0);

      const [right, left] = controls.rig.truck.mock.calls.map((call) => call[0] as number);
      expect(right).toBeGreaterThan(0);
      expect(left).toBeCloseTo(-right!, 10);
    });

    it('lands a step without a glide under reduced motion, and so do the keys', () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }));
      render(rig());

      twinCommands.panStep(1, 0);
      twinCommands.panBy(0.1, 0);

      expect(controls.rig.truck.mock.calls.map((call) => call[2])).toEqual([false, false]);
    });

    it('moves the view each frame while a direction is held, and stops when it is let go', () => {
      render(rig());
      stage.invalidate.mockClear();

      twinCommands.panHold({ dx: 0, dy: 1 });
      expect(stage.invalidate).toHaveBeenCalledOnce();

      holdFrame()({}, 0.016);
      expect(controls.rig.forward).toHaveBeenCalledTimes(1);
      const [moved, glide] = controls.rig.forward.mock.calls[0]!;
      expect(moved).toBeGreaterThan(0);
      expect(glide).toBe(false);

      twinCommands.panHold(null);
      controls.rig.forward.mockClear();
      holdFrame()({}, 0.016);
      expect(controls.rig.forward).not.toHaveBeenCalled();
    });

    it('moves a held diagonal as fast as an axis, and a stalled frame no farther than the cap', () => {
      render(rig());

      twinCommands.panHold({ dx: Math.SQRT1_2, dy: Math.SQRT1_2 });
      holdFrame()({}, 0.016);
      const diagonal = Math.hypot(
        controls.rig.truck.mock.calls[0]![0] as number,
        controls.rig.forward.mock.calls[0]![0] as number,
      );

      controls.rig.truck.mockClear();
      controls.rig.forward.mockClear();
      twinCommands.panHold({ dx: 0, dy: 1 });
      holdFrame()({}, 0.016);
      const axis = controls.rig.forward.mock.calls[0]![0] as number;
      expect(diagonal).toBeCloseTo(axis, 8);

      controls.rig.forward.mockClear();
      holdFrame()({}, 5);
      const stalled = controls.rig.forward.mock.calls[0]![0] as number;
      holdFrame()({}, 0.05);
      expect(stalled).toBeCloseTo(controls.rig.forward.mock.calls[1]![0] as number, 8);
    });

    it('lets a held direction go when the rig goes away', () => {
      const { unmount } = render(rig());
      twinCommands.panHold({ dx: 1, dy: 0 });

      unmount();

      // The unregistered commands do nothing: a hold cannot outlive its rig.
      expect(() => twinCommands.panHold(null)).not.toThrow();
    });

    it('centres on an incident beacon and does nothing for one it does not hold', () => {
      render(rig(false, [{ id: 'i1', position: [10, 0, 20] }]));
      stage.invalidate.mockClear();

      twinCommands.centreOn({ kind: 'incident', id: 'nope' });
      expect(stage.invalidate).not.toHaveBeenCalled();

      twinCommands.centreOn({ kind: 'incident', id: 'i1' });
      expect(stage.invalidate).toHaveBeenCalledOnce();
    });

    it('does nothing for an asset the stage does not hold', () => {
      render(rig());
      stage.invalidate.mockClear();

      twinCommands.centreOn({ kind: 'asset', code: 'CT-01' });

      expect(stage.invalidate).not.toHaveBeenCalled();
    });
  });
});
