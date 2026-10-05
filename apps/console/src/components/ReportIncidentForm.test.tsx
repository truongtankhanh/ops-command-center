import { IDEMPOTENCY_KEY_HEADER, type IncidentDetail, type Zone } from '@occ/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from '../api/queries';
import { getAccessToken, renewSession } from '../auth/session';
import { useConsole } from '../store';
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

function renderForm() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData(queryKeys.zones, [zone]);
  client.setQueryData(queryKeys.incidents, []);
  render(
    <QueryClientProvider client={client}>
      <ReportIncidentForm />
    </QueryClientProvider>,
  );
  const form = within(screen.getByRole('complementary', { name: 'Report an incident' }));
  return { client, form };
}

async function fillRequired(form: ReturnType<typeof renderForm>['form']) {
  await userEvent.selectOptions(form.getByLabelText('Type'), 'medical');
  await userEvent.click(form.getByLabelText('High'));
  await userEvent.selectOptions(form.getByLabelText('Location'), zone.id);
  await userEvent.type(form.getByLabelText('Title'), '  Person down at entrance ');
}

describe('ReportIncidentForm', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    // Signed out by default: no bearer header, and nothing to renew.
    vi.mocked(getAccessToken).mockReset().mockResolvedValue(null);
    vi.mocked(renewSession).mockReset().mockResolvedValue(false);
    useConsole.setState({ reporting: true, selectedIncidentId: null });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('keeps the submit button disabled until type, zone and title are set', async () => {
    const { form } = renderForm();
    const submit = form.getByRole('button', { name: 'Report incident' });

    expect(submit).toBeDisabled();
    expect(form.getByLabelText('Title')).toHaveAttribute('maxLength', '160');
    expect(form.getByLabelText('Details (optional)')).toHaveAttribute('maxLength', '2000');

    await fillRequired(form);
    expect(submit).toBeEnabled();
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
    expect(form.getByLabelText('Title')).toHaveValue('  Person down at entrance ');
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
    await userEvent.type(form.getByLabelText('Title'), '(east door)');
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
    expect(form.getByLabelText('Title')).toHaveValue('  Person down at entrance ');
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
    expect(form.getByLabelText('Title')).toHaveValue('  Person down at entrance ');
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
    expect(form.getByLabelText('Title')).toHaveValue('  Person down at entrance ');
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
    expect(form.getByLabelText('Title')).toHaveValue('  Person down at entrance ');
  });

  it('closes on Cancel and on Escape', async () => {
    const { form } = renderForm();
    await userEvent.click(form.getByRole('button', { name: 'Cancel' }));
    expect(useConsole.getState().reporting).toBe(false);

    useConsole.setState({ reporting: true });
    await userEvent.keyboard('{Escape}');
    expect(useConsole.getState().reporting).toBe(false);
  });
});
