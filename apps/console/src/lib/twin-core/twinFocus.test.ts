import type { LngLat, Zone } from '@occ/contracts';
import { offsetM } from '../map/geo';
import type { FitBox } from './twinCamera';
import { registerTwinCommands, type TwinCommands } from './twinCommands';
import { fitBoxOf, focusAvailable, focusSelection, registerFocusResolver } from './twinFocus';

const CENTER: LngLat = [108.4415, 11.953];

/** A 60 × 46 m building, 14 m tall, centred on `CENTER`. */
const BUILDING: Zone = {
  id: 'BLD-DC',
  code: 'BLD-DC',
  name: 'Data Center',
  kind: 'building',
  heightM: 14,
  polygon: [
    offsetM(CENTER, -30, -23),
    offsetM(CENTER, 30, -23),
    offsetM(CENTER, 30, 23),
    offsetM(CENTER, -30, 23),
    offsetM(CENTER, -30, -23),
  ],
  center: CENTER,
};

const INSIDE = { code: 'UPS-01', zoneId: 'BLD-DC', position: CENTER, elevationM: 0 };
const OUTDOOR = {
  code: 'GEN-01',
  zoneId: 'BLD-DC',
  position: offsetM(CENTER, 200, 0),
  elevationM: 0,
};

describe('fitBoxOf', () => {
  it('gives the ground rectangle, the height and the base of a world box', () => {
    expect(fitBoxOf([1, 2, 3], [5, 3.5, 9])).toEqual({
      bounds: { minX: 1, maxX: 5, minZ: 3, maxZ: 9 },
      heightM: 1.5,
      baseM: 2,
    });
  });
});

describe('focusAvailable', () => {
  const base = { zone: BUILDING, focusZoneId: 'BLD-DC', selectedPart: null };

  it('is off in the 2D view, whatever the asset', () => {
    expect(focusAvailable({ ...base, view: '2d', asset: OUTDOOR })).toBe(false);
    expect(focusAvailable({ ...base, view: '2d', asset: INSIDE })).toBe(false);
  });

  it('is on in the 3D view for an asset the scene draws', () => {
    expect(focusAvailable({ ...base, view: '3d', asset: OUTDOOR })).toBe(true);
  });

  it('is on for an inside asset while its building is in focus, with or without a part', () => {
    expect(focusAvailable({ ...base, view: '3d', asset: INSIDE })).toBe(true);
    expect(focusAvailable({ ...base, view: '3d', asset: INSIDE, selectedPart: 'Fan' })).toBe(true);
  });

  it('is off for an inside asset whose building is not in focus (it is not drawn)', () => {
    expect(focusAvailable({ ...base, view: '3d', asset: INSIDE, focusZoneId: null })).toBe(false);
    expect(focusAvailable({ ...base, view: '3d', asset: INSIDE, focusZoneId: 'BLD-OTHER' })).toBe(
      false,
    );
  });

  it('is on for an asset in a zone the console does not hold: it reads as outdoor', () => {
    expect(
      focusAvailable({ ...base, view: '3d', asset: INSIDE, zone: undefined, focusZoneId: null }),
    ).toBe(true);
  });
});

describe('focusSelection', () => {
  const PART_BOX: FitBox = { bounds: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }, heightM: 1 };
  const ASSET_BOX: FitBox = { bounds: { minX: 0, maxX: 9, minZ: 0, maxZ: 9 }, heightM: 4 };

  /** What a test registers, and must take away again so the next test starts with nothing. */
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  function fitAssetSpy() {
    const fitAsset = vi.fn<TwinCommands['fitAsset']>();
    const commands: TwinCommands = {
      flyTo: vi.fn(),
      home: vi.fn(),
      fit: vi.fn(),
      fitAsset,
      flyToIncident: vi.fn(),
      showAsset: vi.fn(),
      zoomBy: vi.fn(),
      rotateBy: vi.fn(),
      tiltBy: vi.fn(),
      panBy: vi.fn(),
      faceNorth: vi.fn(),
      panStep: vi.fn(),
      panHold: vi.fn(),
      centreOn: vi.fn(),
      current: vi.fn(() => null),
    };
    cleanups.push(registerTwinCommands(commands));
    return fitAsset;
  }

  it('does nothing with no canvas: no resolver, no flight', () => {
    const fitAsset = fitAssetSpy();

    focusSelection('CT-01', 'FanBlade');

    expect(fitAsset).not.toHaveBeenCalled();
  });

  it('flies to the box the resolver gives for the part, asking for that asset and part', () => {
    const fitAsset = fitAssetSpy();
    const resolver = vi.fn(() => PART_BOX);
    cleanups.push(registerFocusResolver(resolver));

    focusSelection('CT-01', 'FanBlade');

    expect(resolver).toHaveBeenCalledWith('CT-01', 'FanBlade');
    expect(fitAsset).toHaveBeenCalledExactlyOnceWith(PART_BOX);
  });

  it('asks for the asset alone when no part is selected', () => {
    const fitAsset = fitAssetSpy();
    const resolver = vi.fn((_: string, part: string | null) => (part ? PART_BOX : ASSET_BOX));
    cleanups.push(registerFocusResolver(resolver));

    focusSelection('CT-01', null);

    expect(resolver).toHaveBeenCalledWith('CT-01', null);
    expect(fitAsset).toHaveBeenCalledExactlyOnceWith(ASSET_BOX);
  });

  it('does not fly when there is nothing drawn to fly to', () => {
    const fitAsset = fitAssetSpy();
    cleanups.push(registerFocusResolver(() => null));

    focusSelection('CT-01', 'FanBlade');

    expect(fitAsset).not.toHaveBeenCalled();
  });

  it('takes the resolver away on cleanup, but not a successor that replaced it', () => {
    const fitAsset = fitAssetSpy();
    const first = registerFocusResolver(() => PART_BOX);
    cleanups.push(registerFocusResolver(() => ASSET_BOX));

    first();
    focusSelection('CT-01', null);
    expect(fitAsset).toHaveBeenCalledExactlyOnceWith(ASSET_BOX);

    cleanups.at(-1)?.();
    fitAsset.mockClear();
    focusSelection('CT-01', null);
    expect(fitAsset).not.toHaveBeenCalled();
  });
});
