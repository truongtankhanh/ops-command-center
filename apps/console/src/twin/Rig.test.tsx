import { render } from '@testing-library/react';
import { forwardRef, useImperativeHandle } from 'react';
import { PENDING_SHOW_MS, twinCommands } from '../lib/twinCommands';
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
    truck: vi.fn(() => Promise.resolve()),
    forward: vi.fn(() => Promise.resolve()),
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
});
