import type { Mock } from 'vitest';
import { registerTwinCommands, type TwinCommands } from '../lib/twin-core/twinCommands';
import { levelOf } from '../lib/twin-core/twinLevel';
import { useConsole } from '../store';
import { resetStore } from '../test-utils';
import { runKeyCommand } from './runKeyCommand';

type FakeCommands = { [K in keyof TwinCommands]: Mock<TwinCommands[K]> };

function fakeCommands(): FakeCommands {
  return {
    flyTo: vi.fn<TwinCommands['flyTo']>(),
    home: vi.fn<TwinCommands['home']>(),
    fit: vi.fn<TwinCommands['fit']>(),
    fitAsset: vi.fn<TwinCommands['fitAsset']>(),
    flyToIncident: vi.fn<TwinCommands['flyToIncident']>(),
    showAsset: vi.fn<TwinCommands['showAsset']>(),
    zoomBy: vi.fn<TwinCommands['zoomBy']>(),
    rotateBy: vi.fn<TwinCommands['rotateBy']>(),
    tiltBy: vi.fn<TwinCommands['tiltBy']>(),
    panBy: vi.fn<TwinCommands['panBy']>(),
    faceNorth: vi.fn<TwinCommands['faceNorth']>(),
    panStep: vi.fn<TwinCommands['panStep']>(),
    panHold: vi.fn<TwinCommands['panHold']>(),
    centreOn: vi.fn<TwinCommands['centreOn']>(),
    current: vi.fn<TwinCommands['current']>(() => null),
  };
}

const state = () => useConsole.getState();
const level = () => levelOf(state());

/** Every command of the rig, to say that a key asked for none of them. */
const calls = (rig: FakeCommands) =>
  (Object.values(rig) as Mock<(...args: never[]) => unknown>[]).flatMap(
    (command) => command.mock.calls,
  );

describe('runKeyCommand', () => {
  let rig: FakeCommands;
  let unregister: () => void;

  beforeEach(() => {
    resetStore(useConsole);
    rig = fakeCommands();
    unregister = registerTwinCommands(rig);
  });

  afterEach(() => unregister());

  describe('the camera keys', () => {
    it('turns, tilts, pans and zooms through the commands, and uses the key', () => {
      expect(runKeyCommand({ type: 'orbit', deg: 15 })).toBe(true);
      expect(runKeyCommand({ type: 'tilt', deg: -5 })).toBe(true);
      expect(runKeyCommand({ type: 'pan', dx: 0.1, dy: -0.1 })).toBe(true);
      expect(runKeyCommand({ type: 'zoom', factor: 0.8 })).toBe(true);

      expect(rig.rotateBy).toHaveBeenCalledExactlyOnceWith(15);
      expect(rig.tiltBy).toHaveBeenCalledExactlyOnceWith(-5);
      expect(rig.panBy).toHaveBeenCalledExactlyOnceWith(0.1, -0.1);
      expect(rig.zoomBy).toHaveBeenCalledExactlyOnceWith(0.8);
    });

    it('does not throw, and still uses the key, where no stage is mounted', () => {
      unregister();

      expect(runKeyCommand({ type: 'orbit', deg: 15 })).toBe(true);
      expect(runKeyCommand({ type: 'pan', dx: 0.1, dy: 0 })).toBe(true);
    });
  });

  describe('home', () => {
    it('goes to the campus level and flies to the home view', () => {
      state().selectAsset('CT-01', 'BLD-DC');
      state().selectPart('Fan');

      expect(runKeyCommand({ type: 'home' })).toBe(true);

      expect(level()).toBe('campus');
      expect(rig.home).toHaveBeenCalledOnce();
    });

    it('flies home even from the campus level', () => {
      runKeyCommand({ type: 'home' });

      expect(rig.home).toHaveBeenCalledOnce();
    });
  });

  describe('up', () => {
    it('climbs one level a press: part, asset, building, campus', () => {
      state().selectAsset('CT-01', 'BLD-DC');
      state().selectPart('Fan');
      expect(level()).toBe('part');

      expect(runKeyCommand({ type: 'up' })).toBe(true);
      expect(level()).toBe('asset');
      expect(runKeyCommand({ type: 'up' })).toBe(true);
      expect(level()).toBe('building');
      expect(runKeyCommand({ type: 'up' })).toBe(true);
      expect(level()).toBe('campus');
    });

    it('does nothing at the campus, and says the key was not used', () => {
      const before = state();

      expect(runKeyCommand({ type: 'up' })).toBe(false);

      expect(state()).toBe(before);
      expect(calls(rig)).toEqual([]);
    });

    it('leaves an open incident alone at the campus', () => {
      state().select('incident-1');

      expect(runKeyCommand({ type: 'up' })).toBe(false);

      expect(state().selectedIncidentId).toBe('incident-1');
    });

    it('does not ask for the camera: the level camera follows the level', () => {
      state().focusBuilding('BLD-DC');

      runKeyCommand({ type: 'up' });

      expect(calls(rig)).toEqual([]);
    });
  });
});
