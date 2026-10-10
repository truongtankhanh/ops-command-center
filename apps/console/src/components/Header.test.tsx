import type { Incident, IncidentSeverity, IncidentStatus } from '@occ/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from '../api/queries';
import { signOut } from '../auth/session';
import { useSession } from '../auth/store';
import type * as CriticalCue from '../lib/criticalCue';
import { playCriticalCue, unlockAudio } from '../lib/criticalCue';
import { useConsole } from '../store';
import { createTestQueryClient, renderWithQueryClient, resetStore } from '../test-utils';
import { Header } from './Header';

vi.mock('../auth/session', () => ({ signOut: vi.fn() }));
// jsdom has no Web Audio; the sound preference itself is stored by the real module.
vi.mock('../lib/criticalCue', async (importOriginal) => ({
  ...(await importOriginal<typeof CriticalCue>()),
  unlockAudio: vi.fn(),
  playCriticalCue: vi.fn(),
}));

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

  it('shows a technician by role and does not mark them as view only', () => {
    act(() =>
      useSession.getState().signedIn({ displayName: 'Demo Technician', roles: ['technician'] }),
    );

    expect(screen.getByText('Technician')).toBeInTheDocument();
    expect(screen.queryByText('View only')).toBeNull();
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

    it.each(['offline', 'reconnecting'] as const)(
      'says since when the link is down while %s, outside the status region',
      (connection) => {
        // A local time, so the text does not depend on the runner's timezone.
        const lostAt = new Date(2026, 9, 8, 15, 2).getTime();
        act(() => useConsole.setState({ connection, offlineSince: lostAt }));

        expect(screen.getByText('since 15:02')).toBeInTheDocument();
        expect(screen.getByRole('status')).not.toHaveTextContent(/since/);
      },
    );

    it('says nothing about since while live', () => {
      act(() => useConsole.setState({ connection: 'live', offlineSince: null }));

      expect(screen.queryByText(/since/)).toBeNull();
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

    it("shows a technician's role without the view-only note", async () => {
      act(() =>
        useSession.getState().signedIn({ displayName: 'Demo Technician', roles: ['technician'] }),
      );

      await userEvent.click(screen.getByRole('button', { name: /Demo Technician/ }));

      const menu = screen.getByRole('group', { name: 'Account' });
      expect(within(menu).getByText('Role: Technician')).toBeInTheDocument();
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
    it('does nothing on N for a viewer', async () => {
      act(() => useSession.getState().signedIn({ displayName: 'Demo Viewer', roles: ['viewer'] }));

      await userEvent.keyboard('n');

      expect(useConsole.getState().reporting).toBe(false);
    });

    it('opens the report form with N', async () => {
      await userEvent.keyboard('n');

      expect(useConsole.getState().reporting).toBe(true);
      expect(screen.getByRole('button', { name: 'Report incident' })).toHaveAttribute(
        'aria-keyshortcuts',
        'N',
      );
    });

    it('opens the report form with N while a note is being written, and keeps the note', async () => {
      act(() => useConsole.setState({ selectedIncidentId: 'a', noteDrafts: { a: 'Guard' } }));

      await userEvent.keyboard('n');

      // The note lives in the store, so leaving the incident for the form does not lose it.
      expect(useConsole.getState().reporting).toBe(true);
      expect(useConsole.getState().selectedIncidentId).toBeNull();
      expect(useConsole.getState().noteDrafts).toEqual({ a: 'Guard' });
    });

    it('ignores N for a viewer', async () => {
      act(() => useSession.getState().signedIn({ displayName: 'Demo Viewer', roles: ['viewer'] }));

      await userEvent.keyboard('n');

      expect(useConsole.getState().reporting).toBe(false);
    });
  });

  // Frame 06: the sound is off by default and turned on here, by every role.
  describe('sound for critical incidents', () => {
    const soundSwitch = () => screen.getByRole('switch', { name: 'Sound for critical incidents' });

    beforeEach(() => {
      localStorage.clear();
      vi.mocked(unlockAudio).mockReset().mockResolvedValue(true);
      vi.mocked(playCriticalCue).mockReset();
    });

    it('is off by default', async () => {
      await openAccountMenu();

      expect(soundSwitch()).toHaveAttribute('aria-checked', 'false');
    });

    it('turns on, unlocks audio with this click and plays the cue once', async () => {
      await openAccountMenu();

      await userEvent.click(soundSwitch());

      expect(soundSwitch()).toHaveAttribute('aria-checked', 'true');
      expect(useConsole.getState().criticalSound).toBe(true);
      expect(unlockAudio).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(playCriticalCue).toHaveBeenCalledWith({ preview: true }));
    });

    it('stays on without a preview when the browser blocks audio', async () => {
      vi.mocked(unlockAudio).mockResolvedValue(false);
      await openAccountMenu();

      await userEvent.click(soundSwitch());

      expect(soundSwitch()).toHaveAttribute('aria-checked', 'true');
      expect(unlockAudio).toHaveBeenCalledTimes(1);
      // Let the unlock settle and its `.then` run before asserting nothing was played.
      await vi.mocked(unlockAudio).mock.results[0]!.value;
      await act(async () => {});
      expect(playCriticalCue).not.toHaveBeenCalled();
    });

    it('turns off without touching audio', async () => {
      act(() => useConsole.setState({ criticalSound: true }));
      await openAccountMenu();

      await userEvent.click(soundSwitch());

      expect(soundSwitch()).toHaveAttribute('aria-checked', 'false');
      expect(useConsole.getState().criticalSound).toBe(false);
      expect(unlockAudio).not.toHaveBeenCalled();
    });

    it('is offered to a viewer too', async () => {
      act(() => useSession.getState().signedIn({ displayName: 'Demo Viewer', roles: ['viewer'] }));

      await userEvent.click(screen.getByRole('button', { name: /Demo Viewer/ }));

      expect(soundSwitch()).toBeInTheDocument();
    });
  });
  // WCAG 2.1.4: speech input can type a single-key shortcut by accident, so they can be turned off.
  describe('single-key shortcuts', () => {
    const shortcutsSwitch = () => screen.getByRole('switch', { name: 'Single-key shortcuts' });
    const helpEntry = () => screen.getByRole('button', { name: 'Keyboard shortcuts' });
    const reportButton = () => screen.getByRole('button', { name: 'Report incident' });

    beforeEach(() => localStorage.clear());

    it('are on by default', async () => {
      await openAccountMenu();

      expect(shortcutsSwitch()).toHaveAttribute('aria-checked', 'true');
    });

    it('turn off: Report shows no N and N does nothing', async () => {
      await openAccountMenu();

      await userEvent.click(shortcutsSwitch());
      expect(shortcutsSwitch()).toHaveAttribute('aria-checked', 'false');
      expect(useConsole.getState().keyboardShortcuts).toBe(false);
      await userEvent.keyboard('{Escape}');

      expect(reportButton()).not.toHaveAttribute('aria-keyshortcuts');
      await userEvent.keyboard('n');
      expect(useConsole.getState().reporting).toBe(false);
    });

    it('turn back on', async () => {
      await openAccountMenu();

      await userEvent.click(shortcutsSwitch());
      await userEvent.click(shortcutsSwitch());

      expect(shortcutsSwitch()).toHaveAttribute('aria-checked', 'true');
      expect(reportButton()).toHaveAttribute('aria-keyshortcuts', 'N');
    });

    it('open their help from the menu, which closes and gives focus back to its trigger', async () => {
      await openAccountMenu();

      await userEvent.click(helpEntry());

      expect(useConsole.getState().shortcutHelpOpen).toBe(true);
      expect(screen.queryByRole('group', { name: 'Account' })).toBeNull();
      expect(screen.getByRole('button', { name: /Demo Operator/ })).toHaveFocus();
    });

    it('show ? on the help entry only while they are on', async () => {
      await openAccountMenu();
      expect(helpEntry()).toHaveAttribute('aria-keyshortcuts', '?');

      await userEvent.click(shortcutsSwitch());

      expect(helpEntry()).not.toHaveAttribute('aria-keyshortcuts');
    });
  });

  describe('compact layout', () => {
    const compactSwitch = () => screen.getByRole('switch', { name: 'Compact layout' });

    beforeEach(() => localStorage.clear());

    it('is off by default', async () => {
      await openAccountMenu();

      expect(compactSwitch()).toHaveAttribute('aria-checked', 'false');
    });

    it('turns on, then off again', async () => {
      await openAccountMenu();

      await userEvent.click(compactSwitch());
      expect(compactSwitch()).toHaveAttribute('aria-checked', 'true');
      expect(useConsole.getState().density).toBe('compact');

      await userEvent.click(compactSwitch());
      expect(compactSwitch()).toHaveAttribute('aria-checked', 'false');
      expect(useConsole.getState().density).toBe('comfortable');
    });
  });
});
