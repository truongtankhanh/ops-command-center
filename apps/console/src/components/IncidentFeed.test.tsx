import type { Incident, Role, Zone } from '@occ/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  queryRetryDelay,
  RATE_LIMITED_RETRYING,
  shouldRetryQuery,
  TOO_MANY_REQUESTS,
} from '../api/client';
import { queryKeys } from '../api/queries';
import { useSession } from '../auth/store';
import { useConsole } from '../store';
import { createTestQueryClient, renderWithQueryClient, resetStore } from '../test-utils';
import { IncidentFeed } from './IncidentFeed';

// No token in these cases; the API client only asks for one.
vi.mock('../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

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
      selectedIncidentId: null,
      reporting: false,
      fresh: new Set(),
      offlineSince: null,
    });
    incidentAnswers = [];
    fetchMock.mockReset().mockImplementation(() => {
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

    it('says the list could not be loaded, and retries', async () => {
      incidentAnswers = [() => apiError(500, 'Internal server error'), () => json(incidents)];
      renderUncached();

      expect(await screen.findByText('Incidents could not be loaded.')).toBeInTheDocument();
      expect(screen.queryByText(/API is running/)).toBeNull();

      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await screen.findByText('Door forced open')).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(2);
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
});
