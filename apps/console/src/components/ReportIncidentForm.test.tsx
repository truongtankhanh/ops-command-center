import { IDEMPOTENCY_KEY_HEADER, type IncidentDetail, type Zone } from '@occ/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from '../api/queries';
import { useConsole } from '../store';
import { ReportIncidentForm } from './ReportIncidentForm';

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

/** The `Idempotency-Key` sent with the `call`-th request. */
function sentKey(call: number): string | undefined {
  const headers = fetchMock.mock.calls[call]![1]!.headers as Record<string, string>;
  return headers[IDEMPOTENCY_KEY_HEADER];
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

  it('closes on Cancel and on Escape', async () => {
    const { form } = renderForm();
    await userEvent.click(form.getByRole('button', { name: 'Cancel' }));
    expect(useConsole.getState().reporting).toBe(false);

    useConsole.setState({ reporting: true });
    await userEvent.keyboard('{Escape}');
    expect(useConsole.getState().reporting).toBe(false);
  });
});
