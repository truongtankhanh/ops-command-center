import type { IncidentDetail as Detail, IncidentEvent, Role, Zone } from '@occ/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from '../api/queries';
import { getAccessToken, renewSession } from '../auth/session';
import { useSession } from '../auth/store';
import { useConsole } from '../store';
import { createTestQueryClient, renderWithQueryClient, resetStore } from '../test-utils';
import { IncidentDetail } from './IncidentDetail';

// The session module is tested on its own; here it only decides which token the client sends.
vi.mock('../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const OPERATOR_SUBJECT = 'f3b1c2d4-5e6f-4a1b-9c8d-7e6f5a4b3c2d';
const NOTE_LABEL = 'Note for the timeline (optional)';
const NOTE_KEPT = 'Esc keeps your note. Close discards it.';

const zone: Zone = {
  id: '6f1c2b1e-0000-4000-8000-000000000001',
  code: 'BLD-LIB',
  name: 'Library',
  kind: 'building',
  polygon: [],
  center: [108.44, 11.95],
};

const operatorActor = {
  kind: 'user',
  subject: OPERATOR_SUBJECT,
  displayName: 'Demo Operator',
} as const;
const simulatorActor = { kind: 'system', subject: 'simulator', displayName: 'Simulator' } as const;

const event = (
  id: string,
  kind: IncidentEvent['kind'],
  actor: IncidentEvent['actor'],
): IncidentEvent => ({ id, kind, note: null, at: '2026-10-01T08:00:00.000Z', actor });

/** An open incident whose timeline has one entry by a person and one by the system. */
function detail(overrides: Partial<Detail> = {}): Detail {
  return {
    id: 'incident-1',
    code: 'INC-000042',
    type: 'intrusion',
    severity: 'high',
    status: 'open',
    title: 'Door forced open',
    description: null,
    zoneId: zone.id,
    position: zone.center,
    source: 'operator',
    reportedAt: '2026-10-01T08:00:00.000Z',
    acknowledgedAt: null,
    resolvedAt: null,
    version: 1,
    timeline: [
      event('event-1', 'reported', operatorActor),
      event('event-2', 'acknowledged', simulatorActor),
    ],
    ...overrides,
  };
}

const fetchMock = vi.fn<typeof fetch>();
/** What a transition (`POST`) answers in the current case. */
let postResponse: () => Response;

/** A body can be read only once, so build one per call. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function apiError(status: number, message: string): Response {
  return json({ statusCode: status, message }, status);
}

const postCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

function signInAs(role: Role) {
  useSession.getState().signedIn({ displayName: 'Signed-in user', roles: [role] });
}

/** Everything the panel reads is already cached, so its first render is the detail. */
function renderDetail(incident = detail()) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.incident(incident.id), incident);
  client.setQueryData(queryKeys.zones, [zone]);
  // No camera: CameraTile would request a stream and draw on a canvas jsdom does not have.
  client.setQueryData(queryKeys.cameras, []);
  return renderWithQueryClient(<IncidentDetail id={incident.id} />, client);
}

describe('IncidentDetail', () => {
  beforeEach(() => {
    resetStore(useSession);
    resetStore(useConsole);
    postResponse = () => {
      throw new Error('No transition expected in this case');
    };
    // The detail query is stale at once (default staleTime), so mounting refetches it. That GET
    // stays pending and the cached detail stays on screen; transitions get the case's answer.
    fetchMock
      .mockReset()
      .mockImplementation((_url, init) =>
        init?.method === 'POST' ? Promise.resolve(postResponse()) : new Promise<Response>(() => {}),
      );
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(getAccessToken).mockReset().mockResolvedValue(null);
    vi.mocked(renewSession).mockReset().mockResolvedValue(false);
  });

  afterEach(() => vi.unstubAllGlobals());

  describe('timeline', () => {
    beforeEach(() => signInAs('operator'));

    it('shows who caused each timeline entry', () => {
      renderDetail();

      expect(screen.getByText('Demo Operator')).toBeInTheDocument();
      expect(screen.getByText('Simulator')).toBeInTheDocument();
    });

    it('marks system entries apart from people', () => {
      renderDetail();

      // The attribute styles system actors; their names already say they are not people.
      expect(screen.getByText('Simulator').closest('li')).toHaveAttribute(
        'data-actor-kind',
        'system',
      );
      expect(screen.getByText('Demo Operator').closest('li')).toHaveAttribute(
        'data-actor-kind',
        'user',
      );
    });

    it("never shows an actor's subject", () => {
      renderDetail();

      expect(screen.queryByText(OPERATOR_SUBJECT)).toBeNull();
      expect(screen.queryByText('simulator')).toBeNull();
    });
  });

  describe('actions', () => {
    it.each<Role>(['operator', 'supervisor'])(
      'offers Acknowledge and Resolve on an open incident to %s',
      (role) => {
        signInAs(role);

        renderDetail();

        expect(screen.getByRole('heading', { name: 'Response' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Acknowledge' })).toHaveAttribute(
          'data-variant',
          'primary',
        );
        expect(screen.getByRole('button', { name: 'Resolve' })).not.toHaveAttribute('data-variant');
      },
    );

    it('offers only Resolve, as the main action, once acknowledged', () => {
      signInAs('operator');

      renderDetail(detail({ status: 'acknowledged' }));

      expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Resolve' })).toHaveAttribute(
        'data-variant',
        'primary',
      );
    });

    it('offers no response to a viewer', () => {
      signInAs('viewer');

      renderDetail();

      expect(screen.queryByRole('heading', { name: 'Response' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
      expect(screen.queryByLabelText(NOTE_LABEL)).toBeNull();
      // Reading is still allowed.
      expect(screen.getByRole('heading', { name: 'Timeline' })).toBeInTheDocument();
      expect(screen.getByText('Demo Operator')).toBeInTheDocument();
    });

    it('offers no response on a resolved incident', () => {
      signInAs('operator');

      renderDetail(detail({ status: 'resolved' }));

      expect(screen.queryByRole('heading', { name: 'Response' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
    });
  });

  describe('closing', () => {
    beforeEach(() => {
      signInAs('operator');
      useConsole.setState({ selectedIncidentId: detail().id });
    });

    it('closes on Escape while there is no note', async () => {
      renderDetail();

      await userEvent.keyboard('{Escape}');

      expect(useConsole.getState().selectedIncidentId).toBeNull();
    });

    it('stays open with the note on Escape, but still closes on Close', async () => {
      renderDetail();
      await userEvent.type(screen.getByLabelText(NOTE_LABEL), 'Guard dispatched');

      await userEvent.keyboard('{Escape}');
      expect(useConsole.getState().selectedIncidentId).toBe(detail().id);
      expect(screen.getByLabelText(NOTE_LABEL)).toHaveValue('Guard dispatched');

      await userEvent.click(screen.getByRole('button', { name: 'Close incident' }));
      expect(useConsole.getState().selectedIncidentId).toBeNull();
    });

    // Switching to another incident or to the report form unmounts the detail: the note survives it.
    it('keeps the note in the store until it is cleared', async () => {
      const { unmount } = renderDetail();
      const note = () => useConsole.getState().noteDrafts[detail().id];
      expect(note()).toBeUndefined();

      await userEvent.type(screen.getByLabelText(NOTE_LABEL), 'Guard');
      expect(note()).toBe('Guard');

      await userEvent.clear(screen.getByLabelText(NOTE_LABEL));
      expect(note()).toBeUndefined();

      await userEvent.type(screen.getByLabelText(NOTE_LABEL), 'Guard');
      unmount();
      expect(note()).toBe('Guard');

      renderDetail();
      expect(screen.getByLabelText(NOTE_LABEL)).toHaveValue('Guard');
    });

    it('discards the note only on Close', async () => {
      renderDetail();
      await userEvent.type(screen.getByLabelText(NOTE_LABEL), 'Guard');

      await userEvent.click(screen.getByRole('button', { name: 'Close incident' }));

      expect(useConsole.getState().selectedIncidentId).toBeNull();
      expect(useConsole.getState().noteDrafts).not.toHaveProperty(detail().id);
    });

    it('explains what Escape does while a note is written', async () => {
      renderDetail();
      const close = screen.getByRole('button', { name: 'Close incident' });
      const hint = () => screen.queryByText(NOTE_KEPT, { selector: 'p' });
      expect(hint()).toBeNull();
      expect(close).toHaveAttribute('aria-keyshortcuts', 'Escape');

      await userEvent.type(screen.getByLabelText(NOTE_LABEL), 'Guard');
      expect(hint()).toHaveAttribute('data-tone', 'info');
      // Escape no longer closes, so the key is not offered on Close.
      expect(close).not.toHaveAttribute('aria-keyshortcuts');

      await userEvent.keyboard('{Escape}');
      expect(hint()).toHaveAttribute('data-tone', 'warning');
      const sheet = screen.getByRole('complementary', { name: 'Incident INC-000042' });
      expect(within(sheet).getByRole('status')).toHaveTextContent(NOTE_KEPT);
      expect(useConsole.getState().selectedIncidentId).toBe(detail().id);

      // A cleared note forgets the warning: the next one starts with the plain hint.
      await userEvent.clear(screen.getByLabelText(NOTE_LABEL));
      expect(hint()).toBeNull();
      await userEvent.type(screen.getByLabelText(NOTE_LABEL), 'G');
      expect(hint()).toHaveAttribute('data-tone', 'info');
    });

    it('names the sheet after the incident, and moves focus to it', () => {
      renderDetail();

      expect(screen.getByRole('complementary', { name: 'Incident INC-000042' })).toHaveFocus();
    });

    it('names the sheet while the incident is still loading', () => {
      const client = createTestQueryClient();
      client.setQueryData(queryKeys.zones, [zone]);
      client.setQueryData(queryKeys.cameras, []);
      // Not cached: the GET stays pending in this file's fetch mock.
      renderWithQueryClient(<IncidentDetail id="incident-9" />, client);

      expect(screen.getByRole('complementary', { name: 'Incident' })).toHaveFocus();
    });
  });

  describe('transitions', () => {
    beforeEach(() => signInAs('operator'));

    it("shows who acknowledged, from the API's answer", async () => {
      const reported = event('event-1', 'reported', simulatorActor);
      postResponse = () =>
        json(
          detail({
            status: 'acknowledged',
            acknowledgedAt: '2026-10-01T08:05:00.000Z',
            version: 2,
            timeline: [reported, event('event-3', 'acknowledged', operatorActor)],
          }),
        );
      renderDetail(detail({ timeline: [reported] }));
      expect(screen.queryByText('Demo Operator')).toBeNull();

      await userEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));

      expect(await screen.findByText('Demo Operator')).toBeInTheDocument();
      expect(postCalls()).toHaveLength(1);
      expect(postCalls()[0]![0]).toBe('/api/incidents/incident-1/acknowledge');
    });

    it('clears the note once it is sent', async () => {
      postResponse = () =>
        json(
          detail({
            status: 'acknowledged',
            acknowledgedAt: '2026-10-01T08:05:00.000Z',
            version: 2,
          }),
        );
      renderDetail();
      await userEvent.type(screen.getByLabelText(NOTE_LABEL), 'Guard');

      await userEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));

      await waitFor(() => expect(useConsole.getState().noteDrafts).not.toHaveProperty(detail().id));
      expect(postCalls()).toHaveLength(1);
    });

    it('explains a 403 in operator terms and keeps the note', async () => {
      // A token and a renewal that would succeed, so renewing on a 403 would be visible.
      vi.mocked(getAccessToken).mockResolvedValue('token-1');
      vi.mocked(renewSession).mockResolvedValue(true);
      postResponse = () => apiError(403, 'Missing permission: incident:acknowledge');
      renderDetail();
      await userEvent.type(screen.getByLabelText(NOTE_LABEL), 'Guard on the way');

      await userEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Your account is no longer allowed to do this.');
      expect(alert).not.toHaveTextContent('Missing permission');
      expect(screen.getByLabelText(NOTE_LABEL)).toHaveValue('Guard on the way');
      expect(renewSession).not.toHaveBeenCalled();
      expect(postCalls()).toHaveLength(1);
    });

    it("shows the API's message for any other refusal", async () => {
      const message = 'INC-000042 cannot be acknowledged: it is already acknowledged';
      postResponse = () => apiError(409, message);
      renderDetail();

      await userEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(message);
    });
  });
});
