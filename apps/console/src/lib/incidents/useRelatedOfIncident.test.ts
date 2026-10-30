import type { Asset, Camera, Incident } from '@occ/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { queryKeys } from '../../api/queries';
import { getAccessToken, renewSession } from '../../auth/session';
import { createTestQueryClient, queryWrapper } from '../../test-utils';
import { type RelatedState, useRelatedOfIncident } from './useRelatedOfIncident';

// The session module is tested on its own; here it only decides which token the client sends.
vi.mock('../../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const incident = (id: string, overrides: Partial<Incident> = {}): Incident => ({
  id,
  code: `INC-${id}`,
  type: 'equipment_fault',
  severity: 'high',
  status: 'open',
  title: `Incident ${id}`,
  description: null,
  zoneId: 'z1',
  position: [108.44, 11.95],
  source: 'operator',
  assetId: null,
  reportedAt: '2026-10-15T07:50:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

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

const camera = (code: string, zoneId: string): Camera => ({
  id: code,
  code,
  name: code,
  zoneId,
  position: [0, 0],
  online: true,
  fieldOfView: null,
});

/** An operator's incident, and one raised by a rule on the tower: only the second needs the catalogue. */
const OPERATOR = incident('self');
const TELEMETRY = incident('self', { source: 'telemetry', assetId: TOWER.id });

/** The related list of a state that is `ready`, or a failure saying what it was instead. */
function relatedOf(state: RelatedState) {
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

// The Related tab's count is a fact only when every list it is made from has arrived (V3-09.5).
describe('useRelatedOfIncident', () => {
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
    subject: Incident | undefined,
    lists: { incidents?: Incident[]; assets?: Asset[]; cameras?: Camera[] } = {},
  ) {
    if (lists.incidents) client.setQueryData(queryKeys.incidents, lists.incidents);
    if (lists.assets) client.setQueryData(queryKeys.assets, lists.assets);
    if (lists.cameras) client.setQueryData(queryKeys.cameras, lists.cameras);
    return renderHook(({ current }) => useRelatedOfIncident(current), {
      initialProps: { current: subject },
      wrapper: queryWrapper(client),
    });
  }

  it('is loading without an incident', () => {
    const { result } = renderRelated(undefined, { incidents: [], assets: [], cameras: [] });

    expect(result.current.status).toBe('loading');
  });

  it('lists the incidents, the device and the cameras once everything has loaded', () => {
    const { result } = renderRelated(TELEMETRY, {
      incidents: [
        TELEMETRY,
        incident('other'),
        incident('resolved', { status: 'resolved' }),
        incident('elsewhere', { zoneId: 'z2' }),
      ],
      assets: [TOWER],
      cameras: [camera('CAM-1', 'z1'), camera('CAM-2', 'z2')],
    });

    const related = relatedOf(result.current);
    expect(related.incidents.map((item) => item.id)).toEqual(['other']);
    expect(related.device?.code).toBe('CT-01');
    expect(related.cameras.map((item) => item.code)).toEqual(['CAM-1']);
    // The badge: the incident, the device and the camera.
    expect(related.count).toBe(3);
  });

  it('is ready with a count of 0 when nothing else is related', () => {
    const { result } = renderRelated(OPERATOR, { incidents: [OPERATOR], assets: [], cameras: [] });

    expect(relatedOf(result.current).count).toBe(0);
  });

  it('is loading, never an empty list, while the incident list has not arrived', () => {
    const { result } = renderRelated(OPERATOR, { assets: [], cameras: [camera('CAM-1', 'z1')] });

    expect(result.current.status).toBe('loading');
  });

  it('is loading while the cameras have not arrived', () => {
    const { result } = renderRelated(OPERATOR, { incidents: [OPERATOR], assets: [] });

    expect(result.current.status).toBe('loading');
  });

  describe('the catalogue', () => {
    it('is waited for by an incident that has a device', async () => {
      const { result } = renderRelated(TELEMETRY, { incidents: [TELEMETRY], cameras: [] });
      expect(result.current.status).toBe('loading');

      act(() => client.setQueryData(queryKeys.assets, [TOWER]));

      // The cache tells its observers on a timer, so the hook re-renders after `act` returns.
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(relatedOf(result.current).device?.code).toBe('CT-01');
    });

    it('is not waited for by an operator’s incident, which has no device to find', () => {
      const { result } = renderRelated(OPERATOR, { incidents: [OPERATOR], cameras: [] });

      expect(relatedOf(result.current)).toMatchObject({ device: null, count: 0 });
    });
  });

  describe('a list that cannot be loaded', () => {
    it('is failed, not empty, when the cameras fail', async () => {
      failRequests();
      const { result } = renderRelated(OPERATOR, { incidents: [OPERATOR], assets: [] });

      await waitFor(() => expect(result.current.status).toBe('failed'));
    });

    it('is failed for an incident with a device when the catalogue fails', async () => {
      failRequests();
      const { result } = renderRelated(TELEMETRY, { incidents: [TELEMETRY], cameras: [] });

      await waitFor(() => expect(result.current.status).toBe('failed'));
    });

    it('leaves an operator’s incident ready when only the catalogue fails', async () => {
      failRequests();
      const { result } = renderRelated(OPERATOR, { incidents: [OPERATOR], cameras: [] });
      await waitFor(() => expect(client.getQueryState(queryKeys.assets)?.status).toBe('error'));

      expect(relatedOf(result.current).count).toBe(0);
    });
  });

  describe('identity', () => {
    it('keeps the same list while nothing it is made from changes', () => {
      const { result, rerender } = renderRelated(OPERATOR, {
        incidents: [OPERATOR, incident('other')],
        assets: [],
        cameras: [],
      });
      const first = result.current;

      // The incident's own detail refetches: a new object, the same id, zone and asset.
      rerender({ current: { ...OPERATOR, title: 'Retitled' } });

      expect(result.current).toBe(first);
    });

    it('follows a live change to the list', async () => {
      const { result } = renderRelated(OPERATOR, {
        incidents: [OPERATOR, incident('other')],
        assets: [],
        cameras: [],
      });
      expect(relatedOf(result.current).count).toBe(1);

      // A newer version is what the cache keeps (`mergeIncidentLists`).
      act(() =>
        client.setQueryData(queryKeys.incidents, [
          OPERATOR,
          incident('other', { status: 'resolved', version: 2 }),
        ]),
      );

      await waitFor(() => expect(relatedOf(result.current).count).toBe(0));
    });
  });
});
