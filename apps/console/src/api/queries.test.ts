import type { Asset } from '@occ/contracts';
import { renderHook, waitFor } from '@testing-library/react';
import { getAccessToken, renewSession } from '../auth/session';
import { createTestQueryClient, queryWrapper } from '../test-utils';
import { queryKeys, useAsset, useAssetHistory, useAssets, useModelParts } from './queries';

// As in `client.test.ts`: the session module decides only which token is sent, and the network is
// `fetch`, so the real client, the retry policy of the test client and the cache are under test.
vi.mock('../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const fetchMock = vi.fn<typeof fetch>();

/** Answers every request with a fresh `Response` (a body can be read once). */
function respond(body: unknown, status = 200): void {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status }));
}

/** The path and query of the `call`-th request, as a URL to read parameters from. */
function requested(call = 0): URL {
  return new URL(String(fetchMock.mock.calls[call]![0]), 'http://console.test');
}

// Only the transport is under test: a code is enough to tell the rows apart.
const CATALOGUE = [
  { id: 'a1', code: 'CT-01' },
  { id: 'a2', code: 'CT-02' },
] as unknown as Asset[];

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(getAccessToken).mockReset().mockResolvedValue(null);
  vi.mocked(renewSession).mockReset().mockResolvedValue(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useAssets', () => {
  it('returns the catalogue the API sends', async () => {
    respond(CATALOGUE);
    const { result } = renderHook(() => useAssets(), {
      wrapper: queryWrapper(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.data).toEqual(CATALOGUE));
    expect(requested().pathname).toBe('/api/assets');
  });

  it('is not requested again by a render', async () => {
    respond(CATALOGUE);
    const { result, rerender } = renderHook(() => useAssets(), {
      wrapper: queryWrapper(createTestQueryClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender();
    rerender();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('is shared by two components: one request', async () => {
    respond(CATALOGUE);
    const { result } = renderHook(() => [useAssets(), useAssets()] as const, {
      wrapper: queryWrapper(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current[1].data).toEqual(CATALOGUE));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads a 404 (an API from before V2-05) as an empty catalogue, not an error', async () => {
    respond({ statusCode: 404, message: 'Cannot GET /api/assets' }, 404);
    const { result } = renderHook(() => useAssets(), {
      wrapper: queryWrapper(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it.each([
    [500, 'Internal error'],
    [403, 'Your account can no longer see this.'],
  ])('keeps the data empty and the error available on a %i', async (status, message) => {
    respond({ statusCode: status, message }, status);
    const { result } = renderHook(() => useAssets(), {
      wrapper: queryWrapper(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toMatchObject({ status, message });
  });

  describe('an empty catalogue', () => {
    it('goes stale after 30 s, while a catalogue with assets stays fresh', async () => {
      // Only `Date` is faked: the cache reads it for `updatedAt`, and `waitFor` keeps real timers.
      vi.useFakeTimers({ toFake: ['Date'] });

      respond([]);
      const empty = renderHook(() => useAssets(), {
        wrapper: queryWrapper(createTestQueryClient()),
      });
      await waitFor(() => expect(empty.result.current.isSuccess).toBe(true));
      vi.setSystemTime(Date.now() + 29_000);
      empty.rerender();
      expect(empty.result.current.isStale).toBe(false);
      vi.setSystemTime(Date.now() + 2_000);
      empty.rerender();
      expect(empty.result.current.isStale).toBe(true);

      respond(CATALOGUE);
      const full = renderHook(() => useAssets(), {
        wrapper: queryWrapper(createTestQueryClient()),
      });
      await waitFor(() => expect(full.result.current.isSuccess).toBe(true));
      vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
      full.rerender();
      expect(full.result.current.isStale).toBe(false);
    });

    it('is polled only while it is empty', async () => {
      const client = createTestQueryClient();
      const interval = () => {
        const query = client.getQueryCache().find({ queryKey: queryKeys.assets })!;
        const option = query.observers[0]!.options.refetchInterval;
        return typeof option === 'function' ? option(query) : option;
      };

      respond([]);
      const { result, unmount } = renderHook(() => useAssets(), { wrapper: queryWrapper(client) });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(interval()).toBe(30_000);

      client.setQueryData(queryKeys.assets, CATALOGUE);
      expect(interval()).toBe(false);
      unmount();
    });

    it('is not polled before it has answered, or after a failure', async () => {
      respond({ statusCode: 500, message: 'down' }, 500);
      const client = createTestQueryClient();
      const { result } = renderHook(() => useAssets(), { wrapper: queryWrapper(client) });
      await waitFor(() => expect(result.current.isError).toBe(true));

      const query = client.getQueryCache().find({ queryKey: queryKeys.assets })!;
      const option = query.observers[0]!.options.refetchInterval;
      expect(typeof option === 'function' ? option(query) : option).toBe(false);
    });
  });
});

describe('useAsset', () => {
  it('sends nothing without a code', () => {
    const { result } = renderHook(() => useAsset(null), {
      wrapper: queryWrapper(createTestQueryClient()),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads one asset by its code', async () => {
    const detail = { id: 'a1', code: 'CT-01', points: [], rules: [] };
    respond(detail);
    const { result } = renderHook(() => useAsset('CT-01'), {
      wrapper: queryWrapper(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.data).toEqual(detail));
    expect(requested().pathname).toBe('/api/assets/CT-01');
  });

  it('encodes the code in the path', async () => {
    respond({});
    const { result } = renderHook(() => useAsset('A/B ?'), {
      wrapper: queryWrapper(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[0]![0])).toBe('/api/assets/A%2FB%20%3F');
  });

  it('keeps one cache entry per code', async () => {
    respond({});
    const client = createTestQueryClient();
    const { result, rerender } = renderHook(({ code }) => useAsset(code), {
      wrapper: queryWrapper(client),
      initialProps: { code: 'CT-01' },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ code: 'CT-02' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(client.getQueryCache().find({ queryKey: queryKeys.asset('CT-01') })).toBeDefined();
    expect(client.getQueryCache().find({ queryKey: queryKeys.asset('CT-02') })).toBeDefined();
  });
});

describe('useAssetHistory', () => {
  const history = { assetCode: 'CT-01', from: 'f', to: 't', bucketS: 5, samples: [] };

  it('sends nothing without a code', () => {
    const { result } = renderHook(() => useAssetHistory(null), {
      wrapper: queryWrapper(createTestQueryClient()),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves the range to the API's default when none is given", async () => {
    respond(history);
    const { result } = renderHook(() => useAssetHistory('CT-01'), {
      wrapper: queryWrapper(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.data).toEqual(history));
    expect(requested().pathname).toBe('/api/assets/CT-01/telemetry');
    expect(requested().search).toBe('');
  });

  it('sends the range it is given as `from` and `to`', async () => {
    respond(history);
    const range = { from: '2026-10-15T07:00:00Z', to: '2026-10-15T08:00:00Z' };
    const { result } = renderHook(() => useAssetHistory('CT-01', range), {
      wrapper: queryWrapper(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requested().pathname).toBe('/api/assets/CT-01/telemetry');
    expect(requested().searchParams.get('from')).toBe(range.from);
    expect(requested().searchParams.get('to')).toBe(range.to);
  });

  it('does not let two ranges of one asset share an entry', async () => {
    respond(history);
    const client = createTestQueryClient();
    const wrapper = queryWrapper(client);
    renderHook(
      () => [
        useAssetHistory('CT-01', { from: '2026-10-15T07:00:00Z', to: '2026-10-15T07:30:00Z' }),
        useAssetHistory('CT-01', { from: '2026-10-15T07:30:00Z', to: '2026-10-15T08:00:00Z' }),
      ],
      { wrapper },
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      client.getQueryCache().findAll({ queryKey: queryKeys.assetHistory('CT-01') }),
    ).toHaveLength(2);
  });

  it('leaves a 404 an error with no data: the caller says "no history"', async () => {
    respond({ statusCode: 404, message: 'Asset CT-01 was not found' }, 404);
    const { result } = renderHook(() => useAssetHistory('CT-01'), {
      wrapper: queryWrapper(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toMatchObject({ status: 404 });
  });
});

describe('queryKeys for assets', () => {
  it('nests one asset and its history under the catalogue', () => {
    expect(queryKeys.assets).toEqual(['assets']);
    expect(queryKeys.asset('CT-01')).toEqual(['assets', 'CT-01']);
    expect(queryKeys.assetHistory('CT-01')).toEqual(['assets', 'CT-01', 'history']);
  });
});

/** A `.glb` holding `json`, padded as the format asks, with a short binary chunk after it. */
function glb(json: unknown): Uint8Array<ArrayBuffer> {
  const body = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(body.length / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + jsonLength + 8 + 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(body, 20);
  return bytes;
}

/** Answers every request with the bytes of a ranged read (206), as nginx does. */
function serveModel(bytes: Uint8Array<ArrayBuffer>, status = 206): void {
  fetchMock.mockImplementation(async () => new Response(bytes.slice(), { status }));
}

const MODEL_URL = '/models/cooling_tower.961e8f9f464e.glb';
const TOWER = {
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'CoolingTower', children: [1] }, { name: 'Casing' }],
};

describe('useModelParts', () => {
  it('sends nothing without a URL, and is not loading', () => {
    const { result } = renderHook(() => useModelParts(null), {
      wrapper: queryWrapper(createTestQueryClient()),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.isLoading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the class root from the file, with a ranged request and no bearer token', async () => {
    serveModel(glb(TOWER));
    const { result } = renderHook(() => useModelParts(MODEL_URL), {
      wrapper: queryWrapper(createTestQueryClient()),
    });

    await waitFor(() =>
      expect(result.current.data).toEqual({
        name: 'CoolingTower',
        children: [{ name: 'Casing', children: [] }],
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(MODEL_URL, { headers: { Range: 'bytes=0-65535' } });
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('reads a server that ignores Range and answers the whole file', async () => {
    serveModel(glb(TOWER), 200);
    const { result } = renderHook(() => useModelParts(MODEL_URL), {
      wrapper: queryWrapper(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.data?.name).toBe('CoolingTower'));
  });

  it('is loading while the file is on its way', () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
    const { result } = renderHook(() => useModelParts(MODEL_URL), {
      wrapper: queryWrapper(createTestQueryClient()),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('sends one request however many readers ask for the same model', async () => {
    serveModel(glb(TOWER));
    const client = createTestQueryClient();
    const { result } = renderHook(
      () => [useModelParts(MODEL_URL), useModelParts(MODEL_URL), useModelParts(MODEL_URL)],
      { wrapper: queryWrapper(client) },
    );

    await waitFor(() => expect(result.current.every((query) => query.isSuccess)).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.getQueryCache().findAll({ queryKey: ['models'] })).toHaveLength(1);
  });

  it('resolves to null for a file with no class root, so the caller can tell it from loading', async () => {
    serveModel(glb({ scenes: [{ nodes: [] }], nodes: [] }));
    const { result } = renderHook(() => useModelParts(MODEL_URL), {
      wrapper: queryWrapper(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  // `retry: 1` overrides the test client's `retry: false`, and TanStack waits a second before the retry.
  it('leaves data undefined with the error set after one retry when the file is missing', async () => {
    fetchMock.mockImplementation(async () => new Response('Not Found', { status: 404 }));
    const { result } = renderHook(() => useModelParts(MODEL_URL), {
      wrapper: queryWrapper(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 4000 });
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toMatchObject({ message: expect.stringContaining('HTTP 404') });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a body that is not a GLB as an error, such as an HTML page served for the URL', async () => {
    fetchMock.mockImplementation(
      async () => new Response('<!doctype html><title>Console</title><p>x</p>', { status: 200 }),
    );
    const { result } = renderHook(() => useModelParts(MODEL_URL), {
      wrapper: queryWrapper(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 4000 });
    expect(result.current.data).toBeUndefined();
  });
});

describe('queryKeys for models', () => {
  it('is by URL, apart from the assets', () => {
    expect(queryKeys.model(MODEL_URL)).toEqual(['models', MODEL_URL]);
  });
});
