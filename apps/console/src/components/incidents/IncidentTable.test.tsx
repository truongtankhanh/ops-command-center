import type { Incident, Zone } from '@occ/contracts';
import { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryRetryDelay, RATE_LIMITED_RETRYING, shouldRetryQuery } from '../../api/client';
import { queryKeys } from '../../api/queries';
import { useSession } from '../../auth/store';
import { CSV_BOM, csvFilename, incidentsToCsv } from '../../lib/incidents/incidentCsv';
import { downloadText } from '../../lib/shared/download';
import { useConsole } from '../../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
} from '../../test-utils';
import { FeedViewSwitch } from './FeedViewSwitch';
import { IncidentFeed } from './IncidentFeed';
import { IncidentTable } from './IncidentTable';

// No token in these cases; the API client only asks for one.
vi.mock('../../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));
// The file itself is `download.test.ts`'s (jsdom has no `URL.createObjectURL`): here only what Export hands it.
vi.mock('../../lib/shared/download', () => ({ downloadText: vi.fn() }));
const download = vi.mocked(downloadText);

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
/** A row's one button, in its Incident cell. */
const rowButton = (code: string) => within(rowOf(code)).getByRole('button');
const rowButtons = () => bodyRows().map((row) => within(row).getByRole('button'));
const selected = () => useConsole.getState().selectedIncidentId;
const exportButton = () => within(table()).getByRole('button', { name: 'Export CSV' });
/** The table's one live region, the toolbar's hidden line. */
const status = () => within(table()).getByRole('status');
/** The visible count: the toolbar's text with these words that is not the live line. */
const shownCount = (text: string) =>
  within(table())
    .queryAllByText(text)
    .filter((node) => node.getAttribute('role') !== 'status');
const zoneNames = new Map(zones.map((zone) => [zone.id, zone.name]));
/** The incidents in the order the table draws them. */
const drawn = () => codes().map((code) => list.find((incident) => incident.code === code)!);
/** What Export handed to `downloadText`: the file name, the text and the type. */
const exported = () => {
  expect(download).toHaveBeenCalledTimes(1);
  const [filename, text, type] = download.mock.calls[0]!;
  return { filename, text, type };
};
/** The CSV's codes, header excluded: the first cell of each line after the first. */
const csvCodes = (text: string) =>
  text
    .split('\r\n')
    .slice(1, -1)
    .map((line) => line.split(',')[0]);

describe('IncidentTable', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore(useConsole);
    incidentAnswers = [];
    download.mockClear();
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

    // V3-24.6 added the toolbar's line, the table's one live region; the rows and their ticking figures stay out of it.
    it("has one live region, the toolbar's, so the ticking figures are not read out", () => {
      renderTable();

      expect(within(table()).getAllByRole('status')).toHaveLength(1);
      expect(within(screen.getByRole('table')).queryByRole('status')).toBeNull();
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

  describe('opening a row (V3-24.5)', () => {
    it('opens the incident on a click anywhere on its row, and closes it on a second click', async () => {
      renderTable();
      // The Code cell: not the row's button, so the row itself takes the click.
      const code = cellsOf(rowOf('INC-000001'))[CODE]!;

      await userEvent.click(code);
      expect(selected()).toBe('a');

      await userEvent.click(code);
      expect(selected()).toBeNull();
    });

    it("opens on a click on the row's button, once, not once for the button and again for the row", async () => {
      renderTable();

      await userEvent.click(rowButton('INC-000002'));

      expect(selected()).toBe('b');
    });

    it("opens with Enter and with Space on the row's button, and closes with a second press", async () => {
      renderTable();
      rowButton('INC-000001').focus();

      await userEvent.keyboard('{Enter}');
      expect(selected()).toBe('a');
      await userEvent.keyboard('{Enter}');
      expect(selected()).toBeNull();

      await userEvent.keyboard(' ');
      expect(selected()).toBe('a');
      await userEvent.keyboard(' ');
      expect(selected()).toBeNull();
    });

    it('opens another incident in place of the open one', async () => {
      useConsole.setState({ selectedIncidentId: 'a' });
      renderTable();

      await userEvent.click(rowButton('INC-000002'));

      expect(selected()).toBe('b');
    });

    it('marks the opened row and its button as current, and no other', async () => {
      renderTable();

      await userEvent.click(rowButton('INC-000002'));

      expect(rowOf('INC-000002')).toHaveAttribute('aria-current', 'true');
      expect(rowButton('INC-000002')).toHaveAttribute('aria-current', 'true');
      for (const code of ['INC-000005', 'INC-000001', 'INC-000003']) {
        expect(rowOf(code)).not.toHaveAttribute('aria-current');
        expect(rowButton(code)).not.toHaveAttribute('aria-current');
      }
    });

    it("names the row's button by the type and the title", () => {
      renderTable();

      expect(rowButton('INC-000001')).toHaveAccessibleName('Intrusion: Door forced open');
    });
  });

  describe('the keys over the rows (V3-24.5)', () => {
    const tabStops = () => rowButtons().filter((button) => button.tabIndex === 0);

    it('is one Tab stop, on the first row when nothing is selected', () => {
      renderTable();

      expect(tabStops()).toEqual([rowButton('INC-000005')]);
      expect(rowButtons().filter((button) => button.tabIndex === -1)).toHaveLength(3);
    });

    it('puts the Tab stop on the selected row', () => {
      useConsole.setState({ selectedIncidentId: 'b' });
      renderTable();

      expect(tabStops()).toEqual([rowButton('INC-000002')]);
    });

    it('reaches the rows after Export CSV and the eight sort buttons, and leaves the table with the next Tab', async () => {
      renderTable();

      await userEvent.tab();
      expect(exportButton()).toHaveFocus();
      for (let press = 0; press < 8; press += 1) await userEvent.tab();
      expect(within(header('Code')).getByRole('button')).toHaveFocus();

      await userEvent.tab();
      expect(rowButton('INC-000005')).toHaveFocus();

      await userEvent.tab();
      expect(table()).not.toContainElement(document.activeElement as HTMLElement);
    });

    it('moves focus with ↑, ↓, Home and End, stopping at the ends, and never opens a row', async () => {
      renderTable();
      rowButton('INC-000005').focus();

      await userEvent.keyboard('{ArrowDown}');
      expect(rowButton('INC-000001')).toHaveFocus();
      await userEvent.keyboard('{End}');
      expect(rowButton('INC-000003')).toHaveFocus();
      await userEvent.keyboard('{ArrowDown}');
      expect(rowButton('INC-000003')).toHaveFocus();
      await userEvent.keyboard('{ArrowUp}');
      expect(rowButton('INC-000002')).toHaveFocus();
      await userEvent.keyboard('{Home}');
      expect(rowButton('INC-000005')).toHaveFocus();
      await userEvent.keyboard('{ArrowUp}');
      expect(rowButton('INC-000005')).toHaveFocus();

      expect(selected()).toBeNull();
    });

    it('moves the Tab stop with focus', async () => {
      renderTable();
      rowButton('INC-000005').focus();

      await userEvent.keyboard('{ArrowDown}');

      expect(tabStops()).toEqual([rowButton('INC-000001')]);
    });

    it('keeps the Tab stop on the focused incident when the rows are sorted again', async () => {
      renderTable();
      rowButton('INC-000005').focus();
      await userEvent.keyboard('{ArrowDown}');

      act(() => useConsole.setState({ tableSort: { key: 'code', direction: 'descending' } }));

      expect(codes()).toEqual(['INC-000005', 'INC-000003', 'INC-000002', 'INC-000001']);
      expect(tabStops()).toEqual([rowButton('INC-000001')]);
    });

    it('leaves the arrows on a sort button alone', async () => {
      renderTable();
      const sort = within(header('Code')).getByRole('button');
      sort.focus();

      await userEvent.keyboard('{ArrowDown}');

      expect(sort).toHaveFocus();
    });
  });

  describe('Esc (V3-24.5)', () => {
    /** The table and the switch it hands focus to, as the console draws them with the table chosen. */
    function renderWithSwitch() {
      act(() => useConsole.getState().setFeedView('table'));
      const client = createTestQueryClient();
      client.setQueryData(queryKeys.incidents, list);
      client.setQueryData(queryKeys.zones, zones);
      return renderWithQueryClient(
        <>
          <FeedViewSwitch />
          <IncidentTable />
        </>,
        client,
      );
    }
    const checkedView = () => screen.getByRole('radio', { name: 'Table' });

    it('moves focus from a row to the switch and keeps the table', async () => {
      renderWithSwitch();
      rowButton('INC-000001').focus();

      await userEvent.keyboard('{Escape}');

      expect(checkedView()).toHaveFocus();
      expect(useConsole.getState().feedView).toBe('table');
      expect(table()).toBeInTheDocument();
    });

    it('moves focus from a sort button to the switch too', async () => {
      renderWithSwitch();
      within(header('Code')).getByRole('button').focus();

      await userEvent.keyboard('{Escape}');

      expect(checkedView()).toHaveFocus();
    });

    it('moves focus from Export CSV to the switch too (V3-24.6)', async () => {
      renderWithSwitch();
      exportButton().focus();

      await userEvent.keyboard('{Escape}');

      expect(checkedView()).toHaveFocus();
      expect(download).not.toHaveBeenCalled();
    });

    it('does nothing while an incident is open in the inspector', async () => {
      useConsole.setState({ selectedIncidentId: 'a' });
      renderWithSwitch();
      rowButton('INC-000001').focus();

      await userEvent.keyboard('{Escape}');

      expect(rowButton('INC-000001')).toHaveFocus();
      expect(selected()).toBe('a');
    });

    it('does nothing while the report form is open', async () => {
      useConsole.setState({ reporting: true });
      renderWithSwitch();
      rowButton('INC-000001').focus();

      await userEvent.keyboard('{Escape}');

      expect(rowButton('INC-000001')).toHaveFocus();
    });
  });

  describe('the toolbar (V3-24.6)', () => {
    /** The table over a cache the case can change, as a live event would. */
    function renderLive(rows: Incident[] = list) {
      const client = createTestQueryClient();
      client.setQueryData(queryKeys.incidents, rows);
      client.setQueryData(queryKeys.zones, zones);
      renderWithQueryClient(<IncidentTable />, client);
      return client;
    }

    it('counts the incidents the table lists', () => {
      renderTable();

      expect(bodyRows()).toHaveLength(4);
      expect(shownCount('4 incidents')).toHaveLength(1);
    });

    it('says "1 incident" and "0 incidents"', () => {
      useConsole.setState({ feedQuery: 'pipe' });
      const { unmount } = renderTable();
      expect(shownCount('1 incident')).toHaveLength(1);
      unmount();

      useConsole.setState({ feedQuery: 'zzz' });
      renderTable();
      expect(shownCount('0 incidents')).toHaveLength(1);
    });

    it('shows no count and offers no export while the incidents load', () => {
      renderUncached();

      expect(screen.queryByText(/incidents?$/)).toBeNull();
      expect(exportButton()).toHaveAttribute('aria-disabled', 'true');
    });

    it('exports exactly the shown rows, in the shown order, with the header and the BOM', async () => {
      renderTable();
      const before = Date.now();

      await userEvent.click(exportButton());

      const after = Date.now();
      const { filename, text, type } = exported();
      expect(text).toBe(CSV_BOM + incidentsToCsv(drawn(), { zoneName: zoneNames }));
      expect(text.startsWith(`${CSV_BOM}Code,Severity,Type,Title,`)).toBe(true);
      expect(csvCodes(text)).toEqual(codes());
      expect(type).toBe('text/csv;charset=utf-8');
      // Named by the moment of the press, in local time.
      expect([csvFilename(before), csvFilename(after)]).toContain(filename);
    });

    it('follows the sort and the filters', async () => {
      useConsole.setState({
        filter: 'all',
        severity: 'medium',
        tableSort: { key: 'code', direction: 'descending' },
      });
      renderTable();
      expect(codes()).toEqual(['INC-000004', 'INC-000002']);

      await userEvent.click(exportButton());

      expect(csvCodes(exported().text)).toEqual(['INC-000004', 'INC-000002']);
    });

    it('agrees with the count', async () => {
      useConsole.setState({ filter: 'all' });
      renderTable();
      expect(shownCount('5 incidents')).toHaveLength(1);

      await userEvent.click(exportButton());

      expect(csvCodes(exported().text)).toHaveLength(5);
    });

    it('makes no request', async () => {
      renderTable();
      const calls = fetchMock.mock.calls.length;

      await userEvent.click(exportButton());

      expect(fetchMock.mock.calls.length).toBe(calls);
    });

    it('is offered, with no reason, while there are rows', () => {
      renderTable();

      expect(exportButton()).not.toHaveAttribute('aria-disabled');
      expect(exportButton()).not.toHaveAttribute('title');
      expect(exportButton()).not.toHaveAccessibleDescription();
    });

    it('stays reachable with its reason, and does nothing, when no row is shown', async () => {
      useConsole.setState({ feedQuery: 'zzz' });
      renderTable();

      expect(exportButton()).toHaveAttribute('aria-disabled', 'true');
      expect(exportButton()).toHaveAttribute('title', 'No incidents to export');
      expect(exportButton()).toHaveAccessibleDescription('No incidents to export');

      await userEvent.tab();
      expect(exportButton()).toHaveFocus();
      await userEvent.click(exportButton());
      await userEvent.keyboard('{Enter}');

      expect(download).not.toHaveBeenCalled();
    });

    it.each([
      [
        'an operator',
        'operator',
        'active',
        ['INC-000005', 'INC-000001', 'INC-000002', 'INC-000003'],
      ],
      [
        'a supervisor',
        'supervisor',
        'active',
        ['INC-000005', 'INC-000001', 'INC-000002', 'INC-000003'],
      ],
      ['a viewer', 'viewer', 'active', ['INC-000005', 'INC-000001', 'INC-000002', 'INC-000003']],
      // A technician acts on Facilities and Environment (ADR-0021): the water leak is the one open incident to handle.
      ['a technician on Mine to handle', 'technician', 'mine', ['INC-000002']],
    ] as const)('lets %s export the rows of the tab shown', async (_, role, filter, expected) => {
      act(() => useSession.getState().signedIn({ displayName: 'Demo user', roles: [role] }));
      useConsole.setState({ filter });
      renderTable();
      expect(codes()).toEqual(expected);

      await userEvent.click(exportButton());

      expect(csvCodes(exported().text)).toEqual(expected);
    });

    it('announces a filter change once, and not an incident arriving', async () => {
      const client = renderLive();
      expect(status()).toHaveTextContent('4 incidents');

      act(() =>
        client.setQueryData(queryKeys.incidents, [
          incident({ id: 'f', code: 'INC-000006', title: 'Lift stuck', severity: 'low' }),
          ...list,
        ]),
      );
      // TanStack tells its observers on a timer, so the count follows a tick later: wait for it, as RTL does. The live line
      // keeps what it last said.
      await waitFor(() => expect(shownCount('5 incidents')).toHaveLength(1));
      expect(status()).toHaveTextContent('4 incidents');

      act(() => useConsole.setState({ severity: 'high' }));
      expect(status()).toHaveTextContent('1 incident');
      expect(shownCount('1 incident')).toHaveLength(1);
    });

    it('announces the count once the incidents arrive', async () => {
      incidentAnswers = [() => json(list)];
      renderUncached();
      expect(status()).toBeEmptyDOMElement();

      expect(await screen.findAllByText('4 incidents')).toHaveLength(2);
      expect(status()).toHaveTextContent('4 incidents');
    });

    it('has no axe violations with nothing to export', async () => {
      useConsole.setState({ feedQuery: 'zzz' });
      const { container } = renderTable();

      await expectNoAxeViolations(container);
    });
  });

  describe('states', () => {
    it('shows placeholder rows while the incidents load, busy and silent', () => {
      renderUncached();

      expect(table()).toHaveAttribute('aria-busy', 'true');
      // The list's skeleton says "Loading incidents…"; the table must not say it twice: its live line is empty.
      expect(status()).toBeEmptyDOMElement();
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
      // No button but Export CSV, which has nothing to export (V3-24.6).
      expect(within(table()).getAllByRole('button')).toEqual([exportButton()]);
      expect(exportButton()).toHaveAttribute('aria-disabled', 'true');
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
