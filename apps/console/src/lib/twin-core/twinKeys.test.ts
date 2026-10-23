import { ZOOM_IN_FACTOR, ZOOM_OUT_FACTOR } from './twinCamera';
import {
  keyCommand,
  type KeyCommand,
  type KeyPress,
  ORBIT_STEP_DEG,
  PAN_STEP,
  TILT_STEP_DEG,
} from './twinKeys';

const press = (key: string, modifiers: Partial<KeyPress> = {}): KeyPress => ({
  key,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  repeat: false,
  isComposing: false,
  ...modifiers,
});

describe('keyCommand', () => {
  describe('the arrows', () => {
    it.each<[string, KeyCommand]>([
      ['ArrowLeft', { type: 'orbit', deg: ORBIT_STEP_DEG }],
      ['ArrowRight', { type: 'orbit', deg: -ORBIT_STEP_DEG }],
      ['ArrowUp', { type: 'tilt', deg: -TILT_STEP_DEG }],
      ['ArrowDown', { type: 'tilt', deg: TILT_STEP_DEG }],
    ])('%s orbits or tilts', (key, expected) => {
      expect(keyCommand(press(key))).toEqual(expected);
    });

    it.each<[string, KeyCommand]>([
      ['ArrowLeft', { type: 'pan', dx: -PAN_STEP, dy: 0 }],
      ['ArrowRight', { type: 'pan', dx: PAN_STEP, dy: 0 }],
      ['ArrowUp', { type: 'pan', dx: 0, dy: PAN_STEP }],
      ['ArrowDown', { type: 'pan', dx: 0, dy: -PAN_STEP }],
    ])('Shift and %s pan', (key, expected) => {
      expect(keyCommand(press(key, { shiftKey: true }))).toEqual(expected);
    });

    it('turns the camera the way the "Rotate left" button does: left is positive', () => {
      expect(keyCommand(press('ArrowLeft'))).toMatchObject({ type: 'orbit', deg: 15 });
      expect(keyCommand(press('ArrowUp'))).toMatchObject({ type: 'tilt', deg: -5 });
    });
  });

  describe('zoom', () => {
    it.each(['+', '='])(
      '%s comes closer, with the distance factor of the zoom-in button',
      (key) => {
        expect(keyCommand(press(key))).toEqual({ type: 'zoom', factor: ZOOM_IN_FACTOR });
      },
    );

    it.each(['-', '_'])('%s goes away, with the distance factor of the zoom-out button', (key) => {
      expect(keyCommand(press(key))).toEqual({ type: 'zoom', factor: ZOOM_OUT_FACTOR });
    });

    it.each(['+', '=', '-', '_'])('%s ignores Shift, which most layouts need to type it', (key) => {
      expect(keyCommand(press(key, { shiftKey: true }))).toEqual(keyCommand(press(key)));
    });
  });

  describe('Home and Escape', () => {
    it('maps Home to the reset and Escape to one level up', () => {
      expect(keyCommand(press('Home'))).toEqual({ type: 'home' });
      expect(keyCommand(press('Escape'))).toEqual({ type: 'up' });
    });

    it.each(['Home', 'Escape'])('%s is not ours with Shift held', (key) => {
      expect(keyCommand(press(key, { shiftKey: true }))).toBeNull();
    });
  });

  describe('repeat', () => {
    it.each(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-'])(
      'keeps %s going while it is held',
      (key) => {
        expect(keyCommand(press(key, { repeat: true }))).not.toBeNull();
      },
    );

    it('keeps Shift and an arrow panning while held', () => {
      expect(keyCommand(press('ArrowLeft', { shiftKey: true, repeat: true }))).toEqual({
        type: 'pan',
        dx: -PAN_STEP,
        dy: 0,
      });
    });

    it.each(['Home', 'Escape'])('takes one step per press of %s', (key) => {
      expect(keyCommand(press(key, { repeat: true }))).toBeNull();
    });
  });

  describe('modifiers and composition', () => {
    const KEYS = ['ArrowLeft', 'ArrowUp', '+', '-', 'Home', 'Escape'];

    it.each(['ctrlKey', 'altKey', 'metaKey', 'isComposing'] as const)(
      'ignores every key with %s',
      (modifier) => {
        for (const key of KEYS) {
          expect(keyCommand(press(key, { [modifier]: true }))).toBeNull();
        }
      },
    );

    it('ignores Shift with Ctrl on an arrow', () => {
      expect(keyCommand(press('ArrowLeft', { shiftKey: true, ctrlKey: true }))).toBeNull();
    });
  });

  describe("keys that are not the 3D view's", () => {
    it.each([
      'Tab',
      'Enter',
      ' ',
      'v',
      'V',
      'f',
      'F',
      '?',
      '/',
      'n',
      'N',
      'a',
      'r',
      'PageUp',
      '0',
      'End',
    ])('leaves %j alone, so its own handler gets it', (key) => {
      expect(keyCommand(press(key))).toBeNull();
    });
  });
});
