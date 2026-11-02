import type { Asset, LngLat, Zone } from '@occ/contracts';
import { act, renderHook } from '@testing-library/react';
import { queryKeys } from '../../api/queries';
import { useConsole } from '../../store';
import { createTestQueryClient, queryWrapper, resetStore } from '../../test-utils';
import { offsetM } from '../map/geo';
import { useFocusableSelection } from './useFocusableSelection';

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

const asset = (code: string, overrides: Partial<Asset>): Asset =>
  ({
    id: `asset-${code}`,
    code,
    name: code,
    zoneId: BUILDING.id,
    position: CENTER,
    elevationM: 0,
    ...overrides,
  }) as Asset;

/** Stands inside the shell: drawn only while its building is in focus. */
const INSIDE = asset('UPS-01', {});
/** Stands 200 m away from the building: always drawn. */
const OUTDOOR = asset('GEN-01', { position: offsetM(CENTER, 200, 0) });

function renderFocusable() {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.assets, [INSIDE, OUTDOOR]);
  client.setQueryData(queryKeys.zones, [BUILDING]);
  return renderHook(() => useFocusableSelection(), { wrapper: queryWrapper(client) });
}

const select = (state: Partial<ReturnType<typeof useConsole.getState>>) =>
  act(() => useConsole.setState(state));

describe('useFocusableSelection', () => {
  beforeEach(() => resetStore(useConsole));

  it('is null with nothing selected', () => {
    select({ view: '3d' });

    expect(renderFocusable().result.current).toBeNull();
  });

  it('is null with an incident selected and no asset, whatever the incident points at', () => {
    select({ view: '3d', selectedIncidentId: 'incident-1' });

    expect(renderFocusable().result.current).toBeNull();
  });

  it('is null in the 2D view, where there is no camera to move', () => {
    select({ view: '2d', selectedAssetCode: OUTDOOR.code });

    expect(renderFocusable().result.current).toBeNull();
  });

  it('is null for an asset the catalogue does not hold', () => {
    select({ view: '3d', selectedAssetCode: 'NOPE-01' });

    expect(renderFocusable().result.current).toBeNull();
  });

  it('is the asset, with no part, for a selected asset the scene draws', () => {
    select({ view: '3d', selectedAssetCode: OUTDOOR.code });

    expect(renderFocusable().result.current).toEqual({ assetCode: 'GEN-01', part: null });
  });

  it('is the asset and its part when a part is selected', () => {
    select({ view: '3d', selectedAssetCode: OUTDOOR.code, selectedPart: 'Fan' });

    expect(renderFocusable().result.current).toEqual({ assetCode: 'GEN-01', part: 'Fan' });
  });

  it('is the asset inside a building while that building is in focus', () => {
    select({ view: '3d', selectedAssetCode: INSIDE.code, focusZoneId: BUILDING.id });

    expect(renderFocusable().result.current).toEqual({ assetCode: 'UPS-01', part: null });
  });

  it('is null for an inside asset whose building is not in focus: it is not drawn', () => {
    select({ view: '3d', selectedAssetCode: INSIDE.code, focusZoneId: null });

    expect(renderFocusable().result.current).toBeNull();
  });

  it('follows the selection as it changes', () => {
    select({ view: '3d', selectedAssetCode: OUTDOOR.code });
    const { result } = renderFocusable();
    expect(result.current).toEqual({ assetCode: 'GEN-01', part: null });

    select({ selectedPart: 'Fan' });
    expect(result.current).toEqual({ assetCode: 'GEN-01', part: 'Fan' });

    select({ selectedAssetCode: null, selectedPart: null });
    expect(result.current).toBeNull();
  });

  it('keeps the same object across re-renders while nothing it reads has changed', () => {
    select({ view: '3d', selectedAssetCode: OUTDOOR.code });
    const { result, rerender } = renderFocusable();
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });
});
