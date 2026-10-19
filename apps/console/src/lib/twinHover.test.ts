import { assetHover, hoveredShellZone, hoverOf, NO_HOVER } from './twinHover';
import type { SceneFocus } from './twinLevel';
import type { PlacedAsset, Placement } from './twinPlacement';

const placed = (code: string, placement: Placement, zoneId = 'BLD-DC'): PlacedAsset => ({
  code,
  classCode: 'cooling_tower',
  zoneId,
  placement,
  pose: { x: 0, y: 0, z: 0, rotationY: 0 },
  size: { x: 1, y: 1, z: 1 },
});

describe('hoverOf', () => {
  it('is the one shared empty hover when nothing is hovered', () => {
    expect(hoverOf({ hoveredAssetCode: null, hoveredPart: null })).toBe(NO_HOVER);
  });

  it('names the asset a row hovers', () => {
    expect(hoverOf({ hoveredAssetCode: 'CT-01', hoveredPart: null })).toEqual({
      asset: 'CT-01',
      part: null,
    });
  });

  it('names the part the pointer hovers, with its asset', () => {
    expect(hoverOf({ hoveredAssetCode: 'CT-01', hoveredPart: 'FanBlade' })).toEqual({
      asset: 'CT-01',
      part: 'FanBlade',
    });
  });

  it('makes a new object for each hover, so a reader can tell by identity that it changed', () => {
    const first = hoverOf({ hoveredAssetCode: 'CT-01', hoveredPart: null });
    const second = hoverOf({ hoveredAssetCode: 'CT-01', hoveredPart: null });
    expect(second).not.toBe(first);
  });
});

describe('assetHover', () => {
  it('leaves an asset alone when nothing is hovered', () => {
    expect(assetHover('CT-01', NO_HOVER)).toEqual({ whole: false, part: null });
  });

  it('leaves an asset alone when another one is hovered', () => {
    expect(assetHover('CT-01', { asset: 'CT-02', part: null })).toEqual({
      whole: false,
      part: null,
    });
  });

  it('tints the whole asset that is hovered', () => {
    expect(assetHover('CT-01', { asset: 'CT-01', part: null })).toEqual({
      whole: true,
      part: null,
    });
  });

  it('tints the part alone when a part is hovered, not the asset around it', () => {
    expect(assetHover('CT-01', { asset: 'CT-01', part: 'FanBlade' })).toEqual({
      whole: false,
      part: 'FanBlade',
    });
  });

  it('ignores a part whose asset is another one', () => {
    expect(assetHover('CT-02', { asset: 'CT-01', part: 'FanBlade' })).toEqual({
      whole: false,
      part: null,
    });
  });
});

describe('hoveredShellZone', () => {
  /** The building level, with the `Inside` layer shown unless it is told otherwise. */
  const focusOn = (zoneId: string, inside = true): SceneFocus => ({
    zoneId,
    assetCode: null,
    inside,
  });
  const scene = [
    placed('PMP-S1', 'inside', 'BLD-STU'),
    placed('CT-01', 'roof'),
    placed('GEN-01', 'outdoor'),
  ];

  it('is the zone of an asset that is inside a building and so not drawn', () => {
    expect(hoveredShellZone('PMP-S1', scene)).toBe('BLD-STU');
  });

  it('is nothing for an asset that is drawn: on a roof or outdoors', () => {
    expect(hoveredShellZone('CT-01', scene)).toBeNull();
    expect(hoveredShellZone('GEN-01', scene)).toBeNull();
  });

  it('is nothing for an asset inside the building in focus, which draws it', () => {
    expect(hoveredShellZone('PMP-S1', scene, focusOn('BLD-STU'))).toBeNull();
  });

  it('still tints the building of an inside asset when another building is in focus', () => {
    expect(hoveredShellZone('PMP-S1', scene, focusOn('BLD-DC'))).toBe('BLD-STU');
  });

  it('tints the focused building for its inside asset when Inside is off: the equipment is not drawn (V2-15.9)', () => {
    expect(hoveredShellZone('PMP-S1', scene, focusOn('BLD-STU', false))).toBe('BLD-STU');
  });

  it('never tints for a roof or outdoor asset, with Inside off either', () => {
    expect(hoveredShellZone('CT-01', scene, focusOn('BLD-DC', false))).toBeNull();
    expect(hoveredShellZone('GEN-01', scene, focusOn('BLD-DC', false))).toBeNull();
  });

  it('is nothing for the isolated asset itself, even an inside one, whatever Inside says', () => {
    const isolated: SceneFocus = { zoneId: 'BLD-STU', assetCode: 'PMP-S1', inside: false };

    expect(hoveredShellZone('PMP-S1', scene, isolated)).toBeNull();
  });

  it('is nothing for no hover or an asset the scene does not hold', () => {
    expect(hoveredShellZone(null, scene)).toBeNull();
    expect(hoveredShellZone('NOT-THERE', scene)).toBeNull();
  });
});
