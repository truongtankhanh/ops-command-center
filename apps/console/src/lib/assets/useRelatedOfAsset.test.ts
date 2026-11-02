import type { Asset, Camera, Incident, LngLat } from '@occ/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { queryKeys } from '../../api/queries';
import { getAccessToken, renewSession } from '../../auth/session';
import { createTestQueryClient, queryWrapper } from '../../test-utils';
import { offsetM } from '../map/geo';
import { type AssetRelatedState, useRelatedOfAsset } from './useRelatedOfAsset';

// The session module is tested on its own; here it only decides which token the client sends.
vi.mock('../../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const POSITION: LngLat = [108.44, 11.95];

const asset = (id: string, overrides: Partial<Asset> = {}): Asset => ({
  id,
  code: id.toUpperCase(),
  name: `Asset ${id}`,
  class: {
    id: 'class-cooling-tower',
    code: 'cooling_tower',
    name: 'Cooling tower',
    modelUrl: null,
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  zoneId: 'z1',
  position: POSITION,
  elevationM: 0,
  headingDeg: 0,
  headline: [],
  ...overrides,
});

const incident = (id: string, overrides: Partial<Incident> = {}): Incident => ({
  id,
  code: `INC-${id}`,
  type: 'equipment_fault',
  severity: 'high',
  status: 'open',
  title: `Incident ${id}`,
  description: null,
  zoneId: 'z1',
  position: POSITION,
  source: 'telemetry',
  assetId: null,
  reportedAt: '2026-10-15T07:50:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

/** Sees nothing: no field of view, far from the asset. */
const blind = (code: string): Camera => ({
  id: code,
  code,
  name: code,
  zoneId: 'z1',
  position: [0, 0],
  online: true,
  fieldOfView: null,
});

/** 20 m south of the asset and facing north: the asset is in its 90°, 50 m sector. */
const seeing = (code: string): Camera => ({
  ...blind(code),
  position: offsetM(POSITION, 0, -20),
  fieldOfView: { heading: 0, angle: 90, range: 50 },
});

const SELF = asset('self');

/** The related list of a state that is `ready`, or a failure saying what it was instead. */
function relatedOf(state: AssetRelatedState) {
  if (state.status !== 'ready') throw new Error(`Expected a ready list, got ${state.status}`);
  return state.related;
}

/** Every request not answered from the cache: never settles, or fails with `status`. */
const hangRequests = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {})),
  );
const failRequests = (status = 500) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ statusCode: status, message: 'x' }), { status }),
      ),
    ),
  );

// The Related tab's count is a fact only when every list it is made from has arrived (V3-09.8).
describe('useRelatedOfAsset', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = createTestQueryClient();
    vi.mocked(getAccessToken).mockReset().mockResolvedValue(null);
    vi.mocked(renewSession).mockReset().mockResolvedValue(false);
    hangRequests();
  });

  afterEach(() => vi.unstubAllGlobals());

  /** Seeds what a case holds (`undefined` leaves a list unloaded), then renders the hook. */
  function renderRelated(
    subject: Asset | undefined,
    lists: { incidents?: Incident[]; assets?: Asset[]; cameras?: Camera[] } = {},
  ) {
    if (lists.incidents) client.setQueryData(queryKeys.incidents, lists.incidents);
    if (lists.assets) client.setQueryData(queryKeys.assets, lists.assets);
    if (lists.cameras) client.setQueryData(queryKeys.cameras, lists.cameras);
    return renderHook(({ current }) => useRelatedOfAsset(current), {
      initialProps: { current: subject },
      wrapper: queryWrapper(client),
    });
  }

  it('is loading without an asset', () => {
    const { result } = renderRelated(undefined, { incidents: [], assets: [], cameras: [] });

    expect(result.current.status).toBe('loading');
  });

  it('lists the incidents, the cameras and the assets beside it once everything has loaded', () => {
    const { result } = renderRelated(SELF, {
      incidents: [
        incident('own', { assetId: SELF.id }),
        incident('resolved', { assetId: SELF.id, status: 'resolved' }),
        incident('beside', { assetId: 'other' }),
      ],
      assets: [SELF, asset('other'), asset('far', { zoneId: 'z2' })],
      cameras: [seeing('CAM-1'), blind('CAM-2')],
    });

    const related = relatedOf(result.current);
    expect(related.incidents.map((item) => item.id)).toEqual(['own']);
    expect(related.cameras.map((item) => item.code)).toEqual(['CAM-1']);
    expect(related.assets.map((item) => item.id)).toEqual(['other']);
    // The badge: the incident, the camera and the sibling.
    expect(related.count).toBe(3);
  });

  it('is ready with a count of 0 when nothing is related', () => {
    const { result } = renderRelated(SELF, { incidents: [], assets: [SELF], cameras: [] });

    expect(relatedOf(result.current).count).toBe(0);
  });

  it.each([
    ['incidents', { assets: [SELF], cameras: [] }],
    ['the catalogue', { incidents: [], cameras: [] }],
    ['cameras', { incidents: [], assets: [SELF] }],
  ])('is loading, never an empty list, while %s have not arrived', (_name, lists) => {
    const { result } = renderRelated(SELF, lists);

    expect(result.current.status).toBe('loading');
  });

  it('waits for the catalogue and then lists the siblings', async () => {
    const { result } = renderRelated(SELF, { incidents: [], cameras: [] });
    expect(result.current.status).toBe('loading');

    act(() => client.setQueryData(queryKeys.assets, [SELF, asset('other')]));

    // The cache tells its observers on a timer, so the hook re-renders after `act` returns.
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(relatedOf(result.current).assets.map((item) => item.id)).toEqual(['other']);
  });

  describe('a list that cannot be loaded', () => {
    it('is failed, not empty, when the cameras fail', async () => {
      failRequests();
      const { result } = renderRelated(SELF, { incidents: [], assets: [SELF] });

      await waitFor(() => expect(result.current.status).toBe('failed'));
    });

    it('is failed, not empty, when the catalogue fails', async () => {
      failRequests();
      const { result } = renderRelated(SELF, { incidents: [], cameras: [] });

      await waitFor(() => expect(result.current.status).toBe('failed'));
    });

    it('is failed, not empty, when the incident list fails', async () => {
      failRequests();
      const { result } = renderRelated(SELF, { assets: [SELF], cameras: [] });

      await waitFor(() => expect(result.current.status).toBe('failed'));
    });

    it('stays ready when a refetch fails after a first load', async () => {
      const { result } = renderRelated(SELF, {
        incidents: [],
        assets: [SELF, asset('other')],
        cameras: [],
      });
      failRequests();

      await act(() => client.refetchQueries({ queryKey: queryKeys.assets }));

      expect(client.getQueryState(queryKeys.assets)?.status).toBe('error');
      expect(relatedOf(result.current).assets).toHaveLength(1);
    });
  });

  describe('identity', () => {
    it('keeps the same list while nothing it is made from changes', () => {
      const { result, rerender } = renderRelated(SELF, {
        incidents: [],
        assets: [SELF, asset('other')],
        cameras: [],
      });
      const first = result.current;

      // The asset's own detail refetches: a new object, the same id, zone and position.
      rerender({ current: { ...SELF, name: 'Renamed' } });

      expect(result.current).toBe(first);
    });

    it('follows a live change to the list', async () => {
      const raised = incident('own', { assetId: SELF.id });
      const { result } = renderRelated(SELF, {
        incidents: [raised],
        assets: [SELF],
        cameras: [],
      });
      expect(relatedOf(result.current).count).toBe(1);

      // A newer version is what the cache keeps (`mergeIncidentLists`).
      act(() =>
        client.setQueryData(queryKeys.incidents, [
          { ...raised, status: 'resolved', version: 2 } satisfies Incident,
        ]),
      );

      await waitFor(() => expect(relatedOf(result.current).count).toBe(0));
    });
  });
});
