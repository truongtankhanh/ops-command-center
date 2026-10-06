import type { Incident, IncidentSeverity, IncidentStatus } from '@occ/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from '../api/queries';
import { signOut } from '../auth/session';
import { useSession } from '../auth/store';
import { useConsole } from '../store';
import { createTestQueryClient, renderWithQueryClient, resetStore } from '../test-utils';
import { Header } from './Header';

vi.mock('../auth/session', () => ({ signOut: vi.fn() }));

/** Sign out sits in the account menu, opened from the trigger that shows the user's name. */
const openAccountMenu = () =>
  userEvent.click(screen.getByRole('button', { name: /Demo Operator/ }));

const incident = (id: string, severity: IncidentSeverity, status: IncidentStatus): Incident => ({
  id,
  code: 'INC-000001',
  type: 'intrusion',
  title: `Incident ${id}`,
  description: null,
  zoneId: 'z1',
  position: [0, 0],
  source: 'operator',
  reportedAt: new Date().toISOString(),
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  severity,
  status,
});

const tiles = () =>
  within(screen.getByRole('list', { name: /Active incidents by severity/ })).getAllByRole('button');

describe('Header', () => {
  let client: QueryClient;

  beforeEach(() => {
    resetStore(useSession);
    resetStore(useConsole);
    vi.mocked(signOut).mockReset();
    useSession.getState().signedIn({ displayName: 'Demo Operator', roles: ['operator'] });
    // useIncidents never goes stale, so a seeded list means no request. The pending fetch is a
    // guard: clearing the cache may refetch while the mocked signOut leaves the header mounted.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    client = createTestQueryClient();
    client.setQueryData(queryKeys.incidents, []);
    renderWithQueryClient(<Header />, client);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('shows who is signed in, with a way to sign out', async () => {
    expect(screen.getByText('Demo Operator')).toBeInTheDocument();

    await openAccountMenu();

    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('does not mark an operator as view only', () => {
    expect(screen.queryByText('View only')).toBeNull();
  });

  it('marks a viewer as view only', () => {
    act(() => useSession.getState().signedIn({ displayName: 'Demo Viewer', roles: ['viewer'] }));

    expect(screen.getByText('View only')).toBeInTheDocument();
    expect(screen.getByText('Demo Viewer')).toBeInTheDocument();
  });

  it('signs out and clears the cached data in one click', async () => {
    const clear = vi.spyOn(client, 'clear');

    await openAccountMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('starts signing out before it clears the cache', async () => {
    const clear = vi.spyOn(client, 'clear');

    await openAccountMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    // signOut() unmounts the console first, so nothing refetches into the emptied cache.
    expect(vi.mocked(signOut).mock.invocationCallOrder[0]).toBeLessThan(
      clear.mock.invocationCallOrder[0]!,
    );
  });

  // Moved from IncidentFeed.test.tsx with the Report button (UI-06).
  it('offers no report button to a viewer', () => {
    act(() => useSession.getState().signedIn({ displayName: 'Demo Viewer', roles: ['viewer'] }));

    expect(screen.queryByRole('button', { name: 'Report incident' })).toBeNull();
  });

  it('opens the report form from the header and clears the selection', async () => {
    act(() => useConsole.setState({ selectedIncidentId: 'a' }));

    await userEvent.click(screen.getByRole('button', { name: 'Report incident' }));

    expect(useConsole.getState().reporting).toBe(true);
    expect(useConsole.getState().selectedIncidentId).toBeNull();
  });

  // TanStack Query tells its observers about `setQueryData` on a `setTimeout(0)`, so after seeding
  // the tiles re-render asynchronously: each case waits for its first expected tile (`findBy*`).
  describe('KPI tiles', () => {
    const seed = (incidents: Incident[]) =>
      act(() => client.setQueryData(queryKeys.incidents, incidents));

    it('counts active incidents per severity, most severe first', async () => {
      seed([
        incident('h1', 'high', 'open'),
        incident('h2', 'high', 'acknowledged'),
        incident('l1', 'low', 'open'),
        incident('c1', 'critical', 'resolved'),
      ]);
      await screen.findByRole('button', { name: '2 High' });

      const [critical, high, medium, low] = tiles();
      expect(critical).toHaveAccessibleName('0 Critical');
      expect(high).toHaveAccessibleName('2 High');
      expect(medium).toHaveAccessibleName('0 Medium');
      expect(low).toHaveAccessibleName('1 Low');
    });

    it('filters the feed by a tile, and clears it on a second press', async () => {
      seed([incident('h1', 'high', 'open')]);
      act(() => useConsole.setState({ filter: 'resolved' }));
      const high = await screen.findByRole('button', { name: '1 High' });

      await userEvent.click(high);
      expect(high).toHaveAttribute('aria-pressed', 'true');
      expect(useConsole.getState().severity).toBe('high');
      // The tile counts active incidents, so the list it filters is the active one.
      expect(useConsole.getState().filter).toBe('active');

      await userEvent.click(high);
      expect(high).toHaveAttribute('aria-pressed', 'false');
      expect(useConsole.getState().severity).toBeNull();
    });

    it('escalates the critical tile only while a critical incident is active', async () => {
      seed([incident('c1', 'critical', 'open')]);
      expect(await screen.findByRole('button', { name: '1 Critical' })).toHaveAttribute(
        'data-hot',
        'true',
      );

      // A newer version, as resolving creates: the incident cache keeps the newer copy (IMP-05).
      seed([{ ...incident('c1', 'critical', 'resolved'), version: 2 }]);
      const critical = await screen.findByRole('button', { name: '0 Critical' });
      expect(critical).toHaveAttribute('data-hot', 'false');
      expect(critical).toHaveAttribute('data-zero', 'true');
    });
  });

  describe('connection', () => {
    it.each([
      ['connecting', 'Connecting…'],
      ['live', 'Live'],
      ['reconnecting', 'Reconnecting…'],
      ['offline', 'Offline'],
    ] as const)('names the %s state', (connection, label) => {
      act(() => useConsole.setState({ connection }));

      expect(screen.getByRole('status')).toHaveTextContent(label);
    });

    it('shows how long ago the live link last answered, outside the status region', () => {
      act(() => useConsole.setState({ connection: 'live', lastEventAt: Date.now() - 12_000 }));

      expect(screen.getByText('12s ago')).toBeInTheDocument();
      // The age ticks; announcing it would interrupt a screen reader every few seconds.
      expect(screen.getByRole('status')).not.toHaveTextContent(/ago/);

      act(() => useConsole.setState({ connection: 'offline' }));
      expect(screen.queryByText(/ago/)).toBeNull();
    });

    it('shows the time, the date and the UTC offset', () => {
      // Shape only: the test runner's timezone is not pinned.
      const time = screen.getByText(/^\d{2}:\d{2}$/);
      expect(Number.isNaN(Date.parse(time.closest('time')!.getAttribute('datetime')!))).toBe(false);
      expect(screen.getByText(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} · GMT/)).toBeInTheDocument();
    });
  });

  describe('account menu', () => {
    it('shows the account and the role in the menu', async () => {
      await openAccountMenu();

      const menu = screen.getByRole('group', { name: 'Account' });
      expect(within(menu).getByText('Role: Operator')).toBeInTheDocument();
      expect(within(menu).queryByText(/need the operator or supervisor role/)).toBeNull();
    });

    it('explains view-only access in the menu', async () => {
      act(() => useSession.getState().signedIn({ displayName: 'Demo Viewer', roles: ['viewer'] }));
      expect(screen.getByText('View only')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /Demo Viewer/ }));

      const menu = screen.getByRole('group', { name: 'Account' });
      expect(within(menu).getByText('Role: Viewer')).toBeInTheDocument();
      expect(within(menu).getByText(/need the operator or supervisor role/)).toBeInTheDocument();
    });

    it('lists every role of a user with several', async () => {
      act(() =>
        useSession
          .getState()
          .signedIn({ displayName: 'Demo Lead', roles: ['supervisor', 'operator'] }),
      );
      expect(screen.getByText('Operator · Supervisor')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /Demo Lead/ }));

      const menu = screen.getByRole('group', { name: 'Account' });
      expect(within(menu).getByText('Roles: Operator · Supervisor')).toBeInTheDocument();
    });

    it('closes on Escape and returns focus to its trigger', async () => {
      await openAccountMenu();

      await userEvent.keyboard('{Escape}');

      expect(screen.queryByRole('group', { name: 'Account' })).toBeNull();
      const trigger = screen.getByRole('button', { name: /Demo Operator/ });
      expect(trigger).toHaveFocus();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('report shortcut', () => {
    it('opens the report form with N', async () => {
      await userEvent.keyboard('n');

      expect(useConsole.getState().reporting).toBe(true);
      expect(screen.getByRole('button', { name: 'Report incident' })).toHaveAttribute(
        'aria-keyshortcuts',
        'N',
      );
    });

    it('ignores N while the open incident holds a note', async () => {
      act(() => useConsole.setState({ selectedIncidentId: 'a', noteDraft: true }));

      await userEvent.keyboard('n');

      // Opening the form would unmount the incident and throw the note away.
      expect(useConsole.getState().reporting).toBe(false);
      expect(useConsole.getState().selectedIncidentId).toBe('a');
    });

    it('ignores N for a viewer', async () => {
      act(() => useSession.getState().signedIn({ displayName: 'Demo Viewer', roles: ['viewer'] }));

      await userEvent.keyboard('n');

      expect(useConsole.getState().reporting).toBe(false);
    });
  });
});
