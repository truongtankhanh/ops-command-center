import type { Mock } from 'vitest';
import type { Pose } from './twinCamera';
import { registerTwinCommands, type TwinCommands, twinCommands } from './twinCommands';

const POSE: Pose = { target: [1, 0, 2], distance: 300, yaw: 45, tilt: 55 };

/** Every command as a spy that still satisfies `TwinCommands`. */
type FakeCommands = { [K in keyof TwinCommands]: Mock<TwinCommands[K]> };

function fakeCommands(pose: Pose | null = POSE): FakeCommands {
  return {
    flyTo: vi.fn<TwinCommands['flyTo']>(),
    home: vi.fn<TwinCommands['home']>(),
    zoomBy: vi.fn<TwinCommands['zoomBy']>(),
    rotateBy: vi.fn<TwinCommands['rotateBy']>(),
    faceNorth: vi.fn<TwinCommands['faceNorth']>(),
    current: vi.fn<TwinCommands['current']>(() => pose),
  };
}

/** What a test registers, and must take away again so the next test starts with nothing. */
const cleanups: (() => void)[] = [];
const register = (commands: TwinCommands) => {
  const unregister = registerTwinCommands(commands);
  cleanups.push(unregister);
  return unregister;
};

afterEach(() => {
  cleanups.splice(0).forEach((unregister) => unregister());
});

describe('twinCommands with nothing registered', () => {
  it('does nothing, and has no pose, instead of throwing', () => {
    expect(() => {
      twinCommands.flyTo({ target: [0, 0, 0] });
      twinCommands.home();
      twinCommands.zoomBy(2);
      twinCommands.rotateBy(30);
      twinCommands.faceNorth();
    }).not.toThrow();
    expect(twinCommands.current()).toBeNull();
  });
});

describe('registerTwinCommands', () => {
  it('forwards each command, with its arguments, to the registered rig', () => {
    const rig = fakeCommands();
    register(rig);

    twinCommands.flyTo({ target: [5, 0, 6], distance: 120 });
    twinCommands.home();
    twinCommands.zoomBy(0.5);
    twinCommands.rotateBy(-30);
    twinCommands.faceNorth();

    expect(rig.flyTo).toHaveBeenCalledWith({ target: [5, 0, 6], distance: 120 });
    expect(rig.home).toHaveBeenCalledTimes(1);
    expect(rig.zoomBy).toHaveBeenCalledWith(0.5);
    expect(rig.rotateBy).toHaveBeenCalledWith(-30);
    expect(rig.faceNorth).toHaveBeenCalledTimes(1);
  });

  it('answers current() from the rig', () => {
    register(fakeCommands());

    expect(twinCommands.current()).toEqual(POSE);
  });

  it('turns a rig that has no pose into null', () => {
    register(fakeCommands(null));

    expect(twinCommands.current()).toBeNull();
  });

  it('replaces: the latest registration wins', () => {
    const first = fakeCommands();
    const second = fakeCommands();
    register(first);
    register(second);

    twinCommands.home();

    expect(second.home).toHaveBeenCalledTimes(1);
    expect(first.home).not.toHaveBeenCalled();
  });

  it('does not let a replaced rig clear its successor when its cleanup runs late', () => {
    const first = fakeCommands();
    const second = fakeCommands();
    const unregisterFirst = register(first);
    register(second);

    unregisterFirst();
    twinCommands.home();

    expect(second.home).toHaveBeenCalledTimes(1);
  });

  it('clears: after unregistering, the commands do nothing again', () => {
    const rig = fakeCommands();
    const unregister = register(rig);

    unregister();
    twinCommands.home();

    expect(rig.home).not.toHaveBeenCalled();
    expect(twinCommands.current()).toBeNull();
  });

  it('can be unregistered twice, and the second call leaves a newer registration alone', () => {
    const first = fakeCommands();
    const second = fakeCommands();
    const unregisterFirst = register(first);
    unregisterFirst();
    register(second);

    unregisterFirst();
    twinCommands.faceNorth();

    expect(second.faceNorth).toHaveBeenCalledTimes(1);
  });
});
