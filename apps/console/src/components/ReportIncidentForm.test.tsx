import {
  IDEMPOTENCY_KEY_HEADER,
  type IncidentDetail,
  type LngLat,
  type Role,
  type Zone,
} from '@occ/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from '../api/queries';
import { getAccessToken, renewSession } from '../auth/session';
import { useSession } from '../auth/store';
import { useConsole } from '../store';
import { resetStore } from '../test-utils';
import { useToasts } from '../ui/toasts';
import { ReportIncidentForm } from './ReportIncidentForm';

// The session module is tested on its own; here it only decides which token the client sends.
vi.mock('../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const zone: Zone = {
  id: '6f1c2b1e-0000-4000-8000-000000000001',
  code: 'BLD-LIB',
  name: 'Library',
  kind: 'building',
  polygon: [],
  center: [108.44, 11.95],
};

const otherZone: Zone = {
  ...zone,
  id: '6f1c2b1e-0000-4000-8000-000000000002',
  code: 'BLD-DC',
  name: 'Data Center',
};

/** A building with a `use`; `zone` and `otherZone` have none, as from an API before V2-03.3. */
const labZone: Zone = {
  ...zone,
  id: '6f1c2b1e-0000-4000-8000-000000000003',
  code: 'BLD-LAB',
  name: 'Science Lab',
  use: 'laboratory',
};

/** Pins are placed through the store, as the map does; the form only shows and sends them. */
const PIN: LngLat = [108.4412, 11.9531];
const MOVED: LngLat = [108.4415, 11.9529];

function pin(at: LngLat = PIN) {
  act(() => useConsole.getState().placePin(at, zone.id));
}

const created: IncidentDetail = {
  id: 'new-incident',
  code: 'INC-000042',
  type: 'medical',
  severity: 'high',
  status: 'open',
  title: 'Person down at entrance',
  description: null,
  zoneId: zone.id,
  position: zone.center,
  source: 'operator',
  reportedAt: '2026-10-01T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  timeline: [],
};

const fetchMock = vi.fn<typeof fetch>();

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The headers sent with the `call`-th request. */
function sentHeaders(call: number): Record<string, string> {
  return fetchMock.mock.calls[call]![1]!.headers as Record<string, string>;
}

/** The `Idempotency-Key` sent with the `call`-th request. */
function sentKey(call: number): string | undefined {
  return sentHeaders(call)[IDEMPOTENCY_KEY_HEADER];
}

/** An `ApiError` response; a body can be read only once, so build one per call. */
function apiError(status: number, message: string): Response {
  return new Response(JSON.stringify({ statusCode: status, message }), { status });
}

const DRAFT_KEPT = 'Esc keeps your draft. Cancel discards it.';

function renderForm(zones: Zone[] = [zone]) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData(queryKeys.zones, zones);
  client.setQueryData(queryKeys.incidents, []);
  render(
    <QueryClientProvider client={client}>
      <ReportIncidentForm />
    </QueryClientProvider>,
  );
  const form = within(screen.getByRole('complementary', { name: 'Report an incident' }));
  return { client, form };
}

type Form = ReturnType<typeof renderForm>['form'];

/**
 * The title field, by role and name. Not `getByLabelText`: that matches the label's raw text, which
 * also holds the `aria-hidden` counter ("Title0 / 160"); the accessible name is "Title".
 */
const titleBox = (form: Form) => form.getByRole('textbox', { name: 'Title' });

/** The type step's options, in the order shown. */
const typeNames = (form: Form) =>
  within(form.getByRole('group', { name: /^Type — / }))
    .getAllByRole('radio')
    .map((radio) => radio.closest('label')!.textContent);

/** Signs in with one role, as the session module does from the token. */
function signIn(role: Role) {
  useSession.getState().signedIn({ displayName: 'Demo User', roles: [role] });
}

const QUEUE_HINT = /incidents go to the technician queue/;

async function fillRequired(form: Form) {
  await userEvent.click(form.getByRole('radio', { name: 'Medical' }));
  await userEvent.click(form.getByRole('radio', { name: 'Medical emergency' }));
  await userEvent.click(form.getByLabelText('High'));
  await userEvent.selectOptions(form.getByLabelText('Location'), zone.id);
  await userEvent.type(titleBox(form), '  Person down at entrance ');
}

describe('ReportIncidentForm', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    // Signed out by default: no bearer header, and nothing to renew.
    vi.mocked(getAccessToken).mockReset().mockResolvedValue(null);
    vi.mocked(renewSession).mockReset().mockResolvedValue(false);
    // The location lives in the store: start each case from an empty report, as the header does.
    resetStore(useConsole);
    useConsole.getState().startReport();
    resetStore(useToasts);
    resetStore(useSession);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("names each empty required field on submit and sends nothing, within the API's limits", async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    const { form } = renderForm();
    const submit = form.getByRole('button', { name: 'Report incident' });
    const messages = ['Choose a category.', 'Choose a location.', 'Enter a title.'];

    expect(titleBox(form)).toHaveAttribute('maxLength', '160');
    expect(form.getByLabelText('Details (optional)')).toHaveAttribute('maxLength', '2000');
    expect(submit).toBeEnabled();

    await userEvent.click(submit);
    expect(fetchMock).not.toHaveBeenCalled();
    for (const message of messages) expect(form.getByText(message)).toBeInTheDocument();

    await fillRequired(form);
    for (const message of messages) expect(form.queryByText(message)).toBeNull();
    await userEvent.click(submit);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('posts the report and selects the new incident', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(created), { status: 201 }));
    const { client, form } = renderForm();

    await fillRequired(form);
    await userEvent.click(form.getByRole('button', { name: 'Report incident' }));

    await vi.waitFor(() => expect(useConsole.getState().selectedIncidentId).toBe('new-incident'));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/incidents');
    expect(JSON.parse(init!.body as string)).toEqual({
      type: 'medical',
      severity: 'high',
      zoneId: zone.id,
      title: 'Person down at entrance',
    });
    expect(useConsole.getState().reporting).toBe(false);
    expect(client.getQueryData(queryKeys.incidents)).toEqual([created]);
  });

  it("shows the server's message and keeps the input", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ statusCode: 404, message: 'Zone was not found' }), {
        status: 404,
      }),
    );
    const { form } = renderForm();

    await fillRequired(form);
    await userEvent.click(form.getByRole('button', { name: 'Report incident' }));

    expect(await form.findByRole('alert')).toHaveTextContent('Zone was not found');
    expect(titleBox(form)).toHaveValue('  Person down at entrance ');
    expect(useConsole.getState().reporting).toBe(true);
  });

  it('sends a v4 Idempotency-Key with the report', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(created), { status: 201 }));
    const { form } = renderForm();

    await fillRequired(form);
    await userEvent.click(form.getByRole('button', { name: 'Report incident' }));

    await vi.waitFor(() => expect(useConsole.getState().selectedIncidentId).toBe('new-incident'));
    expect(sentKey(0)).toMatch(UUID_V4);
  });

  it('reuses the key when the operator retries, even after editing', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201 }));
    const { form } = renderForm();

    await fillRequired(form);
    await userEvent.click(form.getByRole('button', { name: 'Report incident' }));
    await form.findByRole('alert');

    // The first attempt may have reached the API, so an edited retry must not look like a new report.
    // `fillRequired` leaves a trailing space, so this reads "… entrance (east door)".
    await userEvent.type(titleBox(form), '(east door)');
    await userEvent.click(form.getByRole('button', { name: 'Report incident' }));

    await vi.waitFor(() => expect(useConsole.getState().selectedIncidentId).toBe('new-incident'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentKey(1)).toBe(sentKey(0));
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string).title).toBe(
      'Person down at entrance (east door)',
    );
  });

  it('uses a new key for a newly opened form', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    for (let opened = 0; opened < 2; opened++) {
      const { form } = renderForm();
      await fillRequired(form);
      await userEvent.click(form.getByRole('button', { name: 'Report incident' }));
      await form.findByRole('alert');
      cleanup(); // closing the form unmounts it, as App does
    }

    expect(sentKey(0)).toMatch(UUID_V4);
    expect(sentKey(1)).toMatch(UUID_V4);
    expect(sentKey(1)).not.toBe(sentKey(0));
  });

  it('explains a 422 in operator terms and keeps the input', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          statusCode: 422,
          message: 'This Idempotency-Key was already used with a different request body',
        }),
        { status: 422 },
      ),
    );
    const { form } = renderForm();

    await fillRequired(form);
    await userEvent.click(form.getByRole('button', { name: 'Report incident' }));

    const alert = await form.findByRole('alert');
    expect(alert).toHaveTextContent(
      'This report was already sent with different details. Check the incident feed before reporting it again.',
    );
    expect(alert).not.toHaveTextContent('Idempotency-Key');
    expect(titleBox(form)).toHaveValue('  Person down at entrance ');
    expect(useConsole.getState().reporting).toBe(true);
  });

  it('explains a 403 in operator terms and keeps the input', async () => {
    vi.mocked(getAccessToken).mockResolvedValue('token-1');
    fetchMock.mockResolvedValue(apiError(403, 'Missing permission: incident:report'));
    const { form } = renderForm();

    await fillRequired(form);
    await userEvent.click(form.getByRole('button', { name: 'Report incident' }));

    const alert = await form.findByRole('alert');
    expect(alert).toHaveTextContent('Your account is no longer allowed to do this.');
    expect(alert).not.toHaveTextContent('Missing permission');
    expect(titleBox(form)).toHaveValue('  Person down at entrance ');
    expect(useConsole.getState().reporting).toBe(true);
    expect(renewSession).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the access token with the report, next to the Idempotency-Key', async () => {
    vi.mocked(getAccessToken).mockResolvedValue('token-1');
    fetchMock.mockResolvedValue(new Response(JSON.stringify(created), { status: 201 }));
    const { form } = renderForm();

    await fillRequired(form);
    await userEvent.click(form.getByRole('button', { name: 'Report incident' }));

    await vi.waitFor(() => expect(useConsole.getState().selectedIncidentId).toBe('new-incident'));
    expect(sentHeaders(0)).toMatchObject({
      Authorization: 'Bearer token-1',
      'Content-Type': 'application/json',
    });
    expect(sentKey(0)).toMatch(UUID_V4);
  });

  it('renews an expired token and sends the report once more with the same key', async () => {
    vi.mocked(getAccessToken).mockResolvedValueOnce('expired').mockResolvedValueOnce('fresh');
    vi.mocked(renewSession).mockResolvedValue(true);
    fetchMock
      .mockResolvedValueOnce(apiError(401, 'Invalid access token'))
      .mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201 }));
    const { form } = renderForm();

    await fillRequired(form);
    await userEvent.click(form.getByRole('button', { name: 'Report incident' }));

    await vi.waitFor(() => expect(useConsole.getState().selectedIncidentId).toBe('new-incident'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentHeaders(0).Authorization).toBe('Bearer expired');
    expect(sentHeaders(1).Authorization).toBe('Bearer fresh');
    expect(sentKey(1)).toBe(sentKey(0));
    expect(renewSession).toHaveBeenCalledTimes(1);
    expect(form.queryByRole('alert')).toBeNull();
  });

  it('keeps the input and does not resend when the session cannot be renewed', async () => {
    vi.mocked(getAccessToken).mockResolvedValue('expired');
    fetchMock.mockResolvedValue(apiError(401, 'Invalid access token'));
    const { form } = renderForm();

    await fillRequired(form);
    await userEvent.click(form.getByRole('button', { name: 'Report incident' }));

    expect(await form.findByRole('alert')).toHaveTextContent('Invalid access token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(renewSession).toHaveBeenCalledTimes(1);
    expect(titleBox(form)).toHaveValue('  Person down at entrance ');
    expect(useConsole.getState().reporting).toBe(true);
  });

  it('treats an identity-provider outage as an error, not as an expired session', async () => {
    vi.mocked(getAccessToken).mockResolvedValue('token-1');
    fetchMock.mockResolvedValue(apiError(503, 'Identity provider unavailable'));
    const { form } = renderForm();

    await fillRequired(form);
    await userEvent.click(form.getByRole('button', { name: 'Report incident' }));

    expect(await form.findByRole('alert')).toHaveTextContent('Identity provider unavailable');
    expect(renewSession).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(titleBox(form)).toHaveValue('  Person down at entrance ');
  });

  it('closes on Cancel and on Escape', async () => {
    const { form } = renderForm();
    await userEvent.click(form.getByRole('button', { name: 'Cancel' }));
    expect(useConsole.getState().reporting).toBe(false);

    useConsole.setState({ reporting: true });
    await userEvent.keyboard('{Escape}');
    expect(useConsole.getState().reporting).toBe(false);
  });

  it('stays open with the input on Escape once anything is entered, but still closes on Cancel', async () => {
    const { form } = renderForm();
    await userEvent.type(titleBox(form), 'Smoke near the stairwell');

    await userEvent.keyboard('{Escape}');
    expect(useConsole.getState().reporting).toBe(true);
    expect(titleBox(form)).toHaveValue('Smoke near the stairwell');

    await userEvent.click(form.getByRole('button', { name: 'Cancel' }));
    expect(useConsole.getState().reporting).toBe(false);
  });

  it('explains what Escape does with a draft', async () => {
    const { form } = renderForm();
    const cancel = form.getByRole('button', { name: 'Cancel' });
    const hint = () => form.queryByText(DRAFT_KEPT, { selector: 'p' });
    expect(cancel).toHaveAttribute('aria-keyshortcuts', 'Escape');
    expect(hint()).toBeNull();

    await userEvent.type(titleBox(form), 'Smoke');
    expect(hint()).toHaveAttribute('data-tone', 'info');
    // Escape no longer cancels, so the key is not offered on Cancel.
    expect(cancel).not.toHaveAttribute('aria-keyshortcuts');

    await userEvent.keyboard('{Escape}');
    expect(hint()).toHaveAttribute('data-tone', 'warning');
    expect(form.getByRole('status')).toHaveTextContent(DRAFT_KEPT);
    expect(useConsole.getState().reporting).toBe(true);
  });

  it("keeps the id the header's Report button controls", () => {
    renderForm();

    expect(screen.getByRole('complementary', { name: 'Report an incident' })).toHaveAttribute(
      'id',
      'report-incident-panel',
    );
  });

  it('counts a changed severity as input to keep', async () => {
    const { form } = renderForm();
    await userEvent.click(form.getByLabelText('Critical'));

    await userEvent.keyboard('{Escape}');
    expect(useConsole.getState().reporting).toBe(true);
  });

  it('counts a chosen category as input to keep', async () => {
    const { form } = renderForm();
    await userEvent.click(form.getByRole('radio', { name: 'Security' }));

    await userEvent.keyboard('{Escape}');
    expect(useConsole.getState().reporting).toBe(true);
  });

  describe('validation', () => {
    it('describes each empty field and focuses the category', async () => {
      const { form } = renderForm();

      await userEvent.click(form.getByRole('button', { name: 'Report incident' }));

      expect(form.getByRole('group', { name: 'Category' })).toHaveAccessibleDescription(
        'Choose a category.',
      );
      // The type step only follows a category, so there is no type to ask for yet.
      expect(form.queryByText('Choose a type.')).toBeNull();
      const location = form.getByRole('combobox', { name: 'Location' });
      expect(location).toHaveAttribute('aria-invalid', 'true');
      expect(location).toHaveAccessibleDescription('Choose a location.');
      expect(titleBox(form)).toHaveAttribute('aria-invalid', 'true');
      expect(titleBox(form)).toHaveAccessibleDescription('Enter a title.');
      expect(form.getByRole('radio', { name: 'Security' })).toHaveFocus();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('focuses the first empty field in form order, and clears each message once filled', async () => {
      const { form } = renderForm();
      const submit = form.getByRole('button', { name: 'Report incident' });
      // Nothing is reported missing before the operator tries to submit.
      expect(form.queryByText('Choose a category.')).toBeNull();
      expect(form.queryByText('Choose a location.')).toBeNull();
      expect(form.queryByText('Enter a title.')).toBeNull();

      await userEvent.click(form.getByRole('radio', { name: 'Medical' }));
      await userEvent.click(submit);
      expect(form.queryByText('Choose a category.')).toBeNull();
      expect(form.getByRole('group', { name: 'Type — Medical' })).toHaveAccessibleDescription(
        'Choose a type.',
      );
      expect(form.getByRole('radio', { name: 'Medical emergency' })).toHaveFocus();

      await userEvent.click(form.getByRole('radio', { name: 'Medical emergency' }));
      await userEvent.click(submit);
      expect(form.queryByText('Choose a type.')).toBeNull();
      expect(form.getByRole('combobox', { name: 'Location' })).toHaveFocus();

      await userEvent.selectOptions(form.getByLabelText('Location'), zone.id);
      await userEvent.click(submit);
      expect(form.queryByText('Choose a location.')).toBeNull();
      expect(titleBox(form)).toHaveFocus();

      await userEvent.type(titleBox(form), 'Smoke');
      expect(form.queryByText('Enter a title.')).toBeNull();
      expect(titleBox(form)).not.toHaveAttribute('aria-invalid');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('category and type', () => {
    it('opens on the category step, with no type step before a category', () => {
      const { form } = renderForm();

      expect(form.getByRole('radio', { name: 'Security' })).toHaveFocus();
      expect(form.queryByRole('group', { name: /^Type/ })).toBeNull();
    });

    it("offers exactly the chosen category's types, named after it", async () => {
      const { form } = renderForm();

      await userEvent.click(form.getByRole('radio', { name: 'Facilities' }));

      expect(form.getByRole('group', { name: 'Type — Facilities' })).toBeInTheDocument();
      expect(typeNames(form)).toEqual([
        'Equipment fault',
        'Power outage',
        'Water leak',
        'Lift entrapment',
        'HVAC fault',
        'Network outage',
      ]);
    });

    it('clears a type that is not in a newly chosen category', async () => {
      const { form } = renderForm();
      await userEvent.click(form.getByRole('radio', { name: 'Facilities' }));
      await userEvent.click(form.getByRole('radio', { name: 'Lift entrapment' }));

      await userEvent.click(form.getByRole('radio', { name: 'Security' }));
      const types = within(form.getByRole('group', { name: 'Type — Security' }));
      for (const radio of types.getAllByRole('radio')) expect(radio).not.toBeChecked();

      await userEvent.click(form.getByRole('radio', { name: 'Facilities' }));
      expect(form.getByRole('radio', { name: 'Lift entrapment' })).not.toBeChecked();
    });
  });

  describe('suggested severity', () => {
    it("selects the type's severity and says it was suggested", async () => {
      const { form } = renderForm();
      expect(form.getByLabelText('Medium')).toBeChecked();

      await userEvent.click(form.getByRole('radio', { name: 'Facilities' }));
      await userEvent.click(form.getByRole('radio', { name: 'Lift entrapment' }));

      const suggestion = 'Suggested for lift entrapment: High.';
      expect(form.getByLabelText('High')).toBeChecked();
      expect(form.getByText(suggestion)).toBeInTheDocument();
      expect(form.getByRole('group', { name: 'Severity' })).toHaveAccessibleDescription(suggestion);
    });

    it('keeps a severity changed by hand when the type changes, and still says what was suggested', async () => {
      const { form } = renderForm();
      await userEvent.click(form.getByRole('radio', { name: 'Facilities' }));
      await userEvent.click(form.getByRole('radio', { name: 'Lift entrapment' }));
      await userEvent.click(form.getByLabelText('Low'));

      await userEvent.click(form.getByRole('radio', { name: 'Water leak' }));

      expect(form.getByLabelText('Low')).toBeChecked();
      expect(form.getByText('Suggested for water leak: Medium.')).toBeInTheDocument();
    });

    it('keeps the case of a type that starts with an acronym', async () => {
      const { form } = renderForm();
      await userEvent.click(form.getByRole('radio', { name: 'Facilities' }));

      await userEvent.click(form.getByRole('radio', { name: 'HVAC fault' }));

      expect(form.getByText('Suggested for HVAC fault: Medium.')).toBeInTheDocument();
    });

    it('keeps the severity when a new category clears the type', async () => {
      const { form } = renderForm();
      await userEvent.click(form.getByRole('radio', { name: 'Fire & safety' }));
      await userEvent.click(form.getByRole('radio', { name: 'Fire' }));
      expect(form.getByLabelText('Critical')).toBeChecked();

      await userEvent.click(form.getByRole('radio', { name: 'Facilities' }));

      expect(form.getByLabelText('Critical')).toBeChecked();
      expect(form.queryByText(/^Suggested for/)).toBeNull();
    });
  });

  describe('likely types', () => {
    it('lists the types likely in the chosen zone first', async () => {
      const { form } = renderForm([zone, labZone]);
      await userEvent.selectOptions(form.getByLabelText('Location'), labZone.id);

      await userEvent.click(form.getByRole('radio', { name: 'Fire & safety' }));

      expect(typeNames(form)).toEqual(['Hazmat spill', 'Gas leak', 'Fire alarm', 'Fire']);
    });

    it('keeps the contract order without a zone, or for a building without a use', async () => {
      const contractOrder = ['Fire alarm', 'Fire', 'Gas leak', 'Hazmat spill'];
      const { form } = renderForm();
      await userEvent.click(form.getByRole('radio', { name: 'Fire & safety' }));
      expect(typeNames(form)).toEqual(contractOrder);

      await userEvent.selectOptions(form.getByLabelText('Location'), zone.id);

      expect(typeNames(form)).toEqual(contractOrder);
    });

    it('reorders when the zone changes, without changing the chosen type', async () => {
      const { form } = renderForm([zone, labZone]);
      await userEvent.click(form.getByRole('radio', { name: 'Fire & safety' }));
      await userEvent.click(form.getByRole('radio', { name: 'Fire' }));

      await userEvent.selectOptions(form.getByLabelText('Location'), labZone.id);

      expect(typeNames(form)).toEqual(['Hazmat spill', 'Gas leak', 'Fire alarm', 'Fire']);
      expect(form.getByRole('radio', { name: 'Fire' })).toBeChecked();
    });
  });

  describe('roles', () => {
    it.each([
      { role: 'technician', category: 'Facilities' },
      { role: 'operator', category: 'Environment' },
    ] as const)(
      'tells a $role that $category incidents go to the technicians',
      async ({ role, category }) => {
        signIn(role);
        const { form } = renderForm();

        await userEvent.click(form.getByRole('radio', { name: category }));

        expect(
          form.getByText(
            `${category} incidents go to the technician queue; you can acknowledge this one yourself.`,
          ),
        ).toBeInTheDocument();
      },
    );

    it.each([
      { role: 'technician', category: 'Security' },
      { role: 'operator', category: 'Medical' },
    ] as const)(
      'says nothing about the queue to a $role reporting $category',
      async ({ role, category }) => {
        signIn(role);
        const { form } = renderForm();

        await userEvent.click(form.getByRole('radio', { name: category }));

        expect(form.queryByText(QUEUE_HINT)).toBeNull();
      },
    );

    it('lets a technician report a Security type, with an unchanged request body', async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify(created), { status: 201 }));
      signIn('technician');
      const { form } = renderForm();

      await userEvent.click(form.getByRole('radio', { name: 'Security' }));
      await userEvent.click(form.getByRole('radio', { name: 'Intrusion' }));
      await userEvent.selectOptions(form.getByLabelText('Location'), zone.id);
      await userEvent.type(titleBox(form), 'Door forced at the back');
      await userEvent.click(form.getByRole('button', { name: 'Report incident' }));

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
        type: 'intrusion',
        severity: 'high',
        zoneId: zone.id,
        title: 'Door forced at the back',
      });
    });
  });

  describe('server errors', () => {
    it.each([
      {
        name: 'a 429 in operator terms',
        answer: () => apiError(429, 'ThrottlerException: Too Many Requests'),
        pinned: false,
        text: 'Too many requests right now. Wait a few seconds and try again.',
      },
      {
        name: 'a pin outside its zone, by the zone name',
        answer: () => apiError(400, 'position is outside zone BLD-LIB'),
        pinned: true,
        text: 'The pin is outside Library. Move it inside the zone or remove it.',
      },
      {
        name: "any other 400 with the server's message",
        answer: () => apiError(400, 'title must be shorter than or equal to 160 characters'),
        pinned: false,
        text: 'title must be shorter than or equal to 160 characters',
      },
    ])('explains $name and keeps the input', async ({ answer, pinned, text }) => {
      fetchMock.mockImplementation(() => Promise.resolve(answer()));
      const { form } = renderForm();
      await fillRequired(form);
      if (pinned) pin();

      await userEvent.click(form.getByRole('button', { name: 'Report incident' }));

      expect(await form.findByRole('alert')).toHaveTextContent(text);
      expect(titleBox(form)).toHaveValue('  Person down at entrance ');
      expect(useConsole.getState().reporting).toBe(true);
    });
  });

  describe('location', () => {
    it('sends the pin and says where it is', async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify(created), { status: 201 }));
      const { form } = renderForm();
      await fillRequired(form);

      pin();

      const where = 'Pin inside Library · 11.9531, 108.4412';
      expect(form.getByText(where)).toBeInTheDocument();
      expect(form.getByRole('combobox', { name: 'Location' })).toHaveAccessibleDescription(where);
      await userEvent.click(form.getByRole('button', { name: 'Report incident' }));
      await vi.waitFor(() => expect(useConsole.getState().selectedIncidentId).toBe('new-incident'));
      expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
        type: 'medical',
        severity: 'high',
        zoneId: zone.id,
        title: 'Person down at entrance',
        position: PIN,
      });
    });

    it('removes the pin, by its button or by choosing another zone', async () => {
      fetchMock.mockReturnValue(new Promise<Response>(() => {}));
      const { form } = renderForm([zone, otherZone]);
      await fillRequired(form);

      pin();
      await userEvent.click(form.getByRole('button', { name: 'Remove pin' }));
      expect(useConsole.getState().reportPosition).toBeNull();
      expect(form.getByText('No pin: placed at the centre of Library.')).toBeInTheDocument();

      pin();
      await userEvent.selectOptions(form.getByLabelText('Location'), otherZone.id);
      expect(useConsole.getState()).toMatchObject({
        reportPosition: null,
        reportZoneId: otherZone.id,
      });
      expect(form.getByText('No pin: placed at the centre of Data Center.')).toBeInTheDocument();

      await userEvent.click(form.getByRole('button', { name: 'Report incident' }));
      expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).not.toHaveProperty(
        'position',
      );
    });

    it('reuses the key after the pin moves', async () => {
      fetchMock
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201 }));
      const { form } = renderForm();
      await fillRequired(form);
      pin();
      await userEvent.click(form.getByRole('button', { name: 'Report incident' }));
      await form.findByRole('alert');

      // The first attempt may have reached the API: a moved pin must not look like a new report.
      pin(MOVED);
      await userEvent.click(form.getByRole('button', { name: 'Report incident' }));

      await vi.waitFor(() => expect(useConsole.getState().selectedIncidentId).toBe('new-incident'));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(sentKey(1)).toBe(sentKey(0));
      expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string).position).toEqual(MOVED);
    });

    it.each(['a zone', 'a pin'])('keeps a draft that is only %s on Escape', async (only) => {
      const { form } = renderForm();
      act(() => {
        if (only === 'a zone') useConsole.getState().setReportZone(zone.id);
        else useConsole.getState().placePin(PIN, zone.id);
      });

      await userEvent.keyboard('{Escape}');

      expect(useConsole.getState().reporting).toBe(true);
      // The sheet heard the Escape and said why it stayed open.
      expect(form.getByRole('status')).toHaveTextContent(DRAFT_KEPT);
    });

    it('turns picking on and off, and warns about a missed pin', async () => {
      const { form } = renderForm();
      const pick = form.getByRole('button', { name: 'Pick on map' });
      expect(pick).toHaveAttribute('aria-pressed', 'false');

      await userEvent.click(pick);
      expect(pick).toHaveAttribute('aria-pressed', 'true');
      expect(useConsole.getState().picking).toBe(true);

      act(() => useConsole.getState().missPin());
      expect(form.getByText('Place the pin inside a zone.', { selector: 'p' })).toHaveAttribute(
        'data-tone',
        'warning',
      );

      await userEvent.click(pick);
      expect(pick).toHaveAttribute('aria-pressed', 'false');
      expect(useConsole.getState().picking).toBe(false);
    });
  });

  describe('header and success', () => {
    it('confirms the report with a toast', async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify(created), { status: 201 }));
      const { form } = renderForm();
      await fillRequired(form);

      await userEvent.click(form.getByRole('button', { name: 'Report incident' }));

      await vi.waitFor(() => expect(useConsole.getState().selectedIncidentId).toBe('new-incident'));
      // Keyed to the incident, so its live `Created` event adds no second toast.
      expect(useToasts.getState().toasts).toEqual([
        expect.objectContaining({
          key: 'new-incident',
          title: 'Reported INC-000042',
          detail: 'Person down at entrance',
        }),
      ]);
    });

    it('counts the title outside its name', async () => {
      const { form } = renderForm();

      await userEvent.type(titleBox(form), 'Smoke');

      expect(form.getByText('5 / 160')).toHaveAttribute('aria-hidden', 'true');
      expect(titleBox(form)).toHaveValue('Smoke');
    });

    it('cancels from the top of the sheet', async () => {
      const { form } = renderForm();
      await userEvent.type(titleBox(form), 'Smoke');

      await userEvent.click(form.getByRole('button', { name: 'Cancel report' }));

      expect(useConsole.getState().reporting).toBe(false);
    });
  });
});
