import type { Incident, Zone } from '@occ/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from '../api/queries';
import { useConsole } from '../store';
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
  beforeEach(() =>
    useConsole.setState({ filter: 'active', selectedIncidentId: null, reporting: false }),
  );

  it('shows only active incidents by default, with zone and status', () => {
    renderFeed();

    expect(screen.getByText('Door forced open')).toBeInTheDocument();
    expect(screen.getByText('Being handled')).toBeInTheDocument();
    expect(screen.queryByText('Smoke detector')).not.toBeInTheDocument();
    expect(screen.getAllByText('Library')).toHaveLength(2);
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

  it('opens the report form from the feed and clears the selection', async () => {
    useConsole.setState({ selectedIncidentId: 'a' });
    renderFeed();

    await userEvent.click(screen.getByRole('button', { name: 'Report incident' }));

    expect(useConsole.getState().reporting).toBe(true);
    expect(useConsole.getState().selectedIncidentId).toBeNull();
  });
});
