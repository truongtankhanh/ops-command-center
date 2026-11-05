import type { Incident, Zone } from '@occ/contracts';
import { QueryClient } from '@tanstack/react-query';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryRetryDelay, RATE_LIMITED_RETRYING, shouldRetryQuery } from '../../api/client';
import { queryKeys } from '../../api/queries';
import { useSession } from '../../auth/store';
import { useConsole } from '../../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
} from '../../test-utils';
import { IncidentFeed } from './IncidentFeed';
import { IncidentTable } from './IncidentTable';

// No token in these cases; the API client only asks for one.
vi.mock('../../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const MINUTE = 60_000;

const zones: Zone[] = [
  { id: 'z1', code: 'BLD-LIB', name: 'Library', kind: 'building', polygon: [], center: [0, 0] },
  { id: 'z2', code: 'BLD-GYM', name: 'Gym', kind: 'building', polygon: [], center: [0, 0] },
];

const incident = (overrides: Partial<Incident> & Pick<Incident, 'id' | 'code'>): Incident => ({
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

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

// In the feed's order (`compareIncidents`: unresolved first, then severity), as the cache holds it, so the list draws them in
// this order and the table's unsorted order is the same.
const list: Incident[] = [
  incident({
    id: 'e',
    code: 'INC-000005',
    title: 'Gas smell',
    type: 'fire_alarm',
    severity: 'critical',
    zoneId: 'unknown-zone',
    source: 'simulator',
  }),
  incident({ id: 'a', code: 'INC-000001', title: 'Door forced open', severity: 'high' }),
  // Fifteen minutes is a medium incident's threshold: twenty minutes on, it is overdue.
  incident({
    id: 'b',
    code: 'INC-000002',
    title: 'Pipe burst',
    type: 'water_leak',
    zoneId: 'z2',
    reportedAt: ago(20 * MINUTE),
  }),
  incident({
    id: 'c',
    code: 'INC-000003',
    title: 'Queue at gate',
    severity: 'low',
    status: 'acknowledged',
  }),
  incident({
    id: 'd',
    code: 'INC-000004',
    title: 'Smoke detector',
    type: 'fire_alarm',
    status: 'resolved',
    source: 'telemetry',
  }),
];

const fetchMock = vi.fn<typeof fetch>();
/** What the next `GET /incidents` answers, one factory each; once empty, a request stays pending. */
let incidentAnswers: (() => Response)[] = [];

const urlOf = (input: Parameters<typeof fetch>[0]): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const apiError = (status: number, message: string) => json({ statusCode: status, message }, status);

/** The table alone, over a cached list (no request is made: the list never goes stale). */
function renderTable(rows: Incident[] = list) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.incidents, rows);
  client.setQueryData(queryKeys.zones, zones);
  return renderWithQueryClient(<IncidentTable />, client);
}

/** The list is not cached: the table asks the API for it (`incidentAnswers`). */
function renderUncached(client = createTestQueryClient()) {
  client.setQueryData(queryKeys.zones, zones);
  return renderWithQueryClient(<IncidentTable />, client);
}

const table = () => screen.getByRole('region', { name: 'Incident table' });
/** The body's rows, header excluded. */
const bodyRows = () => {
  const [, body] = within(table()).getAllByRole('rowgroup');
  return body ? within(body).getAllByRole('row') : [];
};
/** One cell per column, in `TABLE_COLUMNS` order: severity, incident, place, status, source, raised, attention, code. */
const cellsOf = (row: HTMLElement) => within(row).getAllByRole('cell');
const CODE = 7;
const codes = () => bodyRows().map((row) => cellsOf(row)[CODE]?.textContent);
const rowOf = (code: string) => {
  const row = bodyRows().find((candidate) => cellsOf(candidate)[CODE]?.textContent === code);
  if (!row) throw new Error(`no row for ${code}`);
  return row;
};
const header = (name: string) => screen.getByRole('columnheader', { name });

describe('IncidentTable', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore(useConsole);
    incidentAnswers = [];
    fetchMock.mockReset().mockImplementation((input) => {
      // Only the incident list is answered; anything else the feed reads (the catalogue, for the alarm load) stays pending.
      if (!urlOf(input).includes('/incidents')) return new Promise<Response>(() => {});
      const answer = incidentAnswers.shift();
      return answer ? Promise.resolve(answer()) : new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);
    resetStore(useSession);
    useSession.getState().signedIn({ displayName: 'Demo Operator', roles: ['operator'] });
  });

  afterEach(() => vi.unstubAllGlobals());

  describe('the same rows as the list', () => {
    /** The list and the table side by side over one cache, as the console draws them. */
    function renderBoth() {
      const client = createTestQueryClient();
      client.setQueryData(queryKeys.incidents, list);
      client.setQueryData(queryKeys.zones, zones);
      return renderWithQueryClient(
        <>
          <IncidentFeed />
          <IncidentTable />
        </>,
        client,
      );
    }
    const listCodes = () =>
      within(screen.getByRole('region', { name: 'Incidents' }))
        .queryAllByRole('listitem')
        .map((item) => /INC-\d+/.exec(item.textContent ?? '')?.[0]);

    it.each([
      ['the Active tab', {}],
      ['the Resolved tab', { filter: 'resolved' }],
      ['the All tab', { filter: 'all' }],
      ['a severity chip', { filter: 'all', severity: 'critical' }],
      ['a category', { filter: 'all', category: 'facilities' }],
      ['a search on the zone name', { feedQuery: 'gym' }],
      ['a search on the title', { filter: 'all', feedQuery: 'smoke' }],
    ] as const)('lists exactly what the list lists, in its order, for %s', (_, state) => {
      useConsole.setState(state);
      renderBoth();

      expect(codes().length).toBeGreaterThan(0);
      expect(codes()).toEqual(listCodes());
    });

    it('follows a filter changed while it is shown', () => {
      renderTable();
      expect(codes()).toEqual(['INC-000005', 'INC-000001', 'INC-000002', 'INC-000003']);

      act(() => useConsole.getState().setFilter('resolved'));

      expect(codes()).toEqual(['INC-000004']);
    });
  });

  describe('the table', () => {
    it('is a table captioned "Incidents" in a region named "Incident table"', () => {
      renderTable();

      expect(within(table()).getByRole('table', { name: 'Incidents' })).toBeInTheDocument();
    });

    it("has frame 19's eight column headers, each a sort button, none sorted at first", () => {
      renderTable();

      const headers = within(table()).getAllByRole('columnheader');
      expect(headers.map((th) => th.textContent)).toEqual([
        'Severity',
        'Incident',
        'Place',
        'Status',
        'Source',
        'Raised',
        'Attention',
        'Code',
      ]);
      for (const th of headers) {
        expect(th).toHaveAttribute('scope', 'col');
        expect(th).toHaveAttribute('aria-sort', 'none');
        expect(within(th).getByRole('button')).toBeInTheDocument();
      }
    });

    it('draws one row per incident with every column', () => {
      renderTable();

      const cells = cellsOf(rowOf('INC-000001'));
      expect(cells.map((cell) => cell.textContent)).toEqual([
        'High',
        expect.stringContaining('Door forced open'),
        'Library',
        'Open',
        'Operator',
        expect.stringMatching(/^\d{2}:\d{2}$/),
        expect.stringMatching(/^\d+:\d{2} left$/),
        'INC-000001',
      ]);
    });

    it('reads the type before the title, once', () => {
      renderTable();

      const incidentCell = cellsOf(rowOf('INC-000001'))[1];
      if (!incidentCell) throw new Error('no incident cell');
      // One text node for assistive tech; the visible title is the hidden duplicate.
      expect(within(incidentCell).getByText('Intrusion: Door forced open')).toBeInTheDocument();
      const visible = within(incidentCell).getByTitle('Door forced open');
      expect(visible).toHaveAttribute('aria-hidden', 'true');
    });

    it('says the raised time in a machine-readable time', () => {
      renderTable();

      const raised = cellsOf(rowOf('INC-000003'))[5]?.querySelector('time');
      expect(raised).toHaveAttribute('dateTime', list[3]?.reportedAt);
    });

    it('shows the time over for an overdue open incident', () => {
      renderTable();

      expect(cellsOf(rowOf('INC-000002'))[6]).toHaveTextContent(/^\+\d+:\d{2} over$/);
    });

    it('shows no countdown for an incident that is not open, and says so to assistive tech', () => {
      renderTable();

      const attention = cellsOf(rowOf('INC-000003'))[6];
      if (!attention) throw new Error('no attention cell');
      expect(within(attention).getByText('No countdown')).toBeInTheDocument();
      expect(within(attention).getByText('—')).toHaveAttribute('aria-hidden', 'true');
    });

    it('is never a live region, so the ticking figures are not read out', () => {
      renderTable();

      expect(within(table()).queryByRole('status')).toBeNull();
      expect(table().querySelector('[aria-live]')).toBeNull();
    });

    it('names the source and leaves the place empty for a zone the zones lack', () => {
      useConsole.setState({ filter: 'all' });
      renderTable();

      const unknownZone = cellsOf(rowOf('INC-000005'));
      expect(unknownZone[2]).toHaveTextContent(/^$/);
      expect(unknownZone[4]).toHaveTextContent('Simulator');
      expect(cellsOf(rowOf('INC-000004'))[4]).toHaveTextContent('Telemetry rule');
    });

    it('marks the selected incident as current, and no other', () => {
      useConsole.setState({ selectedIncidentId: 'b' });
      renderTable();

      expect(rowOf('INC-000002')).toHaveAttribute('aria-current', 'true');
      expect(rowOf('INC-000001')).not.toHaveAttribute('aria-current');
    });

    it('marks each cell with its column, for the narrow-stage rule', () => {
      renderTable();

      expect(cellsOf(rowOf('INC-000001')).map((cell) => cell.dataset.column)).toEqual([
        'severity',
        'incident',
        'place',
        'status',
        'source',
        'raised',
        'attention',
        'code',
      ]);
    });
  });

  describe('sorting', () => {
    it("steps a column through its first direction, the opposite and back to the list's order", async () => {
      renderTable();
      const button = within(header('Code')).getByRole('button');

      // Code starts with the newest code (V3-24.1).
      await userEvent.click(button);
      expect(header('Code')).toHaveAttribute('aria-sort', 'descending');
      expect(codes()).toEqual(['INC-000005', 'INC-000003', 'INC-000002', 'INC-000001']);
      expect(useConsole.getState().tableSort).toEqual({ key: 'code', direction: 'descending' });

      await userEvent.click(button);
      expect(header('Code')).toHaveAttribute('aria-sort', 'ascending');
      expect(codes()).toEqual(['INC-000001', 'INC-000002', 'INC-000003', 'INC-000005']);

      await userEvent.click(button);
      expect(header('Code')).toHaveAttribute('aria-sort', 'none');
      expect(codes()).toEqual(['INC-000005', 'INC-000001', 'INC-000002', 'INC-000003']);
      expect(useConsole.getState().tableSort).toBeNull();
    });

    it('sorts by one column at a time', async () => {
      renderTable();

      await userEvent.click(within(header('Code')).getByRole('button'));
      await userEvent.click(within(header('Incident')).getByRole('button'));

      expect(header('Incident')).toHaveAttribute('aria-sort', 'ascending');
      expect(header('Code')).toHaveAttribute('aria-sort', 'none');
      expect(codes()).toEqual(['INC-000001', 'INC-000005', 'INC-000002', 'INC-000003']);
    });

    it('remembers the sort in this browser', async () => {
      renderTable();

      await userEvent.click(within(header('Raised')).getByRole('button'));

      expect(JSON.parse(localStorage.getItem('occ.console.tableSort') ?? 'null')).toEqual({
        key: 'raised',
        direction: 'descending',
      });
    });

    it('opens in the sort the store holds', () => {
      useConsole.setState({ tableSort: { key: 'incident', direction: 'descending' } });
      renderTable();

      expect(header('Incident')).toHaveAttribute('aria-sort', 'descending');
      expect(codes()).toEqual(['INC-000003', 'INC-000002', 'INC-000005', 'INC-000001']);
    });

    it('puts an incident with no countdown last on Attention, whichever way', async () => {
      renderTable();
      const button = within(header('Attention')).getByRole('button');

      await userEvent.click(button);
      expect(codes().at(-1)).toBe('INC-000003');

      await userEvent.click(button);
      expect(codes().at(-1)).toBe('INC-000003');
    });
  });

  describe('states', () => {
    it('shows placeholder rows while the incidents load, busy and silent', () => {
      renderUncached();

      expect(table()).toHaveAttribute('aria-busy', 'true');
      // The list's skeleton says "Loading incidents…"; the table must not say it twice.
      expect(within(table()).queryByRole('status')).toBeNull();
      expect(within(table()).queryByRole('table')).toBeNull();
    });

    it('says the list could not be loaded, and retries', async () => {
      incidentAnswers = [() => apiError(500, 'Internal server error'), () => json(list)];
      renderUncached();

      expect(await screen.findByText('Incidents could not be loaded.')).toBeInTheDocument();
      expect(table()).not.toHaveAttribute('aria-busy');

      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await screen.findByRole('table', { name: 'Incidents' })).toBeInTheDocument();
    });

    it('waits calmly while too many requests are retried', async () => {
      // The console's own policy: a 429 is retried after 2 s, which this case never waits for.
      const client = new QueryClient({
        defaultOptions: { queries: { retry: shouldRetryQuery, retryDelay: queryRetryDelay } },
      });
      incidentAnswers = [() => apiError(429, 'Too many requests')];
      const { unmount } = renderUncached(client);

      expect(await screen.findByText(RATE_LIMITED_RETRYING)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();

      unmount();
      await client.cancelQueries();
    });

    it("says why nothing is shown, with the list's message and no button", () => {
      useConsole.setState({ feedQuery: 'zzz' });
      renderTable();

      expect(within(table()).getByText('No active incidents match "zzz".')).toBeInTheDocument();
      expect(within(table()).queryByRole('table')).toBeNull();
      expect(within(table()).queryByRole('button')).toBeNull();
    });

    it('says how old the rows are while the live link is down', () => {
      renderTable();
      expect(screen.queryByText(/Showing incidents as of/)).toBeNull();

      // A local time, so the text does not depend on the runner's timezone.
      const lostAt = new Date(2026, 9, 8, 15, 2).getTime();
      act(() => useConsole.setState({ offlineSince: lostAt }));

      expect(within(table()).getByText('Showing incidents as of 15:02')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has no axe violations', async () => {
      const { container } = renderTable();

      await expectNoAxeViolations(container);
    });

    it('has no axe violations sorted, with a selected row', async () => {
      useConsole.setState({
        selectedIncidentId: 'a',
        tableSort: { key: 'severity', direction: 'descending' },
      });
      const { container } = renderTable();

      await expectNoAxeViolations(container);
    });
  });
});
