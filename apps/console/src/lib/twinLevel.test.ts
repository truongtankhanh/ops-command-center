import {
  buildingFocusOf,
  buildingLine,
  crumbsOf,
  focusOf,
  isolationLine,
  isolationOf,
  levelOf,
  parentOf,
  presenceMap,
  presenceOf,
  type SceneFocus,
  type SceneLevel,
} from './twinLevel';

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

describe('isolationOf (V2-15.7)', () => {
  it('is nothing at campus and building level, where nothing is faded', () => {
    expect(isolationOf(none)).toBeNull();
    expect(isolationOf({ ...none, focusZoneId: 'BLD-DC' })).toBeNull();
  });

  it('is the asset and its building at asset level', () => {
    expect(isolationOf({ ...none, focusZoneId: 'BLD-DC', selectedAssetCode: 'CT-01' })).toEqual({
      assetCode: 'CT-01',
      zoneId: 'BLD-DC',
    });
  });

  it('has no building for an asset in none', () => {
    expect(isolationOf({ ...none, selectedAssetCode: 'TR-01' })).toEqual({
      assetCode: 'TR-01',
      zoneId: null,
    });
  });

  it('is the same at part level: the asset stays isolated while its part is looked at', () => {
    expect(
      isolationOf({ focusZoneId: 'BLD-DC', selectedAssetCode: 'CT-01', selectedPart: 'FanBlade' }),
    ).toEqual({ assetCode: 'CT-01', zoneId: 'BLD-DC' });
  });
});

describe('isolationLine (V2-15.7)', () => {
  it('says the rest is faded and where Escape goes back to', () => {
    expect(isolationLine('Data Center')).toEqual({
      lead: 'Isolated — the rest of the campus is faded.',
      back: 'returns to Data Center',
    });
    expect(isolationLine('Campus').back).toBe('returns to Campus');
  });

  it('leaves out where it goes back to while the building is not known yet', () => {
    expect(isolationLine(null)).toEqual({
      lead: 'Isolated — the rest of the campus is faded.',
      back: null,
    });
  });
});

describe('focusOf (V2-15.8)', () => {
  it('is nothing at campus level', () => {
    expect(focusOf(none)).toBeNull();
  });

  it('is the building alone at building level', () => {
    expect(focusOf({ ...none, focusZoneId: 'BLD-DC' })).toEqual({
      zoneId: 'BLD-DC',
      assetCode: null,
      inside: true,
    });
  });

  it('carries the Inside layer at building level (V2-15.9), shown unless it is told otherwise', () => {
    expect(focusOf({ ...none, focusZoneId: 'BLD-DC' }, false)).toEqual({
      zoneId: 'BLD-DC',
      assetCode: null,
      inside: false,
    });
    expect(focusOf({ ...none, focusZoneId: 'BLD-DC' }, true)?.inside).toBe(true);
  });

  it('ignores the Inside layer at asset and part level: isolation wins (V2-15.9)', () => {
    const selected = { focusZoneId: 'BLD-DC', selectedAssetCode: 'UPS-01' };

    expect(focusOf({ ...selected, selectedPart: null }, false)?.inside).toBe(true);
    expect(focusOf({ ...selected, selectedPart: 'Door' }, false)?.inside).toBe(true);
    expect(focusOf({ ...none, selectedAssetCode: 'TR-01' }, false)?.inside).toBe(true);
  });

  it('has no focus at campus level whatever the layer says', () => {
    expect(focusOf(none, false)).toBeNull();
  });

  it('is the asset and its building at asset and part level, so the building stays in focus', () => {
    const asset = { zoneId: 'BLD-DC', assetCode: 'CT-01', inside: true };

    expect(focusOf({ ...none, focusZoneId: 'BLD-DC', selectedAssetCode: 'CT-01' })).toEqual(asset);
    expect(
      focusOf({ focusZoneId: 'BLD-DC', selectedAssetCode: 'CT-01', selectedPart: 'FanBlade' }),
    ).toEqual(asset);
  });

  it('has no building for an asset in none', () => {
    expect(focusOf({ ...none, selectedAssetCode: 'TR-01' })).toEqual({
      zoneId: null,
      assetCode: 'TR-01',
      inside: true,
    });
  });
});

describe('presenceOf (V2-15.8)', () => {
  const building = (zoneId: string) => ({ kind: 'building' as const, zoneId });
  const asset = (
    code: string,
    zoneId: string,
    placement: 'outdoor' | 'roof' | 'inside' = 'outdoor',
  ) => ({ kind: 'asset' as const, code, zoneId, placement });
  const campus: SceneFocus | null = null;
  const dataCenter: SceneFocus = { zoneId: 'BLD-DC', assetCode: null, inside: true };
  const dataCenterOpaque: SceneFocus = { ...dataCenter, inside: false };

  describe('at campus level', () => {
    it('draws every building as it is', () => {
      expect(presenceOf(building('BLD-DC'), campus)).toBe('drawn');
    });

    it('draws the outdoor and roof assets and hides the inside ones', () => {
      expect(presenceOf(asset('TR-01', 'UTL-PLANT'), campus)).toBe('drawn');
      expect(presenceOf(asset('GEN-01', 'BLD-DC'), campus)).toBe('drawn');
      expect(presenceOf(asset('CT-01', 'BLD-DC', 'roof'), campus)).toBe('drawn');
      expect(presenceOf(asset('UPS-01', 'BLD-DC', 'inside'), campus)).toBe('hidden');
    });

    it('draws the camera markers as they are', () => {
      expect(presenceOf({ kind: 'marker' }, campus)).toBe('drawn');
    });
  });

  describe('at building level', () => {
    it('makes the building in focus see-through and fades the others', () => {
      expect(presenceOf(building('BLD-DC'), dataCenter)).toBe('xray');
      expect(presenceOf(building('BLD-LAB'), dataCenter)).toBe('faded');
    });

    it('draws what belongs to the building: inside, on the roof and beside it (GEN-01)', () => {
      expect(presenceOf(asset('UPS-01', 'BLD-DC', 'inside'), dataCenter)).toBe('drawn');
      expect(presenceOf(asset('CT-01', 'BLD-DC', 'roof'), dataCenter)).toBe('drawn');
      expect(presenceOf(asset('GEN-01', 'BLD-DC'), dataCenter)).toBe('drawn');
    });

    it('fades the equipment of other buildings and of no building, and hides their inside ones', () => {
      expect(presenceOf(asset('AHU-H1', 'BLD-HUB', 'roof'), dataCenter)).toBe('faded');
      expect(presenceOf(asset('TR-01', 'UTL-PLANT'), dataCenter)).toBe('faded');
      expect(presenceOf(asset('LKS-B3', 'BLD-DORB', 'inside'), dataCenter)).toBe('hidden');
    });

    it('leaves the camera markers as they are', () => {
      expect(presenceOf({ kind: 'marker' }, dataCenter)).toBe('drawn');
    });
  });

  describe('at building level with Inside off (V2-15.9)', () => {
    it('draws the focused shell opaque, and the other buildings faded as before', () => {
      expect(presenceOf(building('BLD-DC'), dataCenterOpaque)).toBe('drawn');
      expect(presenceOf(building('BLD-LAB'), dataCenterOpaque)).toBe('faded');
    });

    it('hides the equipment inside the building', () => {
      expect(presenceOf(asset('UPS-01', 'BLD-DC', 'inside'), dataCenterOpaque)).toBe('hidden');
      expect(presenceOf(asset('ICS-DC', 'BLD-DC', 'inside'), dataCenterOpaque)).toBe('hidden');
    });

    it('keeps the roof and the outdoor equipment of the building drawn', () => {
      expect(presenceOf(asset('CT-01', 'BLD-DC', 'roof'), dataCenterOpaque)).toBe('drawn');
      expect(presenceOf(asset('GEN-01', 'BLD-DC'), dataCenterOpaque)).toBe('drawn');
    });

    it('fades the equipment of other buildings as before, and hides their inside ones', () => {
      expect(presenceOf(asset('AHU-H1', 'BLD-HUB', 'roof'), dataCenterOpaque)).toBe('faded');
      expect(presenceOf(asset('TR-01', 'UTL-PLANT'), dataCenterOpaque)).toBe('faded');
      expect(presenceOf(asset('LKS-B3', 'BLD-DORB', 'inside'), dataCenterOpaque)).toBe('hidden');
    });

    it('leaves the markers as they are', () => {
      expect(presenceOf({ kind: 'marker' }, dataCenterOpaque)).toBe('drawn');
    });

    it('changes nothing with Inside on', () => {
      expect(presenceOf(building('BLD-DC'), dataCenter)).toBe('xray');
      expect(presenceOf(asset('UPS-01', 'BLD-DC', 'inside'), dataCenter)).toBe('drawn');
    });
  });

  describe('at asset and part level', () => {
    const isolated: SceneFocus = { zoneId: 'BLD-DORB', assetCode: 'LKS-B3', inside: true };

    it('keeps the asset’s building see-through, as frame 15 draws it, and fades the others', () => {
      expect(presenceOf(building('BLD-DORB'), isolated)).toBe('xray');
      expect(presenceOf(building('BLD-DC'), isolated)).toBe('faded');
    });

    it('draws the isolated asset and fades every other, its neighbours in the building too', () => {
      expect(presenceOf(asset('LKS-B3', 'BLD-DORB', 'inside'), isolated)).toBe('drawn');
      expect(presenceOf(asset('ICS-DORB', 'BLD-DORB', 'inside'), isolated)).toBe('faded');
      expect(presenceOf(asset('CT-01', 'BLD-DC', 'roof'), isolated)).toBe('faded');
    });

    it('still hides the inside assets of other buildings', () => {
      expect(presenceOf(asset('UPS-01', 'BLD-DC', 'inside'), isolated)).toBe('hidden');
    });

    it('fades every building for an asset in none, and draws the asset', () => {
      const outdoor: SceneFocus = { zoneId: null, assetCode: 'TR-01', inside: true };

      expect(presenceOf(building('BLD-DC'), outdoor)).toBe('faded');
      expect(presenceOf(asset('TR-01', 'UTL-PLANT'), outdoor)).toBe('drawn');
      expect(presenceOf(asset('UPS-01', 'BLD-DC', 'inside'), outdoor)).toBe('hidden');
    });

    it('fades the camera markers', () => {
      expect(presenceOf({ kind: 'marker' }, isolated)).toBe('faded');
    });

    it('keeps the shell see-through and the isolated inside asset drawn even if Inside is off (V2-15.9)', () => {
      const off: SceneFocus = { ...isolated, inside: false };

      expect(presenceOf(building('BLD-DORB'), off)).toBe('xray');
      expect(presenceOf(asset('LKS-B3', 'BLD-DORB', 'inside'), off)).toBe('drawn');
    });
  });
});

describe('presenceMap (V2-15.8)', () => {
  const placed = [
    { code: 'CT-01', zoneId: 'BLD-DC', placement: 'roof' as const },
    { code: 'UPS-01', zoneId: 'BLD-DC', placement: 'inside' as const },
    { code: 'TR-01', zoneId: 'UTL-PLANT', placement: 'outdoor' as const },
  ];

  it('gives every asset its presence, by code', () => {
    expect(presenceMap(placed, { zoneId: 'BLD-DC', assetCode: null, inside: true })).toEqual(
      new Map([
        ['CT-01', 'drawn'],
        ['UPS-01', 'drawn'],
        ['TR-01', 'faded'],
      ]),
    );
    expect(presenceMap(placed, null)).toEqual(
      new Map([
        ['CT-01', 'drawn'],
        ['UPS-01', 'hidden'],
        ['TR-01', 'drawn'],
      ]),
    );
  });

  it('hides the building`s inside assets with Inside off and keeps the roof (V2-15.9)', () => {
    expect(presenceMap(placed, { zoneId: 'BLD-DC', assetCode: null, inside: false })).toEqual(
      new Map([
        ['CT-01', 'drawn'],
        ['UPS-01', 'hidden'],
        ['TR-01', 'faded'],
      ]),
    );
  });

  it('is an empty map for no assets', () => {
    expect(presenceMap([], null).size).toBe(0);
  });
});

describe('buildingLine (V2-15.8)', () => {
  it('says the walls are see-through and where Escape goes back to: always the campus', () => {
    expect(buildingLine()).toEqual({
      lead: 'Walls see-through, other buildings faded.',
      back: 'returns to Campus',
    });
  });
});
