import type { Incident, Zone } from '@occ/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { queryKeys } from '../../api/queries';
import { getAccessToken } from '../../auth/session';
import { useConsole } from '../../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
} from '../../test-utils';
import { WALL_LIST_LIMIT, WallIncidents } from './WallIncidents';

// The session module is tested on its own; here it only decides which token the client sends.
vi.mock('../../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const ZONES: Zone[] = [
  { id: 'z1', code: 'GATE', name: 'Main Gate', kind: 'gate', polygon: [], center: [108.44, 11.95] },
];

const incident = (id: string, overrides: Partial<Incident> = {}): Incident => ({
  id,
  code: `INC-${id}`,
  type: 'fire_alarm',
  severity: 'medium',
  status: 'open',
  title: `Title ${id}`,
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

function renderList({ incidents, seed = true }: { incidents?: Incident[]; seed?: boolean } = {}) {
  const client = createTestQueryClient();
  if (seed) client.setQueryData(queryKeys.incidents, incidents ?? []);
  client.setQueryData(queryKeys.zones, ZONES);
  return renderWithQueryClient(<WallIncidents />, client);
}

const titles = () =>
  screen.getAllByRole('listitem').map((item) => /Title [a-z-]+/.exec(item.textContent ?? '')?.[0]);

describe('WallIncidents', () => {
  beforeEach(() => {
    resetStore(useConsole);
    vi.mocked(getAccessToken).mockReset().mockResolvedValue(null);
    // A safety net: any query a case does not seed stays pending, and no request leaves the test.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('lists the active incidents in the feed’s order: the most severe, then the newest', () => {
    renderList({
      incidents: [
        incident('low', { severity: 'low' }),
        incident('high-old', { severity: 'high', reportedAt: '2026-10-08T07:00:00.000Z' }),
        incident('crit', { severity: 'critical' }),
        incident('high-new', { severity: 'high', reportedAt: '2026-10-08T09:00:00.000Z' }),
      ],
    });

    // The row's text runs the title into the age ("Title crit12d"): letters and hyphens only.
    expect(titles()).toEqual(['Title crit', 'Title high-new', 'Title high-old', 'Title low']);
    const ids = screen
      .getAllByRole('listitem')
      .map((item) => /INC-[\w-]+/.exec(item.textContent ?? '')?.[0]);
    expect(ids).toEqual(['INC-crit', 'INC-high-new', 'INC-high-old', 'INC-low']);
  });

  it('counts an acknowledged incident, and leaves a resolved one out', () => {
    renderList({
      incidents: [
        incident('done', { status: 'resolved', severity: 'critical' }),
        incident('handled', { status: 'acknowledged' }),
      ],
    });

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText(/Title handled/)).toBeInTheDocument();
    expect(screen.queryByText(/Title done/)).toBeNull();
  });

  it('names the zone and the code of each row', () => {
    renderList({ incidents: [incident('1')] });

    const row = screen.getByRole('listitem');
    expect(within(row).getByText('Main Gate')).toBeInTheDocument();
    expect(within(row).getByText('INC-1')).toBeInTheDocument();
  });

  it('is text: nothing to press, tab to or select', () => {
    const { container } = renderList({ incidents: [incident('1'), incident('2')] });

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(container.querySelectorAll('button, a[href], input, [tabindex]')).toHaveLength(0);
  });

  it('draws only the rows that can fit, and the heading above it counts them all', () => {
    renderList({
      incidents: Array.from({ length: WALL_LIST_LIMIT + 5 }, (_, i) =>
        incident(String(i).padStart(2, '0')),
      ),
    });

    expect(screen.getAllByRole('listitem')).toHaveLength(WALL_LIST_LIMIT);
  });

  it('says so, with a glyph and the words, when nothing is active', () => {
    renderList({ incidents: [incident('done', { status: 'resolved' })] });

    expect(screen.getByText('No active incidents')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('holds the place of the rows while the incidents load', () => {
    renderList({ seed: false });

    expect(screen.getByRole('status')).toHaveTextContent('Loading incidents…');
  });

  it('says so, as a line and not a button, when the incidents cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 500 }))),
    );
    renderList({ seed: false });

    await waitFor(() =>
      expect(screen.getByText('Incidents could not be loaded.')).toBeInTheDocument(),
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('has no axe violations', async () => {
    renderList({ incidents: [incident('1', { severity: 'critical' }), incident('2')] });

    await expectNoAxeViolations();
  });
});
