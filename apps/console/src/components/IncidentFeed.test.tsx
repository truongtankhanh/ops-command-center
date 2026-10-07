import type { Incident, Zone } from '@occ/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from '../api/queries';
import { useSession } from '../auth/store';
import { useConsole } from '../store';
import { resetStore } from '../test-utils';
import { IncidentFeed } from './IncidentFeed';

const zone: Zone = {
  id: 'z1',
  code: 'BLD-LIB',
  name: 'Library',
  kind: 'building',
  polygon: [],
  center: [0, 0],
};

const base: Omit<Incident, 'id' | 'title' | 'status' | 'severity'> = {
  code: 'INC-000001',
  type: 'intrusion',
  description: null,
  zoneId: 'z1',
  position: [0, 0],
  source: 'operator',
  reportedAt: new Date().toISOString(),
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
};

const incidents: Incident[] = [
  { ...base, id: 'a', title: 'Door forced open', status: 'open', severity: 'high' },
  { ...base, id: 'b', title: 'Queue at gate', status: 'acknowledged', severity: 'low' },
  { ...base, id: 'c', title: 'Smoke detector', status: 'resolved', severity: 'critical' },
];

function renderFeed(list: Incident[] = incidents) {
  const client = new QueryClient();
  client.setQueryData(queryKeys.incidents, list);
  client.setQueryData(queryKeys.zones, [zone]);
  return render(
    <QueryClientProvider client={client}>
      <IncidentFeed />
    </QueryClientProvider>,
  );
}

describe('IncidentFeed', () => {
  beforeEach(() => {
    useConsole.setState({
      filter: 'active',
      severity: null,
      selectedIncidentId: null,
      reporting: false,
      fresh: new Set(),
    });
    // A signed-in role, as in the console. The feed holds no actions (Report is in the header).
    resetStore(useSession);
    useSession.getState().signedIn({ displayName: 'Demo Operator', roles: ['operator'] });
  });

  it('shows only active incidents by default, with zone and status', () => {
    renderFeed();

    expect(screen.getByText('Door forced open')).toBeInTheDocument();
    expect(screen.getByText('Being handled')).toBeInTheDocument();
    expect(screen.queryByText('Smoke detector')).not.toBeInTheDocument();
    expect(screen.getAllByText('Library')).toHaveLength(2);
  });

  it('shows a viewer the same incidents and filters', () => {
    useSession.getState().signedIn({ displayName: 'Demo Viewer', roles: ['viewer'] });

    renderFeed();

    expect(screen.getByText('Door forced open')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Resolved/ })).toBeInTheDocument();
  });

  it('switches to resolved incidents', async () => {
    renderFeed();
    await userEvent.click(screen.getByRole('tab', { name: /^Resolved/ }));

    expect(screen.getByText('Smoke detector')).toBeInTheDocument();
    expect(screen.queryByText('Door forced open')).not.toBeInTheDocument();
  });

  it('selects an incident on click and deselects on a second click', async () => {
    renderFeed();
    const row = screen.getByRole('button', { name: /Door forced open/ });

    await userEvent.click(row);
    expect(useConsole.getState().selectedIncidentId).toBe('a');
    expect(row).toHaveAttribute('aria-current', 'true');

    await userEvent.click(row);
    expect(useConsole.getState().selectedIncidentId).toBeNull();
  });

  // The severity filter is set from the header's KPI tiles; the feed shows and clears it.
  describe('severity filter', () => {
    it('lists only the selected severity and shows it as a chip', () => {
      useConsole.setState({ severity: 'high' });

      renderFeed();

      expect(screen.getByText('Door forced open')).toBeInTheDocument();
      expect(screen.queryByText('Queue at gate')).not.toBeInTheDocument();
      expect(screen.getByText('High only')).toBeInTheDocument();
    });

    it('clears the severity filter from the chip and keeps focus in the feed', async () => {
      useConsole.setState({ severity: 'high' });
      renderFeed();

      await userEvent.click(screen.getByRole('button', { name: 'Clear severity filter' }));

      expect(useConsole.getState().severity).toBeNull();
      expect(screen.queryByText('High only')).not.toBeInTheDocument();
      expect(screen.getByText('Queue at gate')).toBeInTheDocument();
      // The chip and its button are gone; focus lands on the selected tab, not on the page.
      expect(screen.getByRole('tab', { name: /^Active/ })).toHaveFocus();
    });

    it('keeps the severity filter when switching tab', async () => {
      useConsole.setState({ severity: 'critical' });
      renderFeed();

      await userEvent.click(screen.getByRole('tab', { name: /^Resolved/ }));

      expect(screen.getByText('Smoke detector')).toBeInTheDocument();
      expect(screen.getByText('Critical only')).toBeInTheDocument();
    });

    it('says which severity has nothing to show', () => {
      useConsole.setState({ severity: 'medium' });

      renderFeed();

      expect(screen.getByText('No active medium incidents.')).toBeInTheDocument();
      expect(screen.getByText('Medium only')).toBeInTheDocument();
    });

    it('shows no chip without a severity filter', () => {
      renderFeed();

      expect(screen.queryByRole('button', { name: 'Clear severity filter' })).toBeNull();
    });
  });

  const row = (name: RegExp) => screen.getByRole('button', { name });
  const searchbox = () => screen.getByRole('searchbox', { name: 'Search incidents' });

  describe('rows', () => {
    it('names each row by severity, type and title', () => {
      renderFeed();

      expect(row(/High severity,\s*Intrusion:\s*Door forced open/)).toBeInTheDocument();
      expect(screen.getAllByText('INC-000001')).toHaveLength(2);
    });

    it('flags an open incident past its attention threshold, not an acknowledged one', () => {
      // Ten minutes is past the high threshold (5 min) and far from it, so the real clock will do.
      const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
      const late = { ...base, severity: 'high', reportedAt: tenMinutesAgo } as const;
      renderFeed([
        { ...late, id: 'lo', title: 'Late open', status: 'open' },
        { ...late, id: 'la', title: 'Late acked', status: 'acknowledged' },
      ]);

      const open = row(/Late open/);
      expect(open.querySelector('time')).toHaveAttribute('data-late', 'true');
      expect(within(open).getByText(/past attention time/)).toBeInTheDocument();

      const acked = row(/Late acked/);
      expect(acked.querySelector('time')).toHaveAttribute('data-late', 'false');
      expect(within(acked).queryByText(/past attention time/)).toBeNull();
    });

    it('marks a live arrival', () => {
      useConsole.setState({ fresh: new Set(['a']) });

      renderFeed();

      expect(row(/Door forced open/)).toHaveAttribute('data-fresh', 'true');
      expect(row(/Queue at gate/)).toHaveAttribute('data-fresh', 'false');
    });
  });

  describe('tab counts', () => {
    it('counts each tab', () => {
      renderFeed();

      expect(screen.getByRole('tab', { name: 'Active 2' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Resolved 1' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'All 3' })).toBeInTheDocument();
    });

    it('counts the tabs with the severity filter and the search', async () => {
      useConsole.setState({ severity: 'high' });
      renderFeed();

      expect(screen.getByRole('tab', { name: 'Active 1' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Resolved 0' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'All 1' })).toBeInTheDocument();

      act(() => useConsole.setState({ severity: null }));
      await userEvent.type(searchbox(), 'smoke');

      expect(screen.getByRole('tab', { name: 'Active 0' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Resolved 1' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'All 1' })).toBeInTheDocument();
    });
  });

  describe('search', () => {
    it('searches code, title and zone', async () => {
      renderFeed();

      await userEvent.type(searchbox(), 'door');

      expect(screen.getByText('Door forced open')).toBeInTheDocument();
      expect(screen.queryByText('Queue at gate')).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('1 incident matches');

      await userEvent.clear(searchbox());
      await userEvent.type(searchbox(), 'gate');

      expect(screen.getByText('Queue at gate')).toBeInTheDocument();
      expect(screen.queryByText('Door forced open')).not.toBeInTheDocument();
    });

    it('says when nothing matches, and clears back to the list', async () => {
      renderFeed();

      await userEvent.type(searchbox(), 'zzz');

      expect(screen.getByText('No active incidents match "zzz".')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('0 incidents match');

      await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));

      expect(screen.getByText('Door forced open')).toBeInTheDocument();
      expect(screen.getByText('Queue at gate')).toBeInTheDocument();
      expect(screen.getByRole('status').textContent).toBe('');
      expect(searchbox()).toHaveFocus();
      expect(searchbox()).toHaveValue('');
    });

    it('focuses the search with /', async () => {
      renderFeed();

      await userEvent.keyboard('/');

      expect(searchbox()).toHaveFocus();
      // The shortcut is handled, not typed.
      expect(searchbox()).toHaveValue('');
    });

    it('clears the search with Escape and stops it there', async () => {
      // Stands in for any page-level Escape handler.
      const onKey = vi.fn<(event: KeyboardEvent) => void>();
      const escapes = () => onKey.mock.calls.filter(([event]) => event.key === 'Escape').length;
      window.addEventListener('keydown', onKey);
      try {
        renderFeed();
        await userEvent.type(searchbox(), 'door');

        await userEvent.keyboard('{Escape}');
        expect(searchbox()).toHaveValue('');
        expect(escapes()).toBe(0);

        // On an empty box Escape is not the search's: it reaches the window as before.
        await userEvent.keyboard('{Escape}');
        expect(escapes()).toBe(1);
      } finally {
        window.removeEventListener('keydown', onKey);
      }
    });
  });

  describe('keyboard', () => {
    it('is a single Tab stop', () => {
      const { unmount } = renderFeed();
      expect(row(/Door forced open/)).toHaveAttribute('tabindex', '0');
      expect(row(/Queue at gate/)).toHaveAttribute('tabindex', '-1');
      unmount();

      useConsole.setState({ selectedIncidentId: 'b' });
      renderFeed();

      expect(row(/Door forced open/)).toHaveAttribute('tabindex', '-1');
      expect(row(/Queue at gate/)).toHaveAttribute('tabindex', '0');
    });

    it('moves focus with the arrow keys without selecting', async () => {
      renderFeed();
      act(() => row(/Door forced open/).focus());

      await userEvent.keyboard('{ArrowDown}');
      expect(row(/Queue at gate/)).toHaveFocus();
      expect(row(/Queue at gate/)).toHaveAttribute('tabindex', '0');

      // A list does not wrap.
      await userEvent.keyboard('{ArrowDown}');
      expect(row(/Queue at gate/)).toHaveFocus();

      await userEvent.keyboard('{Home}');
      expect(row(/Door forced open/)).toHaveFocus();
      await userEvent.keyboard('{End}');
      expect(row(/Queue at gate/)).toHaveFocus();
      await userEvent.keyboard('{ArrowUp}');
      expect(row(/Door forced open/)).toHaveFocus();

      expect(useConsole.getState().selectedIncidentId).toBeNull();
    });

    it('opens the focused row with Enter', async () => {
      renderFeed();
      act(() => row(/Door forced open/).focus());

      await userEvent.keyboard('{Enter}');

      expect(useConsole.getState().selectedIncidentId).toBe('a');
      expect(row(/Door forced open/)).toHaveAttribute('aria-current', 'true');
    });
  });
});
