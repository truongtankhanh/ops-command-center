import type { Asset, IncidentDetail } from '@occ/contracts';
import { act, waitFor } from '@testing-library/react';
import { queryKeys } from '../api/queries';
import { useTelemetryWatch } from '../realtime/useTelemetry';
import { useConsole } from '../store';
import { createTestQueryClient, renderWithQueryClient, resetStore } from '../test-utils';
import { TelemetryWatchSet } from './TelemetryWatchSet';

// The hook's own debounce and client are covered in `useTelemetry.test.ts`: here only the set it is given.
vi.mock('../realtime/useTelemetry', () => ({ useTelemetryWatch: vi.fn() }));

const asset = (id: string, code: string) => ({ id, code }) as Asset;
const ASSETS = [asset('asset-ct-01', 'CT-01'), asset('asset-lks-b3', 'LKS-B3')];

const incident = (overrides: Partial<IncidentDetail> = {}): IncidentDetail => ({
  id: 'incident-1',
  code: 'INC-000107',
  type: 'equipment_fault',
  severity: 'critical',
  status: 'open',
  title: 'Motor over-temperature — Cooling tower 1',
  description: null,
  zoneId: 'zone-dc',
  position: [108.44, 11.95],
  source: 'telemetry',
  assetId: 'asset-ct-01',
  reportedAt: '2026-10-16T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  timeline: [],
  ...overrides,
});

/** The set the hook was last given. */
const lastSet = (): readonly string[] | undefined =>
  vi.mocked(useTelemetryWatch).mock.lastCall?.[0];

function renderSet(cached: IncidentDetail[] = [incident()]) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.assets, ASSETS);
  for (const detail of cached) client.setQueryData(queryKeys.incident(detail.id), detail);
  return renderWithQueryClient(<TelemetryWatchSet />, client);
}

describe('TelemetryWatchSet', () => {
  beforeEach(() => {
    resetStore(useConsole);
    vi.mocked(useTelemetryWatch).mockReset();
    // A cached detail is stale at once: an unanswered request leaves it on screen.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('watches nothing while nothing is open', () => {
    renderSet();

    expect(lastSet()).toEqual([]);
  });

  it('watches the asset of the open telemetry incident', () => {
    useConsole.setState({ selectedIncidentId: 'incident-1' });

    renderSet();

    expect(lastSet()).toEqual(['CT-01']);
  });

  describe('on a video wall (V2-21.8)', () => {
    it('watches nothing while the wall is idle, whatever else is set', () => {
      useConsole.setState({ wall: 1, selectedIncidentId: 'incident-1' });

      renderSet();

      expect(lastSet()).toEqual([]);
    });

    it('watches the asset of the incident the camera is on', () => {
      useConsole.setState({ wall: 1, wallFocusId: 'incident-1' });

      renderSet();

      expect(lastSet()).toEqual(['CT-01']);
    });

    it('stops watching when the camera goes home', () => {
      useConsole.setState({ wall: 1, wallFocusId: 'incident-1' });
      renderSet();
      expect(lastSet()).toEqual(['CT-01']);

      act(() => useConsole.setState({ wallFocusId: null }));

      expect(lastSet()).toEqual([]);
    });
  });

  it('watches the inspected asset alone', () => {
    useConsole.setState({ selectedAssetCode: 'LKS-B3' });

    renderSet();

    expect(lastSet()).toEqual(['LKS-B3']);
  });

  it('puts the inspected asset first when both are set', () => {
    // The store keeps the two sheets exclusive today, so this only sets both on purpose (V2-11.2, AC5).
    useConsole.setState({ selectedIncidentId: 'incident-1', selectedAssetCode: 'LKS-B3' });

    renderSet();

    expect(lastSet()).toEqual(['LKS-B3', 'CT-01']);
  });

  it('watches an asset once when it is both inspected and the incident’s', () => {
    // The limit of four is for distinct assets: the 3D view adds none (V2-14.11, `twinPath.test.ts`).
    useConsole.setState({ selectedIncidentId: 'incident-1', selectedAssetCode: 'CT-01' });

    renderSet();

    expect(lastSet()).toEqual(['CT-01']);
  });

  it('stops watching the incident once it is resolved', async () => {
    useConsole.setState({ selectedIncidentId: 'incident-1' });
    const { client } = renderSet();
    expect(lastSet()).toEqual(['CT-01']);

    act(() => {
      client.setQueryData(
        queryKeys.incident('incident-1'),
        incident({ status: 'resolved', resolvedAt: '2026-10-16T08:10:00.000Z', version: 2 }),
      );
    });

    // TanStack Query tells its observers on a timer, so the re-render is not in the same tick.
    await waitFor(() => expect(lastSet()).toEqual([]));
  });

  it('adds nothing for an incident a person reported', () => {
    useConsole.setState({ selectedIncidentId: 'incident-1' });

    renderSet([incident({ source: 'operator', assetId: null })]);

    expect(lastSet()).toEqual([]);
  });

  it('adds nothing while the incident is still loading', () => {
    useConsole.setState({ selectedIncidentId: 'incident-1' });

    renderSet([]);

    expect(lastSet()).toEqual([]);
  });
});
