import type { Incident } from '@occ/contracts';
import { screen, within } from '@testing-library/react';
import { queryKeys } from '../../api/queries';
import { useConsole } from '../../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
} from '../../test-utils';
import { WallHeader } from './WallHeader';

const incident = (id: string, overrides: Partial<Incident>): Incident => ({
  id,
  code: id.toUpperCase(),
  type: 'fire_alarm',
  severity: 'medium',
  status: 'open',
  title: id,
  description: null,
  zoneId: 'z1',
  position: [108.44, 11.95],
  source: 'operator',
  reportedAt: '2026-10-08T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

function renderHeader(incidents: Incident[] = []) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.incidents, incidents);
  return renderWithQueryClient(<WallHeader screen={2} />, client);
}

describe('WallHeader', () => {
  beforeEach(() => resetStore(useConsole));

  it('names the product once, as the page heading, with the site', () => {
    renderHeader();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Ops Command Center' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Langbiang Tech Campus')).toBeInTheDocument();
  });

  it('counts the active incidents by severity as the feed and the KPI tiles do', () => {
    renderHeader([
      incident('a', { severity: 'critical' }),
      incident('b', { severity: 'critical', status: 'resolved' }),
      incident('c', { severity: 'high', status: 'acknowledged' }),
      incident('d', { severity: 'medium' }),
      incident('e', { severity: 'medium' }),
    ]);

    const list = screen.getByRole('list', { name: 'Active incidents by severity' });
    const counts = within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(counts).toEqual(['1 Critical', '1 High', '2 Medium', '0 Low']);
  });

  it('draws the counts as text: nothing to press, and no word about filtering', () => {
    const { container } = renderHeader([incident('a', { severity: 'critical' })]);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(container.querySelectorAll('button, a[href], input, select, [tabindex]')).toHaveLength(
      0,
    );
    expect(screen.queryByLabelText(/filter/i)).toBeNull();
  });

  it('says which screen it is, and that it is view only', () => {
    renderHeader();

    expect(screen.getByText('Wall 2 · view only')).toBeInTheDocument();
  });

  it("shows the console's two connection states with their own words", () => {
    useConsole.setState({ connection: 'offline' });
    renderHeader();

    const states = screen.getAllByRole('status').map((state) => state.textContent);
    expect(states).toEqual(['Offline', 'Telemetry connecting…']);
  });

  it('has a clock that keeps its date at any width', () => {
    const { container } = renderHeader();

    const clock = container.querySelector('time');
    expect(clock).toHaveAttribute('data-date', 'always');
    expect(clock?.textContent).toMatch(/\d{2}:\d{2}/);
  });

  it('has no axe violations', async () => {
    renderHeader([incident('a', { severity: 'critical' })]);

    await expectNoAxeViolations(document.body);
  });
});
