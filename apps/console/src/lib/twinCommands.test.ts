import type { Mock } from 'vitest';
import type { FitBox, Pose } from './twinCamera';
import {
  PENDING_SHOW_MS,
  registerTwinCommands,
  type TwinCommands,
  twinCommands,
} from './twinCommands';

const POSE: Pose = { target: [1, 0, 2], distance: 300, yaw: 45, tilt: 55 };
const BOX: FitBox = { bounds: { minX: 0, maxX: 40, minZ: 0, maxZ: 40 }, heightM: 24 };

/** Every command as a spy that still satisfies `TwinCommands`. */
type FakeCommands = { [K in keyof TwinCommands]: Mock<TwinCommands[K]> };

function fakeCommands(pose: Pose | null = POSE): FakeCommands {
  return {
    flyTo: vi.fn<TwinCommands['flyTo']>(),
    home: vi.fn<TwinCommands['home']>(),
    fit: vi.fn<TwinCommands['fit']>(),
    fitAsset: vi.fn<TwinCommands['fitAsset']>(),
    flyToIncident: vi.fn<TwinCommands['flyToIncident']>(),
    showAsset: vi.fn<TwinCommands['showAsset']>(),
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
  // A `showAsset` or `flyToIncident` request that no rig took is module state: a throwaway rig takes it, so no case sees the last one's.
  registerTwinCommands(fakeCommands())();
  vi.useRealTimers();
});

describe('twinCommands with nothing registered', () => {
  it('does nothing, and has no pose, instead of throwing', () => {
    expect(() => {
      twinCommands.flyTo({ target: [0, 0, 0] });
      twinCommands.home();
      twinCommands.fit(BOX);
      twinCommands.fitAsset(BOX);
      twinCommands.flyToIncident('incident-1');
      twinCommands.showAsset('CT-01');
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
    twinCommands.fit(BOX);
    twinCommands.fitAsset(BOX);
    twinCommands.flyToIncident('incident-1');
    twinCommands.showAsset('CT-01');
    twinCommands.zoomBy(0.5);
    twinCommands.rotateBy(-30);
    twinCommands.faceNorth();

    expect(rig.flyTo).toHaveBeenCalledWith({ target: [5, 0, 6], distance: 120 });
    expect(rig.home).toHaveBeenCalledTimes(1);
    expect(rig.fit).toHaveBeenCalledWith(BOX);
    expect(rig.fitAsset).toHaveBeenCalledWith(BOX);
    expect(rig.flyToIncident).toHaveBeenCalledWith('incident-1');
    expect(rig.showAsset).toHaveBeenCalledWith('CT-01');
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
    twinCommands.fit(BOX);
    twinCommands.fitAsset(BOX);
    twinCommands.flyToIncident('incident-1');
    twinCommands.showAsset('CT-01');

    expect(rig.home).not.toHaveBeenCalled();
    expect(rig.fit).not.toHaveBeenCalled();
    expect(rig.fitAsset).not.toHaveBeenCalled();
    expect(rig.flyToIncident).not.toHaveBeenCalled();
    expect(rig.showAsset).not.toHaveBeenCalled();
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

// V2-16.6: "Show in 3D" from the 2D map switches the view and asks in the same tick, before the stage has a rig.
describe('a showAsset request with no rig', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));

  it('waits for a rig, and runs once when one registers', () => {
    twinCommands.showAsset('CT-01');
    const rig = fakeCommands();

    register(rig);

    expect(rig.showAsset).toHaveBeenCalledExactlyOnceWith('CT-01');
  });

  it('runs with the rig already registered, so what it asks in return reaches that rig', () => {
    twinCommands.showAsset('CT-01');
    const rig = fakeCommands();
    rig.showAsset.mockImplementation(() => twinCommands.home());

    register(rig);

    expect(rig.home).toHaveBeenCalledTimes(1);
  });

  it('keeps only the latest request', () => {
    twinCommands.showAsset('CT-01');
    twinCommands.showAsset('GEN-01');
    const rig = fakeCommands();

    register(rig);

    expect(rig.showAsset).toHaveBeenCalledExactlyOnceWith('GEN-01');
  });

  it('is still run just inside the window', () => {
    twinCommands.showAsset('CT-01');
    vi.advanceTimersByTime(PENDING_SHOW_MS);
    const rig = fakeCommands();

    register(rig);

    expect(rig.showAsset).toHaveBeenCalledWith('CT-01');
  });

  it('expires: after the window it is dropped, not run, and does not come back', () => {
    twinCommands.showAsset('CT-01');
    vi.advanceTimersByTime(PENDING_SHOW_MS + 1);
    const late = fakeCommands();

    const unregister = register(late);
    unregister();
    const next = fakeCommands();
    register(next);

    expect(late.showAsset).not.toHaveBeenCalled();
    expect(next.showAsset).not.toHaveBeenCalled();
  });

  it('is run once only: a rig registered again does not run it again', () => {
    twinCommands.showAsset('CT-01');
    const first = fakeCommands();
    const unregister = register(first);
    unregister();
    const second = fakeCommands();

    register(second);

    expect(first.showAsset).toHaveBeenCalledTimes(1);
    expect(second.showAsset).not.toHaveBeenCalled();
  });

  it('is not queued when a rig is already registered: it runs at once', () => {
    const rig = fakeCommands();
    register(rig);

    twinCommands.showAsset('CT-01');
    const later = fakeCommands();
    register(later);

    expect(rig.showAsset).toHaveBeenCalledExactlyOnceWith('CT-01');
    expect(later.showAsset).not.toHaveBeenCalled();
  });

  it('is kept while a rig comes and goes, and not by the other commands', () => {
    twinCommands.showAsset('CT-01');
    twinCommands.home();
    twinCommands.zoomBy(2);
    twinCommands.fit(BOX);
    const rig = fakeCommands();

    register(rig);

    expect(rig.home).not.toHaveBeenCalled();
    expect(rig.zoomBy).not.toHaveBeenCalled();
    expect(rig.fit).not.toHaveBeenCalled();
    expect(rig.showAsset).toHaveBeenCalledWith('CT-01');
  });
});

// V2-18.2: `F` from the 2D view switches the view and asks to fly to an incident's beacon in the same tick.
describe('a flyToIncident request with no rig', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));

  it('waits for a rig, and runs once when one registers', () => {
    twinCommands.flyToIncident('incident-1');
    const rig = fakeCommands();

    register(rig);

    expect(rig.flyToIncident).toHaveBeenCalledExactlyOnceWith('incident-1');
    expect(rig.showAsset).not.toHaveBeenCalled();
  });

  it('is run once only: a rig registered again does not run it again', () => {
    twinCommands.flyToIncident('incident-1');
    const first = fakeCommands();
    const unregister = register(first);
    unregister();
    const second = fakeCommands();

    register(second);

    expect(first.flyToIncident).toHaveBeenCalledTimes(1);
    expect(second.flyToIncident).not.toHaveBeenCalled();
  });

  it('keeps only the latest request, whichever kind it is', () => {
    twinCommands.showAsset('CT-01');
    twinCommands.flyToIncident('incident-1');
    const flyLast = fakeCommands();
    register(flyLast)();

    twinCommands.flyToIncident('incident-1');
    twinCommands.showAsset('CT-01');
    const showLast = fakeCommands();
    register(showLast);

    expect(flyLast.flyToIncident).toHaveBeenCalledExactlyOnceWith('incident-1');
    expect(flyLast.showAsset).not.toHaveBeenCalled();
    expect(showLast.showAsset).toHaveBeenCalledExactlyOnceWith('CT-01');
    expect(showLast.flyToIncident).not.toHaveBeenCalled();
  });

  it('keeps only the latest incident', () => {
    twinCommands.flyToIncident('incident-1');
    twinCommands.flyToIncident('incident-2');
    const rig = fakeCommands();

    register(rig);

    expect(rig.flyToIncident).toHaveBeenCalledExactlyOnceWith('incident-2');
  });

  it('is still run just inside the window, and dropped after it', () => {
    twinCommands.flyToIncident('incident-1');
    vi.advanceTimersByTime(PENDING_SHOW_MS);
    const inside = fakeCommands();
    register(inside)();

    twinCommands.flyToIncident('incident-2');
    vi.advanceTimersByTime(PENDING_SHOW_MS + 1);
    const late = fakeCommands();
    register(late);

    expect(inside.flyToIncident).toHaveBeenCalledWith('incident-1');
    expect(late.flyToIncident).not.toHaveBeenCalled();
  });

  it('is not queued when a rig is already registered: it runs at once', () => {
    const rig = fakeCommands();
    register(rig);

    twinCommands.flyToIncident('incident-1');
    const later = fakeCommands();
    register(later);

    expect(rig.flyToIncident).toHaveBeenCalledExactlyOnceWith('incident-1');
    expect(later.flyToIncident).not.toHaveBeenCalled();
  });

  it('is not kept by the other commands, which do nothing without a rig', () => {
    twinCommands.home();
    twinCommands.fitAsset(BOX);
    const rig = fakeCommands();

    register(rig);

    expect(rig.flyToIncident).not.toHaveBeenCalled();
    expect(rig.home).not.toHaveBeenCalled();
  });
});
