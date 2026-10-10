import type { IncidentDetail as Detail, IncidentEvent, Role, Zone } from '@occ/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TOO_MANY_REQUESTS } from '../api/client';
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
/** The sheet's footer with the note and the actions. */
const RESPONSE = { name: 'Response' };

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

/** A time `minutes` before now: durations and relative times then read the same on every run. */
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

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
/** What a transition (`POST`) answers in the current case; a never-settling promise keeps it pending. */
let postResponse: () => Response | Promise<Response>;
/** What the next detail `GET`s answer, one factory per request; once empty, a `GET` stays pending. */
let getAnswers: (() => Response)[];
/** What `GET /cameras` answers, apart from the detail's queue; unset, it stays pending. */
let camerasAnswer: (() => Response) | undefined;

/** A body can be read only once, so build one per call. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function apiError(status: number, message: string): Response {
  return json({ statusCode: status, message }, status);
}

const postCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
const getCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method !== 'POST');

function signInAs(role: Role) {
  useSession.getState().signedIn({ displayName: 'Signed-in user', roles: [role] });
}

/** Everything the panel reads is already cached, so its first render is the detail. */
function renderDetail(incident = detail(), zones: Zone[] = [zone]) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.incident(incident.id), incident);
  client.setQueryData(queryKeys.zones, zones);
  // No camera: CameraTile would request a stream and draw on a canvas jsdom does not have.
  client.setQueryData(queryKeys.cameras, []);
  return renderWithQueryClient(<IncidentDetail id={incident.id} />, client);
}

/** The incident itself is not cached: the panel starts loading it. */
function renderUncached(id = detail().id) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.zones, [zone]);
  client.setQueryData(queryKeys.cameras, []);
  return renderWithQueryClient(<IncidentDetail id={id} />, client);
}

/** The incident is cached, the camera list is not: the camera section asks for it (`camerasAnswer`). */
function renderWithoutCameras(incident = detail()) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.incident(incident.id), incident);
  client.setQueryData(queryKeys.zones, [zone]);
  return renderWithQueryClient(<IncidentDetail id={incident.id} />, client);
}

/** The value next to a metric's label ("Open for", "Time to acknowledge"). */
const metric = (label: string) => screen.getByText(label).nextElementSibling as HTMLElement;

const lifecycleSteps = () =>
  within(screen.getByRole('list', { name: 'Lifecycle' })).getAllByRole('listitem');

describe('IncidentDetail', () => {
  beforeEach(() => {
    resetStore(useSession);
    resetStore(useConsole);
    postResponse = () => {
      throw new Error('No transition expected in this case');
    };
    getAnswers = [];
    camerasAnswer = undefined;
    // The detail query is stale at once (default staleTime), so mounting refetches it. Unless the
    // case queues an answer, that GET stays pending and the cached detail stays on screen;
    // transitions get the case's answer.
    fetchMock.mockReset().mockImplementation((url, init) => {
      if (init?.method === 'POST') return Promise.resolve(postResponse());
      if (String(url).endsWith('/cameras')) {
        return camerasAnswer ? Promise.resolve(camerasAnswer()) : new Promise<Response>(() => {});
      }
      const answer = getAnswers.shift();
      return answer ? Promise.resolve(answer()) : new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(getAccessToken).mockReset().mockResolvedValue(null);
    vi.mocked(renewSession).mockReset().mockResolvedValue(false);
  });

  afterEach(() => vi.unstubAllGlobals());

  describe('head', () => {
    beforeEach(() => signInAs('operator'));

    it('shows severity, type and zone as badges, not a status chip', () => {
      renderDetail();

      expect(screen.getByText('High')).toBeInTheDocument();
      expect(screen.getByText('Intrusion')).toBeInTheDocument();
      expect(screen.getByText('Library')).toBeInTheDocument();
      // The lifecycle stepper carries the status.
      expect(screen.queryByText('Open')).toBeNull();
      expect(screen.queryByText('Being handled')).toBeNull();
    });

    it('shows the incident category on a chip between the type and the zone', () => {
      renderDetail();

      const follows = (before: HTMLElement, after: HTMLElement) =>
        Boolean(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING);
      const type = screen.getByText('Intrusion');
      const category = screen.getByText('Security');
      const zoneChip = screen.getByText('Library');
      expect(follows(type, category)).toBe(true);
      expect(follows(category, zoneChip)).toBe(true);
    });

    it("shows the category of the incident's own type", () => {
      renderDetail(detail({ type: 'water_leak' }));

      expect(screen.getByText('Water leak')).toBeInTheDocument();
      expect(screen.getByText('Facilities')).toBeInTheDocument();
      expect(screen.queryByText('Security')).toBeNull();
    });

    // A newer API can send a type or zone kind this build's contract lacks (ADR-0021, rolling
    // deploys); the type system cannot model them, hence the casts.
    it('shows no category chip for a type this console does not know', () => {
      renderDetail(detail({ type: 'not_in_contract' as Detail['type'] }));

      for (const label of [
        'Security',
        'Fire & safety',
        'Medical',
        'Facilities',
        'Environment',
        'Traffic',
      ]) {
        expect(screen.queryByText(label)).toBeNull();
      }
      // The raw id still names the type, and the zone chip is still there.
      expect(screen.getByText('not_in_contract')).toBeInTheDocument();
      expect(screen.getByText('Library')).toBeInTheDocument();
    });

    it('names a type this console does not know by its raw id', () => {
      renderDetail(detail({ type: 'not_in_contract' as Detail['type'] }));

      expect(screen.getByText('not_in_contract')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Door forced open' })).toBeInTheDocument();
    });

    it('still shows the zone when its kind is one this console does not know', () => {
      renderDetail(detail(), [{ ...zone, kind: 'not_in_contract' as Zone['kind'] }]);

      expect(screen.getByText('Library')).toBeInTheDocument();
    });

    it('shows an open incident waiting for acknowledgement', () => {
      const reportedAt = minutesAgo(14);
      renderDetail(detail({ reportedAt }));

      const steps = lifecycleSteps();
      expect(steps).toHaveLength(3);
      expect(steps[0]!.querySelector('time')).toHaveAttribute('datetime', reportedAt);
      expect(steps[1]).toHaveAttribute('aria-current', 'step');
      expect(steps[1]).toHaveTextContent('Waiting');
      expect(steps[2]).not.toHaveAttribute('aria-current');
      expect(metric('Open for')).toHaveTextContent('14m');
      expect(metric('Time to acknowledge')).toHaveTextContent('Not yet');
    });

    it('shows how long acknowledging took', () => {
      renderDetail(
        detail({
          status: 'acknowledged',
          reportedAt: minutesAgo(20),
          acknowledgedAt: minutesAgo(15),
        }),
      );

      expect(metric('Time to acknowledge')).toHaveTextContent('5m');
      expect(lifecycleSteps()[2]).toHaveAttribute('aria-current', 'step');
    });

    it("shows a resolved incident's final open time", () => {
      renderDetail(
        detail({
          status: 'resolved',
          reportedAt: minutesAgo(200),
          acknowledgedAt: minutesAgo(190),
          resolvedAt: minutesAgo(105),
        }),
      );

      expect(metric('Was open for')).toHaveTextContent('1h 35m');
      expect(screen.queryByText('Open for')).toBeNull();
      for (const step of lifecycleSteps()) expect(step).not.toHaveAttribute('aria-current');
    });

    it('marks acknowledging as skipped when resolved from open', () => {
      renderDetail(
        detail({ status: 'resolved', reportedAt: minutesAgo(30), resolvedAt: minutesAgo(10) }),
      );

      expect(lifecycleSteps()[1]).toHaveTextContent('Skipped');
      expect(metric('Time to acknowledge')).toHaveTextContent('Skipped');
    });

    it('flags an open incident past its attention time', () => {
      // High severity: the attention threshold is 5 minutes.
      const { unmount } = renderDetail(detail({ reportedAt: minutesAgo(14) }));
      expect(metric('Open for')).toHaveAttribute('data-late');
      expect(metric('Open for')).toHaveTextContent('past attention time');
      unmount();

      // Acknowledging clears the flag, whatever the age.
      renderDetail(
        detail({
          status: 'acknowledged',
          reportedAt: minutesAgo(14),
          acknowledgedAt: minutesAgo(10),
        }),
      );
      expect(metric('Open for')).not.toHaveAttribute('data-late');
    });
  });

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

    it('shows when each entry happened, in clock and relative time', () => {
      const reportedAt = minutesAgo(14);
      const acknowledgedAt = new Date().toISOString();
      renderDetail(
        detail({
          timeline: [
            { ...event('event-1', 'reported', operatorActor), at: reportedAt },
            { ...event('event-2', 'acknowledged', simulatorActor), at: acknowledgedAt },
          ],
        }),
      );

      const reported = screen.getByText('Demo Operator').closest('li')!.querySelector('time');
      expect(reported).toHaveAttribute('datetime', reportedAt);
      expect(reported).toHaveTextContent(/14m ago$/);
      const acknowledged = screen.getByText('Simulator').closest('li')!.querySelector('time');
      expect(acknowledged).toHaveAttribute('datetime', acknowledgedAt);
      expect(acknowledged).toHaveTextContent(/just now$/);
    });
  });

  describe('actions', () => {
    it.each<Role>(['operator', 'supervisor'])(
      'offers Acknowledge and Resolve on an open incident to %s',
      (role) => {
        signInAs(role);

        renderDetail();

        expect(screen.getByRole('form', RESPONSE)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Acknowledge' })).toHaveAttribute(
          'data-variant',
          'primary',
        );
        // One primary action at a time; a bordered secondary would fail 3:1 on the footer.
        expect(screen.getByRole('button', { name: 'Resolve' })).toHaveAttribute(
          'data-variant',
          'ghost',
        );
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

    it('offers a viewer a view-only footer instead of a response', () => {
      signInAs('viewer');

      renderDetail();

      expect(screen.queryByRole('form', RESPONSE)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
      expect(screen.queryByLabelText(NOTE_LABEL)).toBeNull();
      const note = screen.getByRole('note');
      expect(note).toHaveTextContent('View only');
      expect(note).toHaveTextContent(
        'Acknowledging and resolving need the operator or supervisor role.',
      );
      // Reading is still allowed.
      expect(screen.getByRole('heading', { name: 'Timeline' })).toBeInTheDocument();
      expect(screen.getByText('Demo Operator')).toBeInTheDocument();
    });

    it('offers an operator both actions on a type this console does not know', () => {
      signInAs('operator');

      renderDetail(detail({ type: 'not_in_contract' as Detail['type'] }));

      expect(screen.getByRole('form', RESPONSE)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
      expect(screen.queryByRole('note')).toBeNull();
    });

    it('offers no response on a resolved incident', () => {
      signInAs('operator');

      renderDetail(detail({ status: 'resolved' }));

      expect(screen.queryByRole('form', RESPONSE)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
      // The operator may act, there is just nothing left to do: no view-only footer either.
      expect(screen.queryByRole('note')).toBeNull();
    });
  });

  // ADR-0021: a technician acts on Facilities and Environment incidents only; the API answers 403
  // for the rest, so the sheet says why there is no response instead of offering one.
  describe('technician scope', () => {
    beforeEach(() => signInAs('technician'));

    it.each<Detail['type']>(['water_leak', 'flooding'])(
      'offers Acknowledge and Resolve on %s, as to an operator',
      (type) => {
        renderDetail(detail({ type }));

        expect(screen.getByRole('form', RESPONSE)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Acknowledge' })).toHaveAttribute(
          'data-variant',
          'primary',
        );
        expect(screen.getByRole('button', { name: 'Resolve' })).toHaveAttribute(
          'data-variant',
          'ghost',
        );
        expect(screen.queryByRole('note')).toBeNull();
      },
    );

    it('offers only Resolve once an in-scope incident is acknowledged', () => {
      renderDetail(detail({ type: 'water_leak', status: 'acknowledged' }));

      expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
    });

    it('ends an out-of-scope incident in a note, not in the response form', () => {
      renderDetail(detail({ type: 'intrusion' }));

      expect(screen.queryByRole('form', RESPONSE)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
      expect(screen.queryByLabelText(NOTE_LABEL)).toBeNull();
      const note = screen.getByRole('note');
      expect(note).toHaveAttribute('data-footer', 'out-of-scope');
      expect(note).toHaveTextContent('Security incidents are handled by operators');
      expect(note).toHaveTextContent('You can follow this one and report new incidents.');
      // The viewer's footer says something else, and is not this one.
      expect(note).not.toHaveTextContent('View only');
      // Reading is still allowed.
      expect(screen.getByRole('heading', { name: 'Timeline' })).toBeInTheDocument();
    });

    it.each<[Detail['type'], string]>([
      ['intrusion', 'Security'],
      ['fire_alarm', 'Fire & safety'],
      ['medical', 'Medical'],
      ['traffic_accident', 'Traffic'],
    ])('names the category of %s in the note', (type, label) => {
      renderDetail(detail({ type }));

      expect(screen.getByRole('note')).toHaveTextContent(
        `${label} incidents are handled by operators`,
      );
    });

    it('treats a type this console does not know as out of scope', () => {
      renderDetail(detail({ type: 'not_in_contract' as Detail['type'] }));

      expect(screen.queryByRole('form', RESPONSE)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
      expect(screen.getByRole('note')).toHaveTextContent(
        'Incidents of this type are handled by operators',
      );
    });

    it.each<Detail['status']>(['open', 'acknowledged', 'resolved'])(
      'keeps the note on an out-of-scope incident that is %s',
      (status) => {
        renderDetail(detail({ type: 'intrusion', status }));

        expect(screen.getByRole('note')).toHaveAttribute('data-footer', 'out-of-scope');
        expect(screen.queryByRole('form', RESPONSE)).toBeNull();
      },
    );

    it('shows nothing at the foot of a resolved in-scope incident', () => {
      renderDetail(detail({ type: 'water_leak', status: 'resolved' }));

      expect(screen.queryByRole('form', RESPONSE)).toBeNull();
      expect(screen.queryByRole('note')).toBeNull();
    });
  });

  describe('shortcuts', () => {
    it('acknowledges on A', async () => {
      signInAs('operator');
      postResponse = () =>
        json(detail({ status: 'acknowledged', acknowledgedAt: minutesAgo(0), version: 2 }));
      renderDetail();
      expect(screen.getByRole('button', { name: 'Acknowledge' })).toHaveAttribute(
        'aria-keyshortcuts',
        'A',
      );
      expect(screen.getByRole('button', { name: 'Resolve' })).toHaveAttribute(
        'aria-keyshortcuts',
        'R',
      );

      // Focus is on the sheet, which opened with it.
      await userEvent.keyboard('a');

      await waitFor(() => expect(postCalls()).toHaveLength(1));
      expect(postCalls()[0]![0]).toBe('/api/incidents/incident-1/acknowledge');
    });

    it('never acknowledges while typing the note', async () => {
      signInAs('operator');
      renderDetail();

      await userEvent.type(screen.getByLabelText(NOTE_LABEL), 'a');

      expect(screen.getByLabelText(NOTE_LABEL)).toHaveValue('a');
      expect(postCalls()).toHaveLength(0);
    });

    it('resolves a non-critical incident on R at once', async () => {
      signInAs('operator');
      postResponse = () =>
        json(detail({ status: 'resolved', resolvedAt: minutesAgo(0), version: 2 }));
      renderDetail();

      await userEvent.keyboard('r');

      await waitFor(() => expect(postCalls()).toHaveLength(1));
      expect(postCalls()[0]![0]).toBe('/api/incidents/incident-1/resolve');
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('does nothing on A or R for a technician out of scope', async () => {
      signInAs('technician');
      renderDetail(detail({ type: 'intrusion' }));

      await userEvent.keyboard('a');
      await userEvent.keyboard('r');

      expect(postCalls()).toHaveLength(0);
    });

    it('acknowledges on A for a technician in scope', async () => {
      signInAs('technician');
      postResponse = () =>
        json(
          detail({
            type: 'water_leak',
            status: 'acknowledged',
            acknowledgedAt: minutesAgo(0),
            version: 2,
          }),
        );
      renderDetail(detail({ type: 'water_leak' }));

      await userEvent.keyboard('a');

      await waitFor(() => expect(postCalls()).toHaveLength(1));
      expect(postCalls()[0]![0]).toBe('/api/incidents/incident-1/acknowledge');
    });

    it('offers no shortcut without the action', async () => {
      signInAs('viewer');
      const { unmount } = renderDetail();
      await userEvent.keyboard('a');
      await userEvent.keyboard('r');
      unmount();

      resetStore(useSession);
      signInAs('operator');
      renderDetail(detail({ status: 'resolved' }));
      await userEvent.keyboard('a');
      await userEvent.keyboard('r');

      expect(postCalls()).toHaveLength(0);
    });

    it('offers no A or R while single-key shortcuts are off', async () => {
      signInAs('operator');
      useConsole.setState({ keyboardShortcuts: false });
      renderDetail();

      expect(screen.getByRole('button', { name: 'Acknowledge' })).not.toHaveAttribute(
        'aria-keyshortcuts',
      );
      expect(screen.getByRole('button', { name: 'Resolve' })).not.toHaveAttribute(
        'aria-keyshortcuts',
      );
      await userEvent.keyboard('a');
      await userEvent.keyboard('r');

      expect(postCalls()).toHaveLength(0);
    });

    it('takes no second shortcut while a transition is pending', async () => {
      signInAs('operator');
      postResponse = () => new Promise<Response>(() => {});
      renderDetail();

      await userEvent.keyboard('a');
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Acknowledge' })).not.toHaveAttribute(
          'aria-keyshortcuts',
        ),
      );
      await userEvent.keyboard('a');

      // The first request is on its way (the token is read first); the second key sent nothing.
      await waitFor(() => expect(postCalls()).toHaveLength(1));
    });
  });

  // UI-16 Q6: the button that had focus goes with the step it took; focus must not fall to the body.
  describe('focus after a response', () => {
    const acknowledgeButton = () => screen.getByRole('button', { name: 'Acknowledge' });
    const resolveButton = () => screen.getByRole('button', { name: 'Resolve' });
    const theSheet = () => screen.getByRole('complementary', { name: 'Incident INC-000042' });
    const acknowledged = () =>
      detail({ status: 'acknowledged', acknowledgedAt: minutesAgo(0), version: 2 });

    beforeEach(() => signInAs('operator'));

    it('moves focus to Resolve once acknowledged', async () => {
      postResponse = () => json(acknowledged());
      renderDetail();

      await userEvent.click(acknowledgeButton());

      await waitFor(() => expect(resolveButton()).toHaveFocus());
    });

    // A live update, as `useLiveIncidents` writes it. The query notifies its observers on a later
    // tick, so the assertions wait for the Acknowledge button to go.
    it('moves focus to Resolve when someone else acknowledges', async () => {
      const { client } = renderDetail();
      act(() => acknowledgeButton().focus());

      act(() => client.setQueryData(queryKeys.incident(detail().id), acknowledged()));

      await waitFor(() => expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull());
      expect(resolveButton()).toHaveFocus();
    });

    it('leaves focus in the note when someone else acknowledges', async () => {
      const { client } = renderDetail();
      act(() => screen.getByLabelText(NOTE_LABEL).focus());

      act(() => client.setQueryData(queryKeys.incident(detail().id), acknowledged()));

      await waitFor(() => expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull());
      expect(screen.getByLabelText(NOTE_LABEL)).toHaveFocus();
    });

    it('moves focus to the sheet once resolved, so Escape still closes it', async () => {
      useConsole.setState({ selectedIncidentId: detail().id });
      postResponse = () =>
        json(detail({ status: 'resolved', resolvedAt: minutesAgo(0), version: 2 }));
      renderDetail();

      await userEvent.click(resolveButton());

      await waitFor(() => expect(theSheet()).toHaveFocus());
      await userEvent.keyboard('{Escape}');
      expect(useConsole.getState().selectedIncidentId).toBeNull();
    });

    it('does not take focus when an acknowledged incident opens', () => {
      renderDetail(acknowledged());

      expect(theSheet()).toHaveFocus();
      expect(resolveButton()).not.toHaveFocus();
    });
  });

  describe('resolve confirmation', () => {
    const critical = () => detail({ severity: 'critical' });
    const confirmation = () =>
      screen.queryByRole('dialog', { name: 'Resolve INC-000042 without a note?' });

    beforeEach(() => {
      signInAs('operator');
      useConsole.setState({ selectedIncidentId: detail().id });
    });

    it('asks before resolving a critical incident without a note', async () => {
      renderDetail(critical());

      await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));

      expect(confirmation()).toHaveTextContent(
        'Critical incidents are normally resolved with a note for the timeline.',
      );
      // The safe choice first, so Enter right away never resolves.
      expect(screen.getByRole('button', { name: 'Add a note' })).toHaveFocus();
      expect(postCalls()).toHaveLength(0);
    });

    it('resolves after confirming', async () => {
      postResponse = () =>
        json(
          detail({
            severity: 'critical',
            status: 'resolved',
            resolvedAt: minutesAgo(0),
            version: 2,
          }),
        );
      renderDetail(critical());

      await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));
      await userEvent.click(screen.getByRole('button', { name: 'Resolve without note' }));

      expect(confirmation()).toBeNull();
      await waitFor(() => expect(postCalls()).toHaveLength(1));
      expect(postCalls()[0]![0]).toBe('/api/incidents/incident-1/resolve');
      expect(postCalls()[0]![1]!.body).toBe('{}');
    });

    it('cancels on Escape and keeps the sheet open', async () => {
      renderDetail(critical());
      await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));

      await userEvent.keyboard('{Escape}');

      expect(confirmation()).toBeNull();
      expect(postCalls()).toHaveLength(0);
      // The dialog took the key: the sheet behind it did not close.
      expect(useConsole.getState().selectedIncidentId).toBe(detail().id);
    });

    it('goes to the note from the dialog', async () => {
      renderDetail(critical());
      await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));

      await userEvent.click(screen.getByRole('button', { name: 'Add a note' }));

      expect(confirmation()).toBeNull();
      expect(screen.getByLabelText(NOTE_LABEL)).toHaveFocus();
      expect(postCalls()).toHaveLength(0);
    });

    it('asks on R as well, and ignores A meanwhile', async () => {
      renderDetail(critical());

      await userEvent.keyboard('r');
      expect(confirmation()).toBeInTheDocument();

      await userEvent.keyboard('a');
      expect(confirmation()).toBeInTheDocument();
      expect(postCalls()).toHaveLength(0);
    });

    it('resolves a critical incident with a note at once', async () => {
      postResponse = () =>
        json(
          detail({
            severity: 'critical',
            status: 'resolved',
            resolvedAt: minutesAgo(0),
            version: 2,
          }),
        );
      renderDetail(critical());
      await userEvent.type(screen.getByLabelText(NOTE_LABEL), 'Fire out');

      await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));

      expect(confirmation()).toBeNull();
      await waitFor(() => expect(postCalls()).toHaveLength(1));
      expect(postCalls()[0]![1]!.body).toBe(JSON.stringify({ note: 'Fire out' }));
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
      // Not cached: the GET stays pending in this file's fetch mock.
      renderUncached('incident-9');

      expect(screen.getByRole('complementary', { name: 'Incident' })).toHaveFocus();
    });
  });

  describe('loading and errors', () => {
    beforeEach(() => {
      signInAs('operator');
      useConsole.setState({ selectedIncidentId: detail().id });
    });

    it('shows a skeleton while the incident loads, and can still be closed', async () => {
      renderUncached();

      expect(screen.getByText('Loading incident…')).toHaveAttribute('role', 'status');

      await userEvent.click(screen.getByRole('button', { name: 'Close incident' }));
      expect(useConsole.getState().selectedIncidentId).toBeNull();
    });

    it('says a missing incident no longer exists', async () => {
      getAnswers = [() => apiError(404, 'Incident not found')];

      renderUncached();

      expect(await screen.findByText('This incident no longer exists.')).toBeInTheDocument();
      // Retrying cannot bring it back.
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    });

    it('retries a failed load', async () => {
      getAnswers = [() => apiError(500, 'Internal server error'), () => json(detail())];
      renderUncached();
      expect(await screen.findByText('This incident could not be loaded.')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await screen.findByRole('heading', { name: 'Door forced open' })).toBeInTheDocument();
      expect(getCalls()).toHaveLength(2);
    });

    it('explains too many requests', async () => {
      getAnswers = [() => apiError(429, 'Too many requests')];

      renderUncached();

      expect(await screen.findByText(TOO_MANY_REQUESTS)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('explains an account that may no longer see the incident', async () => {
      getAnswers = [() => apiError(403, 'Forbidden')];

      renderUncached();

      expect(await screen.findByText('Your account can no longer see this.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('shows placeholder cameras while the camera list loads', () => {
      renderWithoutCameras();

      expect(screen.getByText('Loading cameras…')).toHaveAttribute('role', 'status');
      expect(screen.queryByText('No cameras cover this zone.')).toBeNull();
    });

    it('says the cameras could not be loaded', async () => {
      camerasAnswer = () => apiError(500, 'Internal server error');

      renderWithoutCameras();

      expect(await screen.findByText('Cameras could not be loaded.')).toBeInTheDocument();
    });

    it('keeps the incident on screen when a refetch fails', async () => {
      // The cached incident is refetched on mount; that refetch fails.
      getAnswers = [() => apiError(500, 'Internal server error')];

      const { client } = renderDetail();

      await waitFor(() =>
        expect(client.getQueryState(queryKeys.incident(detail().id))?.status).toBe('error'),
      );
      expect(screen.getByRole('heading', { name: 'Door forced open' })).toBeInTheDocument();
      expect(screen.getByRole('form', RESPONSE)).toBeInTheDocument();
      expect(screen.queryByText('This incident could not be loaded.')).toBeNull();
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

    it('explains a 429 in operator terms and keeps the note', async () => {
      postResponse = () => apiError(429, 'ThrottlerException: Too Many Requests');
      renderDetail();
      await userEvent.type(screen.getByLabelText(NOTE_LABEL), 'Guard on the way');

      await userEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(
        'Too many requests right now. Wait a few seconds and try again.',
      );
      expect(alert).not.toHaveTextContent('ThrottlerException');
      expect(screen.getByLabelText(NOTE_LABEL)).toHaveValue('Guard on the way');
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
