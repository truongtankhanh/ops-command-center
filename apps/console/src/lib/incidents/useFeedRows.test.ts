import type { Incident, Role, Zone } from '@occ/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { api } from '../../api/client';
import { queryKeys } from '../../api/queries';
import { useSession } from '../../auth/store';
import { useConsole } from '../../store';
import { createTestQueryClient, queryWrapper, resetStore } from '../../test-utils';
import { useFeedRows } from './useFeedRows';

// No token in these cases; the API client only asks for one.
vi.mock('../../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const zones: Zone[] = [
  { id: 'z1', code: 'BLD-LIB', name: 'Library', kind: 'building', polygon: [], center: [0, 0] },
  { id: 'z2', code: 'BLD-GYM', name: 'Gym', kind: 'building', polygon: [], center: [0, 0] },
];

const incident = (overrides: Partial<Incident> & Pick<Incident, 'id'>): Incident => ({
  code: `INC-${overrides.id}`,
  type: 'intrusion',
  severity: 'medium',
  status: 'open',
  title: 'Test',
  description: null,
  zoneId: 'z1',
  position: [0, 0],
  source: 'operator',
  reportedAt: new Date().toISOString(),
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

// In the cache's order, which is the feed's (`compareIncidents`); the hook keeps it.
const list: Incident[] = [
  incident({ id: 'a', title: 'Door forced open', severity: 'high' }),
  incident({ id: 'b', title: 'Pipe burst', type: 'water_leak', zoneId: 'z2' }),
  incident({ id: 'c', title: 'Queue at gate', status: 'acknowledged', severity: 'low' }),
  incident({ id: 'd', title: 'Smoke detector', type: 'fire_alarm', status: 'resolved' }),
];

const ids = (rows: readonly Incident[]) => rows.map((row) => row.id);

// The hook reads the store, the session's roles and two cached lists. A seeded list makes no request (`useIncidents` and
// `useZones` never go stale), so each case sets the store and the role, then reads what the hook derives.
describe('useFeedRows', () => {
  let client: QueryClient;

  beforeEach(() => {
    resetStore(useConsole);
    resetStore(useSession);
    signIn('operator');
    client = createTestQueryClient();
  });
  afterEach(() => vi.restoreAllMocks());

  function signIn(role: Role) {
    useSession.getState().signedIn({ displayName: 'Demo', roles: [role] });
  }

  function seeded() {
    client.setQueryData(queryKeys.incidents, list);
    client.setQueryData(queryKeys.zones, zones);
    return renderHook(() => useFeedRows(), { wrapper: queryWrapper(client) });
  }

  describe('before the list arrives', () => {
    it('is not loaded, lists nothing and draws the tabs without counts', () => {
      vi.spyOn(api, 'get').mockReturnValue(new Promise(() => undefined));
      const { result } = renderHook(() => useFeedRows(), { wrapper: queryWrapper(client) });

      expect(result.current.loaded).toBe(false);
      expect(result.current.isPending).toBe(true);
      expect(result.current.visible).toEqual([]);
      expect(result.current.matchStatus).toBe('');
      expect(result.current.zoneList).toBeUndefined();
      expect(result.current.tabs).toEqual([
        { value: 'active', label: 'Active' },
        { value: 'resolved', label: 'Resolved' },
        { value: 'all', label: 'All' },
      ]);
    });
  });

  describe('the tab', () => {
    it('lists the active incidents by default, in the cached order, with every tab counted', () => {
      const { result } = seeded();

      expect(result.current.loaded).toBe(true);
      expect(result.current.filter).toBe('active');
      expect(ids(result.current.visible)).toEqual(['a', 'b', 'c']);
      expect(result.current.tabs).toEqual([
        { value: 'active', label: 'Active', count: 3 },
        { value: 'resolved', label: 'Resolved', count: 1 },
        { value: 'all', label: 'All', count: 4 },
      ]);
    });

    it.each([
      ['resolved', ['d']],
      ['all', ['a', 'b', 'c', 'd']],
    ] as const)('lists the %s tab', (filter, expected) => {
      useConsole.setState({ filter });
      const { result } = seeded();

      expect(result.current.filter).toBe(filter);
      expect(ids(result.current.visible)).toEqual(expected);
    });

    it('shows Active when the stored tab is not offered to the role', () => {
      // "Mine to handle" is a technician's tab; an operator is not offered it.
      useConsole.setState({ filter: 'mine' });
      const { result } = seeded();

      expect(result.current.filter).toBe('active');
      expect(ids(result.current.visible)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('the role', () => {
    it('gives an operator no scope tag and no queue of their own', () => {
      const { result } = seeded();

      expect(result.current.tagged).toBe(false);
      expect(result.current.tabs.map((tab) => tab.value)).not.toContain('mine');
    });

    it('gives a technician the Mine to handle tab, which lists only the active incidents in their categories', () => {
      signIn('technician');
      useConsole.setState({ filter: 'mine' });
      const { result } = seeded();

      expect(result.current.tagged).toBe(true);
      expect(result.current.scope).toEqual(['facilities', 'environment']);
      expect(result.current.tabs.map((tab) => tab.value)).toEqual(['active', 'mine', 'all']);
      expect(result.current.filter).toBe('mine');
      // The water leak is Facilities; the intrusions are Security, the fire alarm is resolved.
      expect(ids(result.current.visible)).toEqual(['b']);
      expect(result.current.tabs.find((tab) => tab.value === 'mine')?.count).toBe(1);
    });

    it('shows a technician Active when the stored tab is Resolved, which they are not offered', () => {
      signIn('technician');
      useConsole.setState({ filter: 'resolved' });
      const { result } = seeded();

      expect(result.current.filter).toBe('active');
    });
  });

  describe('the filters that apply to every tab', () => {
    it('keeps only the chosen severity, and counts every tab with it', () => {
      useConsole.setState({ severity: 'high' });
      const { result } = seeded();

      expect(ids(result.current.visible)).toEqual(['a']);
      expect(result.current.tabs.map((tab) => tab.count)).toEqual([1, 0, 1]);
    });

    it('keeps only the chosen category', () => {
      useConsole.setState({ category: 'facilities' });
      const { result } = seeded();

      expect(ids(result.current.visible)).toEqual(['b']);
    });

    it('searches the title, the code and the zone name, folded', () => {
      useConsole.setState({ feedQuery: 'GYM' });
      const { result } = seeded();

      expect(result.current.terms).toEqual(['gym']);
      expect(ids(result.current.visible)).toEqual(['b']);
      expect(result.current.matchStatus).toBe('1 incident matches');
    });

    it('counts the matches in the plural', () => {
      useConsole.setState({ feedQuery: 'e' });
      const { result } = seeded();

      expect(ids(result.current.visible)).toEqual(['a', 'b', 'c']);
      expect(result.current.matchStatus).toBe('3 incidents match');
    });

    it('follows the store when the search text changes', () => {
      const { result } = seeded();

      act(() => useConsole.getState().setFeedQuery('queue'));

      expect(result.current.query).toBe('queue');
      expect(ids(result.current.visible)).toEqual(['c']);
    });
  });

  describe('nothing to list', () => {
    it('says why, naming the search', () => {
      useConsole.setState({ feedQuery: 'zzz' });
      const { result } = seeded();

      expect(result.current.visible).toEqual([]);
      expect(result.current.matchStatus).toBe('0 incidents match');
      expect(result.current.emptyMessage).toBe('No active incidents match "zzz".');
    });

    it('says why, naming the severity', () => {
      useConsole.setState({ severity: 'critical' });
      const { result } = seeded();

      expect(result.current.emptyMessage).toBe('No active critical incidents.');
    });
  });

  it('maps each loaded zone id to its name', () => {
    const { result } = seeded();

    expect(result.current.zoneList).toEqual(zones);
    expect(result.current.zoneName.get('z2')).toBe('Gym');
    expect(result.current.zoneName.get('unknown')).toBeUndefined();
  });
});
