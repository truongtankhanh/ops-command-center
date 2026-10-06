import type { Incident, Zone } from '@occ/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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

function renderFeed() {
  const client = new QueryClient();
  client.setQueryData(queryKeys.incidents, incidents);
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
    expect(screen.getByRole('tab', { name: 'Resolved' })).toBeInTheDocument();
  });

  it('switches to resolved incidents', async () => {
    renderFeed();
    await userEvent.click(screen.getByRole('tab', { name: 'Resolved' }));

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
      expect(screen.getByRole('tab', { name: 'Active' })).toHaveFocus();
    });

    it('keeps the severity filter when switching tab', async () => {
      useConsole.setState({ severity: 'critical' });
      renderFeed();

      await userEvent.click(screen.getByRole('tab', { name: 'Resolved' }));

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
});
