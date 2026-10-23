import { type SelectionInput, selectionTargetOf } from './twinSelection';

const ASSETS = [
  { id: 'asset-1', code: 'CT-01' },
  { id: 'asset-2', code: 'GEN-01' },
];

const NOTHING: SelectionInput = {
  selectedPart: null,
  selectedAssetCode: null,
  selectedIncidentId: null,
  incident: undefined,
  assets: ASSETS,
};

const input = (changes: Partial<SelectionInput>): SelectionInput => ({ ...NOTHING, ...changes });

describe('selectionTargetOf', () => {
  it('is nothing when nothing is selected, so the key does nothing', () => {
    expect(selectionTargetOf(NOTHING)).toBeNull();
    expect(selectionTargetOf(input({ assets: undefined }))).toBeNull();
  });

  it('is the asset when an asset is selected', () => {
    expect(selectionTargetOf(input({ selectedAssetCode: 'CT-01' }))).toEqual({
      kind: 'asset',
      assetCode: 'CT-01',
    });
  });

  it('is the part when one of the asset is selected too', () => {
    expect(selectionTargetOf(input({ selectedAssetCode: 'CT-01', selectedPart: 'Fan' }))).toEqual({
      kind: 'part',
      assetCode: 'CT-01',
      part: 'Fan',
    });
  });

  it('does not make a selection of a part with no asset', () => {
    expect(selectionTargetOf(input({ selectedPart: 'Fan' }))).toBeNull();
  });

  it("is the incident's asset when the catalogue knows it", () => {
    expect(
      selectionTargetOf(
        input({ selectedIncidentId: 'incident-1', incident: { assetId: 'asset-2' } }),
      ),
    ).toEqual({ kind: 'incident-asset', assetCode: 'GEN-01' });
  });

  it.each([
    ['has no asset (a person or the simulator raised it)', { assetId: null }],
    ['has the field missing (an API before it)', {}],
    ['has an asset the catalogue lacks (deleted since)', { assetId: 'asset-9' }],
  ])('is the incident, for its beacon, when it %s', (_, incident) => {
    expect(selectionTargetOf(input({ selectedIncidentId: 'incident-1', incident }))).toEqual({
      kind: 'incident',
      incidentId: 'incident-1',
    });
  });

  it('is the incident while its detail or the catalogue is still on its way', () => {
    const waiting = { kind: 'incident', incidentId: 'incident-1' };

    expect(selectionTargetOf(input({ selectedIncidentId: 'incident-1' }))).toEqual(waiting);
    expect(
      selectionTargetOf(
        input({
          selectedIncidentId: 'incident-1',
          incident: { assetId: 'asset-1' },
          assets: undefined,
        }),
      ),
    ).toEqual(waiting);
  });

  it('puts a part before an asset before an incident, should the store ever allow two', () => {
    const both = input({
      selectedAssetCode: 'CT-01',
      selectedIncidentId: 'incident-1',
      incident: { assetId: 'asset-2' },
    });

    expect(selectionTargetOf(both)).toEqual({ kind: 'asset', assetCode: 'CT-01' });
    expect(selectionTargetOf({ ...both, selectedPart: 'Fan' })).toEqual({
      kind: 'part',
      assetCode: 'CT-01',
      part: 'Fan',
    });
  });
});
