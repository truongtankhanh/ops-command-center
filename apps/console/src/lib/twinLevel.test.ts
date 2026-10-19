import { buildingFocusOf, crumbsOf, levelOf, parentOf, type SceneLevel } from './twinLevel';

const none = { focusZoneId: null, selectedAssetCode: null, selectedPart: null };

describe('levelOf', () => {
  it('is campus with nothing selected or in focus', () => {
    expect(levelOf(none)).toBe('campus');
  });

  it('is building with a building in focus and no asset', () => {
    expect(levelOf({ ...none, focusZoneId: 'BLD-DC' })).toBe('building');
  });

  it('is asset with an asset selected, in or outside a building', () => {
    expect(levelOf({ ...none, focusZoneId: 'BLD-DC', selectedAssetCode: 'CT-01' })).toBe('asset');
    expect(levelOf({ ...none, selectedAssetCode: 'TR-01' })).toBe('asset');
  });

  it('is part with a part of the selected asset selected', () => {
    expect(
      levelOf({ focusZoneId: 'BLD-DC', selectedAssetCode: 'CT-01', selectedPart: 'FanBlade' }),
    ).toBe('part');
    expect(levelOf({ ...none, selectedAssetCode: 'TR-01', selectedPart: 'Bushing' })).toBe('part');
  });

  it('reads a part with no asset as the level the rest gives', () => {
    expect(levelOf({ ...none, selectedPart: 'FanBlade' })).toBe('campus');
    expect(levelOf({ ...none, focusZoneId: 'BLD-DC', selectedPart: 'FanBlade' })).toBe('building');
  });
});

describe('parentOf', () => {
  it('goes part, asset, building, campus and then nowhere', () => {
    const order: (SceneLevel | null)[] = [];
    for (let level: SceneLevel | null = 'part'; level !== null; level = parentOf(level)) {
      order.push(level);
    }
    expect(order).toEqual(['part', 'asset', 'building', 'campus']);
    expect(parentOf('campus')).toBeNull();
  });
});

describe('crumbsOf', () => {
  const zone = { id: 'BLD-DC', name: 'Data Center' };
  const labels = (crumbs: ReturnType<typeof crumbsOf>) => crumbs.map((crumb) => crumb.label);

  it('is Campus alone at campus level, whatever it is given', () => {
    expect(labels(crumbsOf('campus', undefined, undefined))).toEqual(['Campus']);
    expect(labels(crumbsOf('campus', zone, { code: 'CT-01' }))).toEqual(['Campus']);
  });

  it('adds the building at building level', () => {
    expect(labels(crumbsOf('building', zone, undefined))).toEqual(['Campus', 'Data Center']);
    expect(labels(crumbsOf('building', zone, { code: 'CT-01' }))).toEqual([
      'Campus',
      'Data Center',
    ]);
  });

  it('adds the asset by its code at asset level', () => {
    expect(labels(crumbsOf('asset', zone, { code: 'CT-01' }))).toEqual([
      'Campus',
      'Data Center',
      'CT-01',
    ]);
  });

  it('has no middle crumb for an asset outside any building', () => {
    expect(labels(crumbsOf('asset', undefined, { code: 'TR-01' }))).toEqual(['Campus', 'TR-01']);
  });

  it('is the same at part level: the part is the callout, not a crumb', () => {
    expect(crumbsOf('part', zone, { code: 'CT-01' })).toEqual(
      crumbsOf('asset', zone, { code: 'CT-01' }),
    );
  });

  it('leaves out an asset that is not known yet', () => {
    expect(labels(crumbsOf('asset', zone, undefined))).toEqual(['Campus', 'Data Center']);
  });

  it('leads each crumb to its own level', () => {
    expect(crumbsOf('asset', zone, { code: 'CT-01' }).map((crumb) => crumb.target)).toEqual([
      { level: 'campus' },
      { level: 'building', zoneId: 'BLD-DC' },
      { level: 'asset', code: 'CT-01' },
    ]);
  });
});

describe('buildingFocusOf', () => {
  const zones = [
    { id: 'BLD-DC', kind: 'building' as const },
    { id: 'UTL-PLANT', kind: 'utility' as const },
  ];

  it('is the zone id for an asset in a building zone', () => {
    expect(buildingFocusOf({ zoneId: 'BLD-DC' }, zones)).toBe('BLD-DC');
  });

  it('is null for an asset in a zone that is not a building', () => {
    expect(buildingFocusOf({ zoneId: 'UTL-PLANT' }, zones)).toBeNull();
  });

  it('is null for a zone the console does not have, and while the zones are loading', () => {
    expect(buildingFocusOf({ zoneId: 'BLD-GONE' }, zones)).toBeNull();
    expect(buildingFocusOf({ zoneId: 'BLD-DC' }, undefined)).toBeNull();
  });
});
