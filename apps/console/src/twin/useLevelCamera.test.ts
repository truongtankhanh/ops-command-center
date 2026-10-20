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
    fitAsset: vi.fn<TwinCommands['fitAsset']>(),
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

// An asset on the Data Center's roof, one beside it, one in the lab, and one outside any building.
const CT01: FitBox = { bounds: { minX: 5, maxX: 11, minZ: 5, maxZ: 11 }, heightM: 8, baseM: 24 };
const GEN01: FitBox = { bounds: { minX: 45, maxX: 50, minZ: 5, maxZ: 9 }, heightM: 3, baseM: 0 };
const LKSB3: FitBox = { bounds: { minX: 130, maxX: 131, minZ: 5, maxZ: 6 }, heightM: 1, baseM: 2 };
const TR01: FitBox = { bounds: { minX: 200, maxX: 204, minZ: 5, maxZ: 9 }, heightM: 4, baseM: 0 };
const ASSETS = new Map([
  ['CT-01', CT01],
  ['GEN-01', GEN01],
  ['LKS-B3', LKSB3],
  ['TR-01', TR01],
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
    renderHook(() => useLevelCamera(BOXES, ASSETS));

    store().focusBuilding('dc');

    expect(rig.fit).toHaveBeenCalledTimes(1);
    expect(rig.fit).toHaveBeenCalledWith(DC);
    expect(rig.home).not.toHaveBeenCalled();
  });

  it('flies to the other building when the focus moves to it', () => {
    renderHook(() => useLevelCamera(BOXES, ASSETS));
    store().focusBuilding('dc');

    store().focusBuilding('lab');

    expect(rig.fit).toHaveBeenLastCalledWith(LAB);
    expect(rig.fit).toHaveBeenCalledTimes(2);
  });

  it('flies home when the building is left, by going up or by Home', () => {
    renderHook(() => useLevelCamera(BOXES, ASSETS));
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

  describe('the asset (V2-15.7)', () => {
    it('flies to an asset that is selected, once (AC1)', () => {
      renderHook(() => useLevelCamera(BOXES, ASSETS));

      store().selectAsset('CT-01', 'dc');

      expect(rig.fitAsset).toHaveBeenCalledTimes(1);
      expect(rig.fitAsset).toHaveBeenCalledWith(CT01);
      // The building the asset is in is focused in the same update: that is not a second flight.
      expect(rig.fit).not.toHaveBeenCalled();
      expect(rig.home).not.toHaveBeenCalled();
    });

    it('flies to an asset selected while the building is already in focus', () => {
      renderHook(() => useLevelCamera(BOXES, ASSETS));
      store().focusBuilding('dc');

      store().selectAsset('GEN-01', 'dc');

      expect(rig.fitAsset).toHaveBeenCalledWith(GEN01);
      expect(rig.fit).toHaveBeenCalledTimes(1);
    });

    it('flies to an asset inside another building, as the one flight of the asset (AC2)', () => {
      renderHook(() => useLevelCamera(BOXES, ASSETS));

      store().selectAsset('LKS-B3', 'lab');

      expect(rig.fitAsset).toHaveBeenCalledTimes(1);
      expect(rig.fitAsset).toHaveBeenCalledWith(LKSB3);
      expect(rig.fit).not.toHaveBeenCalled();
    });

    it('ends at the second asset when two are selected one after the other (AC4)', () => {
      renderHook(() => useLevelCamera(BOXES, ASSETS));

      store().selectAsset('CT-01', 'dc');
      store().selectAsset('GEN-01', 'dc');

      expect(rig.fitAsset).toHaveBeenCalledTimes(2);
      expect(rig.fitAsset).toHaveBeenNthCalledWith(1, CT01);
      expect(rig.fitAsset).toHaveBeenLastCalledWith(GEN01);
    });

    it('flies to an asset outside any building, and goes home when it is left', () => {
      renderHook(() => useLevelCamera(BOXES, ASSETS));

      store().selectAsset('TR-01', null);
      expect(rig.fitAsset).toHaveBeenCalledWith(TR01);

      store().goUp();
      expect(rig.home).toHaveBeenCalledTimes(1);
      expect(rig.fit).not.toHaveBeenCalled();
    });

    it('goes back to the building when the asset is closed or left by Escape (AC3)', () => {
      renderHook(() => useLevelCamera(BOXES, ASSETS));
      store().selectAsset('CT-01', 'dc');

      store().selectAsset(null);

      expect(rig.fit).toHaveBeenCalledTimes(1);
      expect(rig.fit).toHaveBeenCalledWith(DC);

      store().selectAsset('CT-01', 'dc');
      store().goUp();
      expect(rig.fit).toHaveBeenCalledTimes(2);
    });

    it('goes back to the building when another selection takes the sheet: an incident or a report', () => {
      renderHook(() => useLevelCamera(BOXES, ASSETS));
      store().selectAsset('CT-01', 'dc');

      store().select('a');
      expect(rig.fit).toHaveBeenCalledTimes(1);
      expect(rig.fit).toHaveBeenLastCalledWith(DC);
      // Selecting the incident did not fly to anything of its own.
      expect(rig.fitAsset).toHaveBeenCalledTimes(1);

      store().selectAsset('CT-01', 'dc');
      store().startReport();
      expect(rig.fit).toHaveBeenCalledTimes(2);
    });

    it('does not move for a part of the isolated asset, selected, left or closed', () => {
      renderHook(() => useLevelCamera(BOXES, ASSETS));
      store().selectAsset('CT-01', 'dc');
      rig.fitAsset.mockClear();

      store().selectPart('FanBlade');
      store().goUp();

      expect(rig.fitAsset).not.toHaveBeenCalled();
      expect(rig.fit).not.toHaveBeenCalled();
      expect(rig.home).not.toHaveBeenCalled();
    });

    it('goes home from the asset and the part when Home leaves everything at once', () => {
      renderHook(() => useLevelCamera(BOXES, ASSETS));
      store().selectAsset('CT-01', 'dc');
      store().selectPart('FanBlade');

      store().goCampus();

      expect(rig.home).toHaveBeenCalledTimes(1);
      expect(rig.fit).not.toHaveBeenCalled();
    });

    it('does not fly for an asset the console has no box for', () => {
      renderHook(() => useLevelCamera(BOXES, ASSETS));

      store().selectAsset('GONE', 'dc');

      expect(rig.fitAsset).not.toHaveBeenCalled();
    });

    it('does not fly at mount, even when the stage starts with an asset isolated', () => {
      store().selectAsset('CT-01', 'dc');

      renderHook(() => useLevelCamera(BOXES, ASSETS));

      expect(rig.fitAsset).not.toHaveBeenCalled();
    });

    it('uses the newest asset boxes at the moment of the change', () => {
      const moved: FitBox = { ...CT01, baseM: 30 };
      const view = renderHook(
        (props: { assets: ReadonlyMap<string, FitBox> }) => useLevelCamera(BOXES, props.assets),
        { initialProps: { assets: ASSETS } },
      );

      view.rerender({ assets: new Map([['CT-01', moved]]) });
      store().selectAsset('CT-01', 'dc');

      expect(rig.fitAsset).toHaveBeenCalledWith(moved);
    });
  });

  it('does not fly for what is not a change of level: hover, filters, an incident', () => {
    renderHook(() => useLevelCamera(BOXES, ASSETS));
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

  it('does not move the camera when an incident is selected, switched or closed, at any level (V2-16.4)', () => {
    renderHook(() => useLevelCamera(BOXES, ASSETS));
    const flights = () => [
      rig.flyTo,
      rig.home,
      rig.fit,
      rig.fitAsset,
      rig.zoomBy,
      rig.rotateBy,
      rig.faceNorth,
    ];

    // Campus level: the feed, the search, the toast and a beacon all end in `select`.
    store().select('a');
    store().select('b');
    store().select(null);
    for (const command of flights()) expect(command).not.toHaveBeenCalled();

    // Building level: the building stays in focus and the camera stays where it is.
    store().focusBuilding('dc');
    for (const command of flights()) command.mockClear();
    store().select('a');
    store().select(null);
    for (const command of flights()) expect(command).not.toHaveBeenCalled();
  });

  it('does not fly at mount, even when the stage starts at building level', () => {
    store().focusBuilding('dc');

    renderHook(() => useLevelCamera(BOXES, ASSETS));

    expect(rig.fit).not.toHaveBeenCalled();
    expect(rig.home).not.toHaveBeenCalled();
  });

  it('does not fly to a building the console does not hold', () => {
    renderHook(() => useLevelCamera(BOXES, ASSETS));

    store().focusBuilding('gone');

    expect(rig.fit).not.toHaveBeenCalled();
  });

  it('uses the newest boxes at the moment of the change', () => {
    const moved: FitBox = { ...DC, heightM: 30 };
    const view = renderHook(
      (props: { boxes: ReadonlyMap<string, FitBox> }) => useLevelCamera(props.boxes, ASSETS),
      { initialProps: { boxes: BOXES } },
    );

    view.rerender({ boxes: new Map([['dc', moved]]) });
    store().focusBuilding('dc');

    expect(rig.fit).toHaveBeenCalledWith(moved);
  });

  it('stops listening when it goes', () => {
    const view = renderHook(() => useLevelCamera(BOXES, ASSETS));
    view.unmount();

    store().focusBuilding('dc');

    expect(rig.fit).not.toHaveBeenCalled();
  });

  it('does nothing, and does not throw, with no rig registered', () => {
    unregister();
    renderHook(() => useLevelCamera(BOXES, ASSETS));

    expect(() => {
      store().focusBuilding('dc');
      store().goCampus();
    }).not.toThrow();
  });
});
