import { getAccessToken, renewSession } from '../auth/session';
import { api, ApiRequestError, shouldRetryQuery } from './client';

// The session module is tested on its own; here it only decides which token the client sends.
vi.mock('../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const fetchMock = vi.fn<typeof fetch>();

/** The headers sent with the `call`-th request. */
function sentHeaders(call: number): Record<string, string> {
  return fetchMock.mock.calls[call]![1]!.headers as Record<string, string>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('api client', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(getAccessToken).mockReset().mockResolvedValue(null);
    vi.mocked(renewSession).mockReset().mockResolvedValue(false);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('sends the access token on a GET and returns the parsed body', async () => {
    vi.mocked(getAccessToken).mockResolvedValue('token-1');
    fetchMock.mockResolvedValue(json([{ id: 'zone-1' }]));

    await expect(api.get('/zones')).resolves.toEqual([{ id: 'zone-1' }]);

    expect(fetchMock.mock.calls[0]![0]).toBe('/api/zones');
    expect(sentHeaders(0)).toMatchObject({
      Authorization: 'Bearer token-1',
      'Content-Type': 'application/json',
    });
  });

  it('does not resend a request that is refused again after a renewal', async () => {
    vi.mocked(getAccessToken).mockResolvedValue('token-1');
    vi.mocked(renewSession).mockResolvedValue(true);
    fetchMock
      .mockResolvedValueOnce(json({ statusCode: 401, message: 'Invalid access token' }, 401))
      .mockResolvedValueOnce(json({ statusCode: 401, message: 'Invalid access token' }, 401));

    await expect(api.get('/zones')).rejects.toMatchObject({ status: 401 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(renewSession).toHaveBeenCalledTimes(1);
  });

  it('does not try to renew when the refused request carried no token', async () => {
    fetchMock.mockResolvedValue(json({ statusCode: 401, message: 'Missing bearer token' }, 401));

    await expect(api.get('/zones')).rejects.toMatchObject({
      status: 401,
      message: 'Missing bearer token',
    });

    expect(renewSession).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the bearer token when a caller passes its own Authorization header', async () => {
    vi.mocked(getAccessToken).mockResolvedValue('token-1');
    fetchMock.mockResolvedValue(json({}));

    await api.post('/x', {}, { Authorization: 'Bearer forged' });

    expect(sentHeaders(0).Authorization).toBe('Bearer token-1');
  });

  it('joins a list of validation messages into one error message', async () => {
    fetchMock.mockResolvedValue(
      json({ statusCode: 400, message: ['title is empty', 'zone is invalid'] }, 400),
    );

    await expect(api.get('/x')).rejects.toMatchObject({
      status: 400,
      message: 'title is empty; zone is invalid',
    });
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('oops', { status: 500 }));

    await expect(api.get('/x')).rejects.toMatchObject({
      status: 500,
      message: 'Request failed (500)',
    });
  });
});

describe('shouldRetryQuery', () => {
  const unavailable = new ApiRequestError(503, 'Unavailable');
  const offline = new TypeError('Failed to fetch');

  it.each([
    { label: 'a 401', error: new ApiRequestError(401, 'Invalid'), failures: 0, retry: false },
    { label: 'a 404', error: new ApiRequestError(404, 'Not found'), failures: 0, retry: false },
    { label: 'a 422', error: new ApiRequestError(422, 'Already used'), failures: 0, retry: false },
    { label: 'a 503 after 1 failure', error: unavailable, failures: 0, retry: true },
    { label: 'a 503 after 2 failures', error: unavailable, failures: 1, retry: true },
    { label: 'a 503 after 3 failures', error: unavailable, failures: 2, retry: false },
    { label: 'a network error after 1 failure', error: offline, failures: 0, retry: true },
    { label: 'a network error after 2 failures', error: offline, failures: 1, retry: true },
    { label: 'a network error after 3 failures', error: offline, failures: 2, retry: false },
  ])('$label → retry: $retry', ({ error, failures, retry }) => {
    expect(shouldRetryQuery(failures, error)).toBe(retry);
  });
});
