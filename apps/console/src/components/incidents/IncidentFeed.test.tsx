import type { Incident, Role, Zone } from '@occ/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  queryRetryDelay,
  RATE_LIMITED_RETRYING,
  shouldRetryQuery,
  TOO_MANY_REQUESTS,
} from '../../api/client';
import { queryKeys } from '../../api/queries';
import { useSession } from '../../auth/store';
import { useConsole } from '../../store';
import { createTestQueryClient, renderWithQueryClient, resetStore } from '../../test-utils';
import { IncidentFeed } from './IncidentFeed';

// No token in these cases; the API client only asks for one.
vi.mock('../../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

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

const fetchMock = vi.fn<typeof fetch>();
/** What the next `GET /incidents` answer, one factory each; once empty, a request stays pending. */
let incidentAnswers: (() => Response)[] = [];

const urlOf = (input: Parameters<typeof fetch>[0]): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
/** How many times the feed asked for the incident list, whatever else it asked for. */
const incidentRequests = () =>
  fetchMock.mock.calls.filter(([input]) => urlOf(input).includes('/incidents')).length;

/** A body can be read only once, so build one per call. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function apiError(status: number, message: string): Response {
  return json({ statusCode: status, message }, status);
}

/** The list is not cached: the feed asks the API for it (`incidentAnswers`). */
function renderUncached(client = createTestQueryClient()) {
  client.setQueryData(queryKeys.zones, [zone]);
  return renderWithQueryClient(<IncidentFeed />, client);
}

describe('IncidentFeed', () => {
  beforeEach(() => {
    useConsole.setState({
      filter: 'active',
      severity: null,
      category: null,
      // The search text is store state since V3-24.4 (`useFeedRows`): a case that types one must not leave it to the next.
      feedQuery: '',
      groupByZone: false,
      selectedIncidentId: null,
      reporting: false,
      fresh: new Set(),
      offlineSince: null,
    });
    incidentAnswers = [];
    fetchMock.mockReset().mockImplementation((input) => {
      // Only the incident list is answered. The catalogue that the alarm load reads (V3-21.4) stays pending, as before it was read.
      if (!urlOf(input).includes('/incidents')) return new Promise<Response>(() => {});
      const answer = incidentAnswers.shift();
      return answer ? Promise.resolve(answer()) : new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);
    // A signed-in role, as in the console. The feed holds no actions (Report is in the header).
    resetStore(useSession);
    useSession.getState().signedIn({ displayName: 'Demo Operator', roles: ['operator'] });
  });

  afterEach(() => vi.unstubAllGlobals());

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

    it('offers to show every severity when nothing matches, and keeps focus in the feed', async () => {
      // The only critical incident is resolved, so the active tab has none.
      useConsole.setState({ severity: 'critical' });
      renderFeed();
      expect(screen.getByText('No active critical incidents.')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Show all severities' }));

      expect(useConsole.getState().severity).toBeNull();
      expect(screen.getByText('Door forced open')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /^Active/ })).toHaveFocus();
    });

    it('shows no chip without a severity filter', () => {
      renderFeed();

      expect(screen.queryByRole('button', { name: 'Clear severity filter' })).toBeNull();
    });
  });

  // V3-07.3: the category filter beside the search box.
  describe('category filter', () => {
    const mixed: Incident[] = [
      {
        ...base,
        id: 'sec',
        title: 'Door forced open',
        type: 'intrusion',
        status: 'open',
        severity: 'high',
      },
      {
        ...base,
        id: 'fire',
        title: 'Smoke detector',
        type: 'fire_alarm',
        status: 'open',
        severity: 'critical',
      },
      {
        ...base,
        id: 'water',
        title: 'Pipe burst',
        type: 'water_leak',
        status: 'acknowledged',
        severity: 'medium',
      },
      {
        ...base,
        id: 'old',
        title: 'Old break-in',
        type: 'intrusion',
        status: 'resolved',
        severity: 'low',
      },
    ];
    const filterButton = () => screen.getByRole('button', { name: 'Filter by category' });
    const choose = async (name: string) => {
      await userEvent.click(filterButton());
      await userEvent.click(screen.getByRole('button', { name }));
    };

    it('opens a panel of the six categories from the button beside the search box', async () => {
      renderFeed(mixed);
      expect(filterButton()).toHaveAttribute('aria-expanded', 'false');

      await userEvent.click(filterButton());

      const panel = screen.getByRole('group', { name: 'Filter incidents by category' });
      for (const name of [
        'Security',
        'Fire & safety',
        'Medical',
        'Facilities',
        'Environment',
        'Traffic',
      ]) {
        expect(within(panel).getByRole('button', { name })).toHaveAttribute(
          'aria-pressed',
          'false',
        );
      }
    });

    it('lists only the incidents of the chosen category, with a chip and the tab counts following', async () => {
      renderFeed(mixed);
      expect(screen.getByRole('tab', { name: 'Active 3' })).toBeInTheDocument();

      await choose('Security');

      expect(screen.getByText('Door forced open')).toBeInTheDocument();
      expect(screen.queryByText('Smoke detector')).not.toBeInTheDocument();
      expect(screen.queryByText('Pipe burst')).not.toBeInTheDocument();
      expect(screen.getByText('Security only')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Active 1' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Resolved 1' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'All 2' })).toBeInTheDocument();
    });

    it('closes the panel after a choice and leaves focus on the button', async () => {
      renderFeed(mixed);

      await choose('Facilities');

      expect(screen.queryByRole('group', { name: 'Filter incidents by category' })).toBeNull();
      expect(filterButton()).toHaveFocus();
      expect(useConsole.getState().category).toBe('facilities');
    });

    it('restores the list when the same category is chosen again', async () => {
      renderFeed(mixed);
      await choose('Security');

      await choose('Security');

      expect(useConsole.getState().category).toBeNull();
      expect(screen.getByText('Smoke detector')).toBeInTheDocument();
      expect(screen.queryByText('Security only')).not.toBeInTheDocument();
    });

    it('restores the list from Clear in the panel', async () => {
      renderFeed(mixed);
      await choose('Security');

      await userEvent.click(filterButton());
      await userEvent.click(screen.getByRole('button', { name: 'Clear' }));

      expect(useConsole.getState().category).toBeNull();
      expect(screen.getByText('Pipe burst')).toBeInTheDocument();
    });

    it('clears from the chip and puts focus on the filter button', async () => {
      renderFeed(mixed);
      await choose('Security');

      await userEvent.click(screen.getByRole('button', { name: 'Clear category filter' }));

      expect(useConsole.getState().category).toBeNull();
      expect(screen.queryByText('Security only')).not.toBeInTheDocument();
      expect(screen.getByText('Smoke detector')).toBeInTheDocument();
      expect(filterButton()).toHaveFocus();
    });

    it('shows both chips when a severity is on too, and clears each on its own', async () => {
      useConsole.setState({ severity: 'high' });
      renderFeed(mixed);
      await choose('Security');

      expect(screen.getByText('High only')).toBeInTheDocument();
      expect(screen.getByText('Security only')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Clear severity filter' }));
      expect(screen.getByText('Security only')).toBeInTheDocument();
      expect(screen.queryByText('High only')).not.toBeInTheDocument();
    });

    it('lists a type this console does not know until a category is chosen', async () => {
      const odd = {
        ...base,
        id: 'odd',
        title: 'Odd report',
        type: 'not_in_contract' as Incident['type'],
        status: 'open',
        severity: 'high',
      } as const;
      renderFeed([...mixed, odd]);
      expect(screen.getByText('Odd report')).toBeInTheDocument();

      await choose('Security');

      expect(screen.queryByText('Odd report')).not.toBeInTheDocument();
    });

    it('says which category has nothing to show, and offers every category', async () => {
      useConsole.setState({ category: 'traffic' });
      renderFeed(mixed);
      expect(screen.getByText('No active Traffic incidents.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Show all severities' })).toBeNull();

      await userEvent.click(screen.getByRole('button', { name: 'Show all categories' }));

      expect(useConsole.getState().category).toBeNull();
      expect(screen.getByText('Door forced open')).toBeInTheDocument();
      expect(filterButton()).toHaveFocus();
    });

    it('offers both ways back when a severity and a category are on', () => {
      useConsole.setState({ severity: 'low', category: 'traffic' });

      renderFeed(mixed);

      expect(screen.getByText('No active low Traffic incidents.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Show all severities' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Show all categories' })).toBeInTheDocument();
    });

    it('names the category in a search that finds nothing, with no second way back', async () => {
      useConsole.setState({ category: 'fire_safety' });
      renderFeed(mixed);

      await userEvent.type(screen.getByRole('searchbox', { name: 'Search incidents' }), 'door');

      expect(
        screen.getByText('No active Fire & safety incidents match "door".'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Show all categories' })).toBeNull();
    });

    it('keeps the search text and the / shortcut when a category is chosen', async () => {
      renderFeed(mixed);
      const search = screen.getByRole('searchbox', { name: 'Search incidents' });
      await userEvent.type(search, 'door');

      await choose('Security');

      expect(search).toHaveValue('door');
      await userEvent.keyboard('/');
      expect(search).toHaveFocus();
    });

    it("narrows a technician's Mine to handle as well", async () => {
      useSession.getState().signedIn({ displayName: 'Demo Technician', roles: ['technician'] });
      renderFeed(mixed);
      await userEvent.click(screen.getByRole('tab', { name: /^Mine to handle/ }));
      expect(screen.getByText('Pipe burst')).toBeInTheDocument();

      await choose('Security');

      expect(screen.queryByText('Pipe burst')).not.toBeInTheDocument();
      expect(
        screen.getByText('No Security incidents to handle in Facilities or Environment.'),
      ).toBeInTheDocument();
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

    it('names a type this console does not know by its raw id', () => {
      // A newer API can send a type this build's contract lacks (ADR-0021, rolling deploys); the
      // type system cannot model it, hence the cast.
      const type = 'not_in_contract' as Incident['type'];
      renderFeed([
        { ...base, type, id: 'u', title: 'Odd report', status: 'open', severity: 'high' },
      ]);

      expect(row(/High severity,\s*not_in_contract:\s*Odd report/)).toBeInTheDocument();
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

  // V3-22.3 (frame 17): the rows count down on the clock of `useCountdownNow`: one second under ten minutes, else 15 s.
  describe('attention countdown', () => {
    // Only the clock's timers are faked, as in the grouped case below; the faked clock stands still until advanced.
    const fakeClock = () => vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const reportedAgo = (ageMs: number) => new Date(Date.now() - ageMs).toISOString();
    const doorRow = () => screen.getByRole('button', { name: /Door forced open/ });
    const blockIn = (element: HTMLElement) => element.querySelector('[data-attention]');

    afterEach(() => vi.useRealTimers());

    it('ticks every second while an open incident is within ten minutes of its threshold', () => {
      fakeClock();
      // High: 5 minutes. One minute old leaves 4:00.
      renderFeed([{ ...incidents[0]!, reportedAt: reportedAgo(60_000) }]);
      expect(blockIn(doorRow())).toHaveTextContent('4:00 left');

      act(() => vi.advanceTimersByTime(1000));

      expect(blockIn(doorRow())).toHaveTextContent('3:59 left');
    });

    it('ticks every 15 s when no open incident is that close', () => {
      fakeClock();
      // Low: 30 minutes. One minute old leaves 29:00, far from the threshold.
      renderFeed([
        { ...incidents[0]!, severity: 'low', title: 'Slow one', reportedAt: reportedAgo(60_000) },
      ]);
      const slow = () => screen.getByRole('button', { name: /Slow one/ });
      expect(blockIn(slow())).toHaveTextContent('29:00 left');

      act(() => vi.advanceTimersByTime(14_000));
      expect(blockIn(slow())).toHaveTextContent('29:00 left');

      act(() => vi.advanceTimersByTime(1000));
      expect(blockIn(slow())).toHaveTextContent('28:45 left');
    });

    it('takes the countdown off the row at once when the incident is acknowledged', async () => {
      const client = createTestQueryClient();
      const open = { ...incidents[0]!, reportedAt: reportedAgo(60_000) };
      client.setQueryData(queryKeys.incidents, [open]);
      client.setQueryData(queryKeys.zones, [zone]);
      renderWithQueryClient(<IncidentFeed />, client);
      expect(blockIn(doorRow())).not.toBeNull();

      // A newer version, or the cached copy is kept (`mergeIncidentLists`).
      act(() =>
        client.setQueryData(queryKeys.incidents, [
          { ...open, status: 'acknowledged', acknowledgedAt: new Date().toISOString(), version: 2 },
        ]),
      );

      // TanStack tells its observers on a timer, so the row follows a tick later: wait for it, as RTL does.
      await waitFor(() => expect(doorRow()).toHaveAttribute('data-status', 'acknowledged'));
      expect(blockIn(doorRow())).toBeNull();
    });

    it('shows none on the acknowledged or resolved rows of the list', async () => {
      renderFeed([
        ...incidents,
        { ...incidents[0]!, id: 'd', title: 'Done too', status: 'resolved' },
      ]);
      await userEvent.click(screen.getByRole('tab', { name: /^All/ }));

      // Four rows, and only the open one counts down.
      expect(screen.getAllByRole('button', { name: /severity,/ })).toHaveLength(4);
      expect(document.querySelectorAll('[data-attention]')).toHaveLength(1);
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

    it('offers no second Clear search when nothing matches', async () => {
      renderFeed();

      await userEvent.type(searchbox(), 'zzz');

      // The search box's own button clears it; the empty message adds none.
      expect(screen.getAllByRole('button', { name: 'Clear search' })).toHaveLength(1);
    });

    it('focuses the search with /', async () => {
      renderFeed();

      await userEvent.keyboard('/');

      expect(searchbox()).toHaveFocus();
      // The shortcut is handled, not typed.
      expect(searchbox()).toHaveValue('');
    });

    // Both panels stay mounted (`SidePanel`); `/` belongs to the one that is shown.
    describe('while the assets panel is shown', () => {
      afterEach(() => resetStore(useConsole));

      it('leaves / to the asset list', async () => {
        useConsole.setState({ sidePanel: 'assets' });
        renderFeed();

        await userEvent.keyboard('/');

        expect(searchbox()).not.toHaveFocus();
      });
    });

    // WCAG 2.1.4: the account menu's switch turns single-key shortcuts off (UI-16).
    describe('with single-key shortcuts off', () => {
      afterEach(() => resetStore(useConsole));

      it('leaves / alone and shows no hint for it', async () => {
        useConsole.setState({ keyboardShortcuts: false });
        renderFeed();

        expect(searchbox()).not.toHaveAttribute('aria-keyshortcuts');
        expect(screen.queryByText('/', { selector: 'kbd' })).toBeNull();
        await userEvent.keyboard('/');

        expect(searchbox()).not.toHaveFocus();
      });
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

  describe('loading and errors', () => {
    it('shows placeholder rows while the incidents load', () => {
      renderUncached();

      const loading = screen.getByText('Loading incidents…');
      expect(loading).toHaveAttribute('role', 'status');
      expect(loading.parentElement).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByText('Door forced open')).toBeNull();
    });

    it('shows five placeholder rows, the length of a short shift', () => {
      renderUncached();

      // The placeholders have no role or text (they are `aria-hidden` blocks), so they are counted as the busy
      // list's children: the hidden status and `SKELETON_ROWS` (5, in `IncidentFeed.tsx`) rows.
      const busy = screen.getByText('Loading incidents…').parentElement;
      expect(busy?.children).toHaveLength(1 + 5);
    });

    it('says the list could not be loaded, and retries', async () => {
      incidentAnswers = [() => apiError(500, 'Internal server error'), () => json(incidents)];
      renderUncached();

      expect(await screen.findByText('Incidents could not be loaded.')).toBeInTheDocument();
      expect(screen.queryByText(/API is running/)).toBeNull();

      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await screen.findByText('Door forced open')).toBeInTheDocument();
      expect(incidentRequests()).toBe(2);
    });

    it('waits calmly while too many requests are retried', async () => {
      // The console's own policy: a 429 is retried after 2 s, which this case never waits for.
      const client = new QueryClient({
        defaultOptions: { queries: { retry: shouldRetryQuery, retryDelay: queryRetryDelay } },
      });
      incidentAnswers = [() => apiError(429, 'Too many requests')];
      const { unmount } = renderUncached(client);

      const retrying = await screen.findByText(RATE_LIMITED_RETRYING);
      expect(retrying.closest('[role="status"]')).not.toBeNull();
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();

      unmount();
      await client.cancelQueries();
    });

    it('explains too many requests once the retries are over', async () => {
      incidentAnswers = [() => apiError(429, 'Too many requests')];
      renderUncached();

      expect(await screen.findByText(TOO_MANY_REQUESTS)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('keeps the list when a refresh fails', async () => {
      const client = createTestQueryClient();
      client.setQueryData(queryKeys.incidents, incidents);
      incidentAnswers = [() => apiError(500, 'Internal server error')];
      renderUncached(client);

      await act(() => client.refetchQueries({ queryKey: queryKeys.incidents }));

      await waitFor(() => expect(client.getQueryState(queryKeys.incidents)?.status).toBe('error'));
      expect(screen.getByText('Door forced open')).toBeInTheDocument();
      expect(screen.queryByText('Incidents could not be loaded.')).toBeNull();
    });
  });

  describe('while offline', () => {
    it('says how old the list is', () => {
      renderFeed();
      expect(screen.queryByText(/Showing incidents as of/)).toBeNull();

      // A local time, so the text does not depend on the runner's timezone.
      const lostAt = new Date(2026, 9, 8, 15, 2).getTime();
      act(() => useConsole.setState({ offlineSince: lostAt }));

      expect(screen.getByText('Showing incidents as of 15:02')).toBeInTheDocument();
    });
  });

  // ADR-0021: a technician acts on Facilities and Environment only, so their feed trades Resolved
  // for "Mine to handle" and tags the incidents in that scope.
  describe('category scope', () => {
    const scoped: Incident[] = [
      {
        ...base,
        id: 'w',
        code: 'INC-000010',
        type: 'water_leak',
        title: 'Pipe burst',
        status: 'open',
        severity: 'medium',
      },
      {
        ...base,
        id: 'f',
        code: 'INC-000011',
        type: 'flooding',
        title: 'Car park flooded',
        status: 'acknowledged',
        severity: 'high',
      },
      {
        ...base,
        id: 'r',
        code: 'INC-000012',
        type: 'lift_entrapment',
        title: 'Lift stuck',
        status: 'resolved',
        severity: 'high',
      },
      {
        ...base,
        id: 'i',
        code: 'INC-000013',
        type: 'intrusion',
        title: 'Gate forced open',
        status: 'open',
        severity: 'high',
      },
      {
        // A type a newer API sent that this build does not know.
        ...base,
        id: 'u',
        code: 'INC-000014',
        type: 'teleporter_fault' as Incident['type'],
        title: 'Teleporter jammed',
        status: 'open',
        severity: 'low',
      },
    ];
    // Active 4 (w, f, i, u) · Mine to handle 2 (w, f) · Resolved 1 (r) · All 5.
    const outsideOnly: Incident[] = [scoped[3] as Incident];

    const signInAs = (...roles: Role[]) =>
      useSession.getState().signedIn({ displayName: 'Signed-in user', roles });
    const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent);
    const titles = () => screen.getAllByRole('listitem').map((item) => item.textContent ?? '');

    describe('as a technician', () => {
      beforeEach(() => signInAs('technician'));

      it('offers Active, Mine to handle and All, with their counts', () => {
        renderFeed(scoped);

        expect(tabNames()).toEqual(['Active 4', 'Mine to handle 2', 'All 5']);
        expect(screen.queryByRole('tab', { name: /^Resolved/ })).toBeNull();
      });

      it('lists the active Facilities and Environment incidents in Mine to handle', async () => {
        renderFeed(scoped);

        await userEvent.click(screen.getByRole('tab', { name: /^Mine to handle/ }));

        expect(screen.getByRole('tab', { name: /^Mine to handle/ })).toHaveAttribute(
          'aria-selected',
          'true',
        );
        expect(screen.getAllByRole('listitem')).toHaveLength(2);
        expect(screen.getByText('Pipe burst')).toBeInTheDocument();
        expect(screen.getByText('Car park flooded')).toBeInTheDocument();
        // Resolved, outside the scope and of an unknown type: none is theirs to handle.
        expect(screen.queryByText('Lift stuck')).not.toBeInTheDocument();
        expect(screen.queryByText('Gate forced open')).not.toBeInTheDocument();
        expect(screen.queryByText('Teleporter jammed')).not.toBeInTheDocument();
      });

      it('still reaches a resolved incident under All', async () => {
        renderFeed(scoped);

        await userEvent.click(screen.getByRole('tab', { name: /^All/ }));

        expect(screen.getByText('Lift stuck')).toBeInTheDocument();
        expect(titles()).toHaveLength(5);
      });

      it('tags the incidents in scope with their category, and no other', () => {
        renderFeed(scoped);

        expect(within(row(/Pipe burst/)).getByText('Facilities')).toBeInTheDocument();
        expect(within(row(/Car park flooded/)).getByText('Environment')).toBeInTheDocument();
        for (const name of [/Gate forced open/, /Teleporter jammed/]) {
          expect(row(name)).not.toHaveTextContent(/Facilities|Environment|Security/);
        }
      });

      it('puts the tag after the zone and before the code', () => {
        renderFeed(scoped);

        const meta = within(row(/Pipe burst/)).getByText('Facilities').parentElement;

        expect(meta).toHaveTextContent(/Library\s*Facilities\s*INC-000010/);
      });

      it('counts the tabs with the severity filter and the search', async () => {
        useConsole.setState({ severity: 'high' });
        renderFeed(scoped);

        expect(tabNames()).toEqual(['Active 2', 'Mine to handle 1', 'All 3']);

        act(() => useConsole.setState({ severity: null }));
        await userEvent.type(searchbox(), 'pipe');

        expect(tabNames()).toEqual(['Active 1', 'Mine to handle 1', 'All 1']);
      });

      it('lands on Active when the stored filter was Resolved', () => {
        useConsole.setState({ filter: 'resolved' });

        renderFeed(scoped);

        expect(screen.getByRole('tab', { name: /^Active/ })).toHaveAttribute(
          'aria-selected',
          'true',
        );
        expect(screen.getByText('Pipe burst')).toBeInTheDocument();
        expect(screen.queryByText('Lift stuck')).not.toBeInTheDocument();
      });

      it('follows the arrow keys over the three tabs, wrapping', async () => {
        renderFeed(scoped);
        act(() => screen.getByRole('tab', { name: /^Active/ }).focus());

        await userEvent.keyboard('{ArrowRight}');
        expect(screen.getByRole('tab', { name: /^Mine to handle/ })).toHaveFocus();
        expect(screen.getByRole('tab', { name: /^Mine to handle/ })).toHaveAttribute(
          'aria-selected',
          'true',
        );

        await userEvent.keyboard('{ArrowRight}');
        expect(screen.getByRole('tab', { name: /^All/ })).toHaveFocus();

        await userEvent.keyboard('{ArrowRight}');
        expect(screen.getByRole('tab', { name: /^Active/ })).toHaveFocus();
      });

      it('says nothing is theirs to handle, naming the categories', async () => {
        renderFeed(outsideOnly);

        await userEvent.click(screen.getByRole('tab', { name: /^Mine to handle/ }));

        expect(
          screen.getByText('Nothing to handle in Facilities or Environment right now.'),
        ).toBeInTheDocument();
      });

      it('says which severity has nothing to handle, and offers every severity', async () => {
        useConsole.setState({ severity: 'high' });
        renderFeed(outsideOnly);

        await userEvent.click(screen.getByRole('tab', { name: /^Mine to handle/ }));

        expect(
          screen.getByText('No high incidents to handle in Facilities or Environment.'),
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Show all severities' })).toBeInTheDocument();
      });

      it('says what a search found nothing to handle for', async () => {
        renderFeed(scoped);
        await userEvent.click(screen.getByRole('tab', { name: /^Mine to handle/ }));

        await userEvent.type(searchbox(), 'zzz');

        expect(screen.getByText('No incidents to handle match "zzz".')).toBeInTheDocument();
      });
    });

    describe('as everyone else', () => {
      it.each<Role>(['operator', 'supervisor', 'viewer'])(
        'offers a %s Active, Resolved and All, and no tags',
        (role) => {
          signInAs(role);

          renderFeed(scoped);

          expect(tabNames()).toEqual(['Active 4', 'Resolved 1', 'All 5']);
          expect(screen.queryByRole('tab', { name: /^Mine to handle/ })).toBeNull();
          expect(screen.queryByText('Facilities')).not.toBeInTheDocument();
          expect(screen.queryByText('Environment')).not.toBeInTheDocument();
        },
      );

      it('treats a technician who is also an operator as an operator', () => {
        signInAs('technician', 'operator');

        renderFeed(scoped);

        expect(tabNames()).toEqual(['Active 4', 'Resolved 1', 'All 5']);
        expect(screen.queryByText('Facilities')).not.toBeInTheDocument();
      });

      it('lands on Active when the stored filter was Mine to handle', () => {
        signInAs('operator');
        useConsole.setState({ filter: 'mine' });

        renderFeed(scoped);

        expect(screen.getByRole('tab', { name: /^Active/ })).toHaveAttribute(
          'aria-selected',
          'true',
        );
        expect(screen.getByText('Gate forced open')).toBeInTheDocument();
      });
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

  // V3-21.4: during an alarm flood the feed can show one row per zone. It is a view of the same incidents: the flood comes from
  // the list and the clock (`useAlarmLoad`), the choice from the banner's switch, and the filters still apply to the rows.
  describe('grouped by zone', () => {
    const gym: Zone = { ...zone, id: 'z2', code: 'BLD-GYM', name: 'Gym' };
    const dorm: Zone = { ...zone, id: 'z3', code: 'BLD-DORM', name: 'Dormitory' };

    const raisedIncident = (
      id: string,
      zoneId: string,
      severity: Incident['severity'],
      status: Incident['status'] = 'open',
      ageMs = 60_000,
    ): Incident => ({
      ...base,
      id,
      title: `Incident ${id}`,
      zoneId,
      severity,
      status,
      reportedAt: new Date(Date.now() - ageMs).toISOString(),
    });

    /** 12 in the last minute: Gym 4 (worst critical, 3 open), Dormitory 2 (critical, 2 open), Library 6 (high, 6 open). */
    const flood = (ageMs = 60_000): Incident[] => [
      raisedIncident('g1', 'z2', 'critical', 'open', ageMs),
      raisedIncident('g2', 'z2', 'medium', 'open', ageMs),
      raisedIncident('g3', 'z2', 'medium', 'open', ageMs),
      raisedIncident('g4', 'z2', 'medium', 'acknowledged', ageMs),
      raisedIncident('d1', 'z3', 'critical', 'open', ageMs),
      raisedIncident('d2', 'z3', 'high', 'open', ageMs),
      ...['l1', 'l2', 'l3', 'l4', 'l5', 'l6'].map((id) =>
        raisedIncident(id, 'z1', 'high', 'open', ageMs),
      ),
    ];

    /** `zones: null` leaves the zones unanswered, as when they have not arrived. */
    function renderFlood(list: Incident[] = flood(), zones: Zone[] | null = [zone, gym, dorm]) {
      const client = new QueryClient();
      client.setQueryData(queryKeys.incidents, list);
      if (zones) client.setQueryData(queryKeys.zones, zones);
      return render(
        <QueryClientProvider client={client}>
          <IncidentFeed />
        </QueryClientProvider>,
      );
    }

    const choose = () => act(() => useConsole.setState({ groupByZone: true }));
    const groupRows = () => screen.queryAllByRole('button', { name: /, worst / });
    const groupNames = () => groupRows().map((button) => button.getAttribute('aria-label'));
    const GYM = /^Gym, /;
    const DORM = /^Dormitory, /;
    const LIBRARY = /^Library, /;
    const incidentRow = (id: string) =>
      screen.queryByRole('button', { name: new RegExp(`Incident ${id}`) });

    afterEach(() => vi.useRealTimers());

    it('draws the plain list in a flood until the operator chooses to group', () => {
      renderFlood();

      expect(groupRows()).toHaveLength(0);
      expect(screen.queryByText(/Grouped by zone/)).toBeNull();
      expect(incidentRow('g1')).toBeInTheDocument();
    });

    it('draws one row per zone, the worst first, then the larger, then by name', () => {
      renderFlood();
      choose();

      expect(groupNames()).toEqual([
        'Gym, 4 incidents, worst Critical, 3 open',
        'Dormitory, 2 incidents, worst Critical, 2 open',
        'Library, 6 incidents, worst High, 6 open',
      ]);
      expect(incidentRow('g1')).toBeNull();
    });

    it('says the list is grouped, with a way back that is not a live region', () => {
      renderFlood();
      choose();

      const notice = screen.getByText(/Grouped by zone/);
      expect(notice.closest('[role="status"]')).toBeNull();
      expect(screen.getByRole('button', { name: 'Show all' })).toBeInTheDocument();
    });

    it('leaves the tab counts as they were: they count incidents, not groups', () => {
      renderFlood();
      choose();

      expect(screen.getByRole('tab', { name: /^Active/ })).toHaveTextContent('12');
    });

    it('draws the plain list when nothing is flooding, whatever was chosen', () => {
      renderFeed();
      choose();

      expect(groupRows()).toHaveLength(0);
      expect(screen.queryByText(/Grouped by zone/)).toBeNull();
      expect(screen.getByRole('button', { name: /Door forced open/ })).toBeInTheDocument();
    });

    it('draws the plain list until the zones are known, never a list of "Other zone"', () => {
      renderFlood(flood(), null);
      choose();

      expect(groupRows()).toHaveLength(0);
      expect(screen.queryByText(/Other zone/)).toBeNull();
      expect(incidentRow('g1')).toBeInTheDocument();
    });

    it('puts an incident whose zone is not known in "Other zone"', () => {
      renderFlood(flood(), [zone]);
      choose();

      expect(groupNames()).toEqual([
        'Other zone, 6 incidents, worst Critical, 5 open',
        'Library, 6 incidents, worst High, 6 open',
      ]);
    });

    it('keeps the severity filter working on the rows', () => {
      renderFlood();
      act(() => useConsole.setState({ severity: 'critical' }));
      choose();

      expect(groupNames()).toEqual([
        'Dormitory, 1 incident, worst Critical, 1 open',
        'Gym, 1 incident, worst Critical, 1 open',
      ]);
    });

    describe('opening a group', () => {
      it('lists that zone’s incidents under it, and closes again', async () => {
        renderFlood();
        choose();
        const gymRow = screen.getByRole('button', { name: GYM });
        expect(gymRow).toHaveAttribute('aria-expanded', 'false');

        await userEvent.click(gymRow);

        expect(gymRow).toHaveAttribute('aria-expanded', 'true');
        for (const id of ['g1', 'g2', 'g3', 'g4']) expect(incidentRow(id)).toBeInTheDocument();
        expect(incidentRow('d1')).toBeNull();
        expect(incidentRow('l1')).toBeNull();

        await userEvent.click(gymRow);

        expect(gymRow).toHaveAttribute('aria-expanded', 'false');
        expect(incidentRow('g1')).toBeNull();
      });

      it('counts down on the incident rows of the opened group, not on its group row', async () => {
        renderFlood();
        choose();
        const gymRow = screen.getByRole('button', { name: GYM });
        expect(document.querySelector('[data-attention]')).toBeNull();

        await userEvent.click(gymRow);

        // g1, g2 and g3 are open; g4 is acknowledged.
        expect(document.querySelectorAll('[data-attention]')).toHaveLength(3);
        expect(gymRow.querySelector('[data-attention]')).toBeNull();
        expect(incidentRow('g4')!.querySelector('[data-attention]')).toBeNull();
      });

      it('opens the incident of an opened group as a row does anywhere', async () => {
        renderFlood();
        choose();
        await userEvent.click(screen.getByRole('button', { name: GYM }));

        await userEvent.click(incidentRow('g1')!);

        expect(useConsole.getState().selectedIncidentId).toBe('g1');
      });

      it('keeps a zone open when grouping is turned off and on again', async () => {
        renderFlood();
        choose();
        await userEvent.click(screen.getByRole('button', { name: GYM }));

        await userEvent.click(screen.getByRole('button', { name: 'Show all' }));
        choose();

        expect(screen.getByRole('button', { name: GYM })).toHaveAttribute('aria-expanded', 'true');
      });
    });

    describe('going back', () => {
      it('restores the list with "Show all", and puts focus on the selected tab', async () => {
        renderFlood();
        choose();

        await userEvent.click(screen.getByRole('button', { name: 'Show all' }));

        expect(useConsole.getState().groupByZone).toBe(false);
        expect(groupRows()).toHaveLength(0);
        expect(screen.queryByText(/Grouped by zone/)).toBeNull();
        expect(incidentRow('g1')).toBeInTheDocument();
        expect(screen.getByRole('tab', { selected: true })).toHaveFocus();
      });

      it('restores the list when the flood ends, whatever the stored choice says', () => {
        // The flood ends when the clock moves the burst out of the 10-minute window; only the clock's timers are faked.
        vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
        renderFlood(flood(10 * 60_000 - 10_000));
        choose();
        expect(groupRows()).toHaveLength(3);

        act(() => vi.advanceTimersByTime(15_000));

        expect(groupRows()).toHaveLength(0);
        expect(screen.queryByText(/Grouped by zone/)).toBeNull();
        expect(incidentRow('g1')).toBeInTheDocument();
        // Clearing the choice is the flood banner's job; the feed draws the list without it.
        expect(useConsole.getState().groupByZone).toBe(true);
      });
    });

    describe('keyboard', () => {
      it('is a single Tab stop, on the first group', () => {
        renderFlood();
        choose();

        expect(screen.getByRole('button', { name: GYM })).toHaveAttribute('tabindex', '0');
        expect(screen.getByRole('button', { name: DORM })).toHaveAttribute('tabindex', '-1');
        expect(screen.getByRole('button', { name: LIBRARY })).toHaveAttribute('tabindex', '-1');
      });

      it('puts the Tab stop on the group of a selected incident that is inside a closed one', () => {
        useConsole.setState({ selectedIncidentId: 'd1' });
        renderFlood();
        choose();

        expect(screen.getByRole('button', { name: DORM })).toHaveAttribute('tabindex', '0');
        expect(screen.getByRole('button', { name: GYM })).toHaveAttribute('tabindex', '-1');
        expect(incidentRow('d1')).toBeNull();
      });

      it('moves through the groups with the arrow keys, Home and End', async () => {
        renderFlood();
        choose();
        act(() => screen.getByRole('button', { name: GYM }).focus());

        await userEvent.keyboard('{ArrowDown}');
        expect(screen.getByRole('button', { name: DORM })).toHaveFocus();

        await userEvent.keyboard('{End}');
        expect(screen.getByRole('button', { name: LIBRARY })).toHaveFocus();

        // A list does not wrap.
        await userEvent.keyboard('{ArrowDown}');
        expect(screen.getByRole('button', { name: LIBRARY })).toHaveFocus();

        await userEvent.keyboard('{Home}');
        expect(screen.getByRole('button', { name: GYM })).toHaveFocus();
        expect(useConsole.getState().selectedIncidentId).toBeNull();
      });

      it('goes on into an opened group’s incidents and back out of them', async () => {
        renderFlood();
        choose();
        await userEvent.click(screen.getByRole('button', { name: GYM }));
        act(() => screen.getByRole('button', { name: GYM }).focus());

        await userEvent.keyboard('{ArrowDown}');
        // Within a zone the list is in the feed's order: the critical one first.
        expect(incidentRow('g1')).toHaveFocus();
        expect(incidentRow('g1')).toHaveAttribute('tabindex', '0');

        await userEvent.keyboard('{ArrowUp}');
        expect(screen.getByRole('button', { name: GYM })).toHaveFocus();

        await userEvent.keyboard('{End}');
        expect(screen.getByRole('button', { name: LIBRARY })).toHaveFocus();
      });

      it('opens and closes the focused group with Enter and Space', async () => {
        renderFlood();
        choose();
        act(() => screen.getByRole('button', { name: DORM }).focus());

        await userEvent.keyboard('{Enter}');
        expect(screen.getByRole('button', { name: DORM })).toHaveAttribute('aria-expanded', 'true');
        expect(incidentRow('d1')).toBeInTheDocument();

        await userEvent.keyboard(' ');
        expect(screen.getByRole('button', { name: DORM })).toHaveAttribute(
          'aria-expanded',
          'false',
        );
        expect(incidentRow('d1')).toBeNull();
      });
    });
  });
});
