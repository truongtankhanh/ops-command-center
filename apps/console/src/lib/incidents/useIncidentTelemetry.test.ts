import type { Asset, AssetDetail, Incident } from '@occ/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { queryKeys } from '../../api/queries';
import { getAccessToken, renewSession } from '../../auth/session';
import { createTestQueryClient, queryWrapper } from '../../test-utils';
import { type TelemetryTabState, useIncidentTelemetry } from './useIncidentTelemetry';

// The session module is tested on its own; here it only decides which token the client sends.
vi.mock('../../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const TOWER: Asset = {
  id: 'asset-1',
  code: 'CT-01',
  name: 'Cooling tower 1',
  class: {
    id: 'class-cooling-tower',
    code: 'cooling_tower',
    name: 'Cooling tower',
    modelUrl: null,
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  zoneId: 'z1',
  position: [108.44, 11.95],
  elevationM: 0,
  headingDeg: 0,
  headline: [],
};
const TOWER_DETAIL: AssetDetail = { ...TOWER, points: [], rules: [] };

const raised = (overrides: Partial<Pick<Incident, 'source' | 'assetId'>> = {}) => ({
  source: 'telemetry' as Incident['source'],
  assetId: TOWER.id as string | null,
  ...overrides,
});

/** The detail of a ready state, or a failure saying what it was instead. */
function detailOf(state: TelemetryTabState) {
  if (state.status !== 'ready') throw new Error(`Expected a ready tab, got ${state.status}`);
  return state.detail;
}

const fetchMock = vi.fn<typeof fetch>();
const requested = () => fetchMock.mock.calls.map(([url]) => String(url));

const answer = (status: number) =>
  Promise.resolve(new Response(JSON.stringify({ statusCode: status, message: 'x' }), { status }));

// The Telemetry tab exists only for an asset the catalogue has and whose detail can be read (V3-09.6).
describe('useIncidentTelemetry', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = createTestQueryClient();
    // Every request not answered from the cache never settles, unless a case says otherwise.
    fetchMock.mockReset().mockImplementation(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(getAccessToken).mockReset().mockResolvedValue(null);
    vi.mocked(renewSession).mockReset().mockResolvedValue(false);
  });

  afterEach(() => vi.unstubAllGlobals());

  /** Seeds what a case holds (`undefined` leaves the query unloaded), then renders the hook. */
  function renderTelemetry(
    subject: Pick<Incident, 'source' | 'assetId'> | undefined,
    cached: { assets?: Asset[]; detail?: AssetDetail } = {},
  ) {
    if (cached.assets) client.setQueryData(queryKeys.assets, cached.assets);
    if (cached.detail) client.setQueryData(queryKeys.asset(cached.detail.code), cached.detail);
    return renderHook(({ current }) => useIncidentTelemetry(current), {
      initialProps: { current: subject },
      wrapper: queryWrapper(client),
    });
  }

  it('is not offered without an incident', () => {
    const { result } = renderTelemetry(undefined, { assets: [TOWER], detail: TOWER_DETAIL });

    expect(result.current.status).toBe('none');
  });

  it.each(['operator', 'simulator'] as const)(
    'is not offered for an incident from %s',
    (source) => {
      const { result } = renderTelemetry(raised({ source }), {
        assets: [TOWER],
        detail: TOWER_DETAIL,
      });

      expect(result.current.status).toBe('none');
    },
  );

  it('is not offered for a telemetry incident without an asset', () => {
    const { result } = renderTelemetry(raised({ assetId: null }), { assets: [TOWER] });

    expect(result.current.status).toBe('none');
  });

  it('is not offered, and not loading, while the catalogue is on its way', () => {
    const { result } = renderTelemetry(raised(), { detail: TOWER_DETAIL });

    expect(result.current.status).toBe('none');
    expect(requested().filter((url) => url.includes('/assets/'))).toEqual([]);
  });

  it('is not offered for an asset the catalogue does not have', () => {
    const { result } = renderTelemetry(raised({ assetId: 'asset-gone' }), { assets: [TOWER] });

    expect(result.current.status).toBe('none');
  });

  it('is loading, and asks for the detail, while the asset is catalogued but not read', async () => {
    const { result } = renderTelemetry(raised(), { assets: [TOWER] });

    expect(result.current.status).toBe('loading');
    await waitFor(() =>
      expect(requested().filter((url) => url.includes('/assets/'))).toEqual([
        expect.stringContaining('/assets/CT-01'),
      ]),
    );
  });

  it('is ready with the asset detail once it is there', () => {
    const { result } = renderTelemetry(raised(), { assets: [TOWER], detail: TOWER_DETAIL });

    expect(detailOf(result.current)).toBe(TOWER_DETAIL);
  });

  it('goes from loading to ready when the detail arrives', async () => {
    const { result } = renderTelemetry(raised(), { assets: [TOWER] });
    expect(result.current.status).toBe('loading');

    act(() => client.setQueryData(queryKeys.asset('CT-01'), TOWER_DETAIL));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(detailOf(result.current)).toBe(TOWER_DETAIL);
  });

  it('is not offered when the asset is gone (404) and shows no error', async () => {
    fetchMock.mockImplementation(() => answer(404));
    const { result } = renderTelemetry(raised(), { assets: [TOWER] });

    await waitFor(() => expect(result.current.status).toBe('none'));
  });

  it('is not offered when the detail failed', async () => {
    fetchMock.mockImplementation(() => answer(500));
    const { result } = renderTelemetry(raised(), { assets: [TOWER] });

    await waitFor(() => expect(result.current.status).toBe('none'));
  });

  it('stays ready when a later refetch fails: the data is kept', async () => {
    const { result } = renderTelemetry(raised(), { assets: [TOWER], detail: TOWER_DETAIL });
    fetchMock.mockImplementation(() => answer(500));

    await act(() => client.invalidateQueries({ queryKey: queryKeys.asset('CT-01') }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(detailOf(result.current)).toBe(TOWER_DETAIL);
  });

  it('keeps the same state object across a re-render with unchanged queries', () => {
    const { result, rerender } = renderTelemetry(raised(), {
      assets: [TOWER],
      detail: TOWER_DETAIL,
    });
    const first = result.current;

    rerender({ current: raised() });

    expect(result.current).toBe(first);
  });
});
