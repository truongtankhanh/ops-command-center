import { renderHook } from '@testing-library/react';
import type { Mock } from 'vitest';
import type { FitBox } from '../lib/twinCamera';
import { registerTwinCommands, type TwinCommands } from '../lib/twinCommands';
import { useConsole } from '../store';
import { resetStore } from '../test-utils';
import { useLevelCamera } from './useLevelCamera';

type FakeCommands = { [K in keyof TwinCommands]: Mock<TwinCommands[K]> };

function fakeCommands(): FakeCommands {
  return {
    flyTo: vi.fn<TwinCommands['flyTo']>(),
    home: vi.fn<TwinCommands['home']>(),
    fit: vi.fn<TwinCommands['fit']>(),
    zoomBy: vi.fn<TwinCommands['zoomBy']>(),
    rotateBy: vi.fn<TwinCommands['rotateBy']>(),
    faceNorth: vi.fn<TwinCommands['faceNorth']>(),
    current: vi.fn<TwinCommands['current']>(() => null),
  };
}

const DC: FitBox = { bounds: { minX: 0, maxX: 40, minZ: 0, maxZ: 40 }, heightM: 24 };
const LAB: FitBox = { bounds: { minX: 100, maxX: 140, minZ: 0, maxZ: 40 }, heightM: 16 };
const BOXES = new Map([
  ['dc', DC],
  ['lab', LAB],
]);

const store = () => useConsole.getState();

describe('useLevelCamera', () => {
  let rig: FakeCommands;
  let unregister: () => void;

  beforeEach(() => {
    resetStore(useConsole);
    rig = fakeCommands();
    unregister = registerTwinCommands(rig);
  });

  afterEach(() => unregister());

  it('flies in to a building that is focused', () => {
    renderHook(() => useLevelCamera(BOXES));

    store().focusBuilding('dc');

    expect(rig.fit).toHaveBeenCalledTimes(1);
    expect(rig.fit).toHaveBeenCalledWith(DC);
    expect(rig.home).not.toHaveBeenCalled();
  });

  it('flies to the other building when the focus moves to it', () => {
    renderHook(() => useLevelCamera(BOXES));
    store().focusBuilding('dc');

    store().focusBuilding('lab');

    expect(rig.fit).toHaveBeenLastCalledWith(LAB);
    expect(rig.fit).toHaveBeenCalledTimes(2);
  });

  it('flies home when the building is left, by going up or by Home', () => {
    renderHook(() => useLevelCamera(BOXES));
    store().focusBuilding('dc');
    store().goUp();
    expect(rig.home).toHaveBeenCalledTimes(1);

    store().focusBuilding('dc');
    store().goCampus();
    expect(rig.home).toHaveBeenCalledTimes(2);

    store().focusBuilding('dc');
    store().focusBuilding(null);
    expect(rig.home).toHaveBeenCalledTimes(3);
  });

  it('flies nothing for an asset or a part, and back to its building when the asset is left (AC2)', () => {
    renderHook(() => useLevelCamera(BOXES));

    store().selectAsset('CT-01', 'dc');
    store().selectPart('FanBlade');
    expect(rig.fit).not.toHaveBeenCalled();
    expect(rig.home).not.toHaveBeenCalled();

    // Part → asset is still no flight; asset → building is the fit of that building.
    store().goUp();
    expect(rig.fit).not.toHaveBeenCalled();
    store().goUp();
    expect(rig.fit).toHaveBeenCalledTimes(1);
    expect(rig.fit).toHaveBeenCalledWith(DC);
  });

  it('flies an asset outside any building home when it is left', () => {
    renderHook(() => useLevelCamera(BOXES));
    store().selectAsset('TR-01', null);
    expect(rig.home).not.toHaveBeenCalled();
    expect(rig.fit).not.toHaveBeenCalled();

    store().goUp();

    expect(rig.home).toHaveBeenCalledTimes(1);
  });

  it('flies home from an asset when Home leaves everything at once', () => {
    renderHook(() => useLevelCamera(BOXES));
    store().selectAsset('CT-01', 'dc');
    rig.fit.mockClear();

    store().goCampus();

    expect(rig.home).toHaveBeenCalledTimes(1);
    expect(rig.fit).not.toHaveBeenCalled();
  });

  it('does not fly for what is not a change of level: hover, filters, an incident', () => {
    renderHook(() => useLevelCamera(BOXES));
    store().focusBuilding('dc');
    rig.fit.mockClear();

    store().hoverAsset('CT-01');
    store().hoverPart('FanBlade');
    store().setAssetFilter('faults');
    store().select('a');
    store().focusBuilding('dc');

    expect(rig.fit).not.toHaveBeenCalled();
    expect(rig.home).not.toHaveBeenCalled();
  });

  it('does not fly at mount, even when the stage starts at building level', () => {
    store().focusBuilding('dc');

    renderHook(() => useLevelCamera(BOXES));

    expect(rig.fit).not.toHaveBeenCalled();
    expect(rig.home).not.toHaveBeenCalled();
  });

  it('does not fly to a building the console does not hold', () => {
    renderHook(() => useLevelCamera(BOXES));

    store().focusBuilding('gone');

    expect(rig.fit).not.toHaveBeenCalled();
  });

  it('uses the newest boxes at the moment of the change', () => {
    const moved: FitBox = { ...DC, heightM: 30 };
    const view = renderHook(
      (props: { boxes: ReadonlyMap<string, FitBox> }) => useLevelCamera(props.boxes),
      { initialProps: { boxes: BOXES } },
    );

    view.rerender({ boxes: new Map([['dc', moved]]) });
    store().focusBuilding('dc');

    expect(rig.fit).toHaveBeenCalledWith(moved);
  });

  it('stops listening when it goes', () => {
    const view = renderHook(() => useLevelCamera(BOXES));
    view.unmount();

    store().focusBuilding('dc');

    expect(rig.fit).not.toHaveBeenCalled();
  });

  it('does nothing, and does not throw, with no rig registered', () => {
    unregister();
    renderHook(() => useLevelCamera(BOXES));

    expect(() => {
      store().focusBuilding('dc');
      store().goCampus();
    }).not.toThrow();
  });
});
