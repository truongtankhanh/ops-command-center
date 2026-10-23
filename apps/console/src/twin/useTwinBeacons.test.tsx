import type { Incident } from '@occ/contracts';
import { renderHook } from '@testing-library/react';
import { queryKeys } from '../api/queries';
import { makeFrame } from '../lib/twin-core/twinScene';
import { useConsole } from '../store';
import { createTestQueryClient, queryWrapper, resetStore } from '../test-utils';
import { useTwinBeacons } from './useTwinBeacons';
import type { TwinScene } from './useTwinScene';

const incident = (id: string): Incident => ({
  id,
  code: `INC-${id}`,
  type: 'equipment_fault',
  severity: 'critical',
  status: 'open',
  title: id,
  description: null,
  zoneId: 'z1',
  position: [108.44, 11.95],
  source: 'telemetry',
  reportedAt: '2026-10-08T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
});

// The hook reads the scene's zones and frame only.
const SCENE = { zones: [], frame: makeFrame([108.4415, 11.953]) } as unknown as TwinScene;

function selectedBeacons() {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.incidents, [incident('a'), incident('b')]);
  client.setQueryData(queryKeys.assets, []);
  const { result } = renderHook(() => useTwinBeacons(SCENE), { wrapper: queryWrapper(client) });
  return result.current.filter((beacon) => beacon.selected).map((beacon) => beacon.id);
}

describe('useTwinBeacons: which beacon has the ring', () => {
  beforeEach(() => {
    resetStore(useConsole);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('is the selected incident on the console', () => {
    useConsole.setState({ selectedIncidentId: 'a', wallFocusId: 'b' });

    expect(selectedBeacons()).toEqual(['a']);
  });

  it('is the incident the camera is on, on a video wall, where nothing is ever selected (V2-21.8)', () => {
    useConsole.setState({ wall: 1, selectedIncidentId: 'a', wallFocusId: 'b' });

    expect(selectedBeacons()).toEqual(['b']);
  });

  it('is none on an idle wall', () => {
    useConsole.setState({ wall: 1 });

    expect(selectedBeacons()).toEqual([]);
  });
});
