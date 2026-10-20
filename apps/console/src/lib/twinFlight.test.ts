import type { Mock } from 'vitest';
import { useConsole } from '../store';
import { resetStore, stubTwinAvailable, unstubTwin } from '../test-utils';
import type { FitBox } from './twinCamera';
import { registerTwinCommands, type TwinCommands } from './twinCommands';
import { type FocusResolver, registerFocusResolver } from './twinFocus';
import { flyToSelection, resetView, showAssetIn3d } from './twinFlight';
import type { SelectionTarget } from './twinSelection';

const BOX: FitBox = { bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 10 }, heightM: 5 };

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
    current: vi.fn<TwinCommands['current']>(() => null),
  };
}

const cleanups: (() => void)[] = [];

/** A 3D stage as far as these flights can tell: a rig for the camera and a resolver for "which box?". */
function mountStage() {
  const rig = fakeCommands();
  const resolver = vi.fn<FocusResolver>(() => BOX);
  cleanups.push(registerTwinCommands(rig), registerFocusResolver(resolver));
  return { rig, resolver };
}

const view = () => useConsole.getState().view;

const PART: SelectionTarget = { kind: 'part', assetCode: 'CT-01', part: 'Fan' };
const ASSET: SelectionTarget = { kind: 'asset', assetCode: 'CT-01' };
const INCIDENT_ASSET: SelectionTarget = { kind: 'incident-asset', assetCode: 'CT-01' };
const INCIDENT: SelectionTarget = { kind: 'incident', incidentId: 'incident-1' };

beforeEach(() => {
  localStorage.clear();
  resetStore(useConsole);
});

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  // A request that no rig took is module state: a throwaway rig takes it, so no case sees the last one's.
  registerTwinCommands(fakeCommands())();
  unstubTwin();
  vi.restoreAllMocks();
});

describe('flyToSelection in the 3D view', () => {
  beforeEach(() => useConsole.setState({ view: '3d' }));

  it('focuses the part of an asset', () => {
    const { rig, resolver } = mountStage();

    flyToSelection(PART);

    expect(resolver).toHaveBeenCalledExactlyOnceWith('CT-01', 'Fan');
    expect(rig.fitAsset).toHaveBeenCalledExactlyOnceWith(BOX);
  });

  it('focuses the asset', () => {
    const { rig, resolver } = mountStage();

    flyToSelection(ASSET);

    expect(resolver).toHaveBeenCalledExactlyOnceWith('CT-01', null);
    expect(rig.fitAsset).toHaveBeenCalledExactlyOnceWith(BOX);
  });

  it("frames an incident's asset and selects nothing", () => {
    const { rig } = mountStage();
    useConsole.getState().select('incident-1');

    flyToSelection(INCIDENT_ASSET);

    expect(rig.showAsset).toHaveBeenCalledExactlyOnceWith('CT-01');
    expect(useConsole.getState().selectedIncidentId).toBe('incident-1');
    expect(useConsole.getState().selectedAssetCode).toBeNull();
  });

  it("flies to an incident's beacon", () => {
    const { rig } = mountStage();

    flyToSelection(INCIDENT);

    expect(rig.flyToIncident).toHaveBeenCalledExactlyOnceWith('incident-1');
    expect(rig.showAsset).not.toHaveBeenCalled();
  });

  it('stays in 3D', () => {
    mountStage();

    flyToSelection(INCIDENT);

    expect(view()).toBe('3d');
  });
});

describe('flyToSelection from the 2D view with 3D available', () => {
  beforeEach(() => {
    stubTwinAvailable();
    useConsole.setState({ view: '2d' });
  });

  it.each([
    ['a part', PART],
    ['an asset', ASSET],
    ["an incident's asset", INCIDENT_ASSET],
    ["an incident's beacon", INCIDENT],
  ])('switches to 3D first, for %s', (_, target) => {
    flyToSelection(target);

    expect(view()).toBe('3d');
  });

  it("keeps an incident's beacon for the stage's rig, and flies once it exists", () => {
    flyToSelection(INCIDENT);
    const { rig } = mountStage();

    expect(rig.flyToIncident).toHaveBeenCalledExactlyOnceWith('incident-1');
  });

  it("keeps an incident's asset for the stage's rig, as 'Show in 3D' always did", () => {
    flyToSelection(INCIDENT_ASSET);
    const { rig } = mountStage();

    expect(rig.showAsset).toHaveBeenCalledExactlyOnceWith('CT-01');
  });

  it('does not fly to an asset or a part before the stage exists: its first view is the asset', () => {
    flyToSelection(ASSET);
    flyToSelection(PART);
    const { rig, resolver } = mountStage();

    expect(resolver).not.toHaveBeenCalled();
    expect(rig.fitAsset).not.toHaveBeenCalled();
    expect(view()).toBe('3d');
  });
});

describe('flyToSelection where 3D is unavailable', () => {
  it.each([
    ['a part', PART],
    ['an asset', ASSET],
    ["an incident's asset", INCIDENT_ASSET],
    ["an incident's beacon", INCIDENT],
  ])('does nothing for %s, and keeps nothing for a later rig', (_, target) => {
    useConsole.setState({ view: '2d' });

    flyToSelection(target);
    const { rig, resolver } = mountStage();

    expect(view()).toBe('2d');
    expect(rig.flyToIncident).not.toHaveBeenCalled();
    expect(rig.showAsset).not.toHaveBeenCalled();
    expect(rig.fitAsset).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe('showAssetIn3d', () => {
  it('frames the asset at once in 3D', () => {
    useConsole.setState({ view: '3d' });
    const { rig } = mountStage();

    showAssetIn3d('CT-01');

    expect(rig.showAsset).toHaveBeenCalledExactlyOnceWith('CT-01');
  });

  it('switches from 2D first, and waits for the rig the stage brings', () => {
    stubTwinAvailable();

    showAssetIn3d('CT-01');
    const { rig } = mountStage();

    expect(view()).toBe('3d');
    expect(rig.showAsset).toHaveBeenCalledExactlyOnceWith('CT-01');
  });

  it('does nothing where 3D is unavailable', () => {
    showAssetIn3d('CT-01');
    const { rig } = mountStage();

    expect(view()).toBe('2d');
    expect(rig.showAsset).not.toHaveBeenCalled();
  });
});

// V2-18.3: the Reset button's and the `Home` key's one function.
describe('resetView', () => {
  it('leaves the part, the asset and the building, then flies home', () => {
    const { rig } = mountStage();
    useConsole.getState().selectAsset('CT-01', 'BLD-DC');
    useConsole.getState().selectPart('Fan');

    resetView();

    const state = useConsole.getState();
    expect(state.selectedPart).toBeNull();
    expect(state.selectedAssetCode).toBeNull();
    expect(state.focusZoneId).toBeNull();
    expect(rig.home).toHaveBeenCalledOnce();
  });

  it('flies home even when the level was the campus already', () => {
    const { rig } = mountStage();

    resetView();

    expect(rig.home).toHaveBeenCalledOnce();
  });

  it('keeps an open incident and an open report form', () => {
    mountStage();
    useConsole.getState().focusBuilding('BLD-DC');
    useConsole.getState().select('incident-1');

    resetView();
    expect(useConsole.getState().selectedIncidentId).toBe('incident-1');

    useConsole.getState().startReport();
    useConsole.getState().focusBuilding('BLD-DC');
    resetView();
    expect(useConsole.getState().reporting).toBe(true);
  });

  it('does nothing to the camera when no stage is mounted', () => {
    expect(() => resetView()).not.toThrow();
  });
});
