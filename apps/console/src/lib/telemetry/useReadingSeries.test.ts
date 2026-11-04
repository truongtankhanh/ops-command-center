import type { AssetTelemetrySample } from '@occ/contracts';
import { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { queryRetryDelay, shouldRetryQuery } from '../../api/client';
import { queryKeys } from '../../api/queries';
import { getAccessToken, renewSession } from '../../auth/session';
import { createTestQueryClient, queryWrapper } from '../../test-utils';
import { type ReadingRange, rangeWindow } from './readingRange';
import { isSameSlide, useReadingSeries } from './useReadingSeries';

// As in `queries.test.ts`: the network is `fetch`, so the real client, the cache and the hook's query
// options (key, `enabled`, `staleTime`, `placeholderData`, `select`) are what is under test.
vi.mock('../../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const fetchMock = vi.fn<typeof fetch>();

const NOW = Date.parse('2026-11-04T08:00:00.000Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const iso = (t: number): string => new Date(t).toISOString();

// Fan speed in two buckets; the door flag (a boolean) in two others; an enum that has no series.
const SAMPLES: AssetTelemetrySample[] = [
  { at: iso(NOW - 50 * MIN), values: { fanSpeedRpm: 1000, doorOpen: false, stage: 'cooling' } },
  { at: iso(NOW - 40 * MIN), values: { fanSpeedRpm: 1200 } },
  { at: iso(NOW - 30 * MIN), values: { doorOpen: true } },
];

const urlOf = (input: RequestInfo | URL): URL => new URL(String(input), 'http://console.test');

/** The route's answer for the range it was asked: the asked `from` / `to`, as the API serves them. */
function historyResponse(input: RequestInfo | URL, samples: AssetTelemetrySample[]): Response {
  const url = urlOf(input);
  const assetCode = decodeURIComponent(url.pathname.split('/')[3] ?? '');
  const body = {
    assetCode,
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    bucketS: 5,
    samples,
  };
  return new Response(JSON.stringify(body), { status: 200 });
}

/** Every request is answered at once. */
function serve(samples: AssetTelemetrySample[] = SAMPLES): void {
  fetchMock.mockImplementation(async (input) => historyResponse(input, samples));
}

/**
 * The next request waits until the returned function is called; later ones are answered at once. A
 * case that never calls it leaves the request pending, so nothing settles after the case ends.
 */
function holdNext(): () => void {
  let release: () => void = () => undefined;
  fetchMock.mockImplementationOnce(
    (input) =>
      new Promise<Response>((resolve) => {
        release = () => resolve(historyResponse(input, SAMPLES));
      }),
  );
  return () => act(() => release());
}

const requested = (call = 0): URL => urlOf(fetchMock.mock.calls[call]![0]);

interface Props {
  code: string;
  range: ReadingRange;
  now: number | null;
  reportedAt?: string;
}

function renderSeries(initialProps: Props, client = createTestQueryClient()) {
  const rendered = renderHook(
    ({ code, range, now, reportedAt }: Props) => useReadingSeries(code, range, now, reportedAt),
    { initialProps, wrapper: queryWrapper(client) },
  );
  return { ...rendered, client };
}

const ONE_HOUR: Props = { code: 'CT-01', range: '1h', now: NOW };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(getAccessToken).mockReset().mockResolvedValue(null);
  vi.mocked(renewSession).mockReset().mockResolvedValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useReadingSeries', () => {
  describe('15 min', () => {
    it('sends nothing and leaves the rows to the live ring', async () => {
      serve();
      const { result } = renderSeries({ ...ONE_HOUR, range: '15m' });
      await act(async () => {});

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.current).toMatchObject({ window: null, markerAt: null, status: 'live' });
      expect(result.current.byKey.size).toBe(0);
    });
  });

  describe('1 h', () => {
    it("sends one request for the asset with V3-23.1's window", async () => {
      serve();
      const { result } = renderSeries(ONE_HOUR);

      expect(result.current.status).toBe('loading');
      await waitFor(() => expect(result.current.status).toBe('ready'));
      const window = rangeWindow('1h', NOW);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(requested().pathname).toBe('/api/assets/CT-01/telemetry');
      expect(requested().searchParams.get('from')).toBe(window?.from);
      expect(requested().searchParams.get('to')).toBe(window?.to);
      expect(result.current.window).toEqual({ from: NOW - HOUR, to: NOW });
      expect(result.current.markerAt).toBeNull();
    });

    it('sends one request however many readers ask for the same range', async () => {
      serve();
      const client = createTestQueryClient();
      const { result } = renderHook(
        () => [useReadingSeries('CT-01', '1h', NOW), useReadingSeries('CT-01', '1h', NOW + 10_000)],
        { wrapper: queryWrapper(client) },
      );

      await waitFor(() => expect(result.current.every((s) => s.status === 'ready')).toBe(true));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('turns the buckets into one column per number or boolean key', async () => {
      serve();
      const { result } = renderSeries(ONE_HOUR);
      await waitFor(() => expect(result.current.status).toBe('ready'));

      const { byKey } = result.current;
      expect([...byKey.keys()].sort()).toEqual(['doorOpen', 'fanSpeedRpm']);
      // A bucket without the key adds no point to it: nothing is invented.
      expect(Array.from(byKey.get('fanSpeedRpm')?.t ?? [])).toEqual([
        NOW - 50 * MIN,
        NOW - 40 * MIN,
      ]);
      expect(Array.from(byKey.get('fanSpeedRpm')?.v ?? [])).toEqual([1000, 1200]);
      // A boolean as 0 / 1, for the stepped line.
      expect(Array.from(byKey.get('doorOpen')?.t ?? [])).toEqual([NOW - 50 * MIN, NOW - 30 * MIN]);
      expect(Array.from(byKey.get('doorOpen')?.v ?? [])).toEqual([0, 1]);
      // An enum has no number without its catalogue: shown as its value only.
      expect(byKey.has('stage')).toBe(false);
    });

    it('is ready with no columns for a range with no readings', async () => {
      serve([]);
      const { result } = renderSeries(ONE_HOUR);

      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.byKey.size).toBe(0);
    });

    it('keeps the same columns across renders', async () => {
      serve();
      const { result, rerender } = renderSeries(ONE_HOUR);
      await waitFor(() => expect(result.current.status).toBe('ready'));
      const { byKey, window } = result.current;

      rerender(ONE_HOUR);
      rerender({ ...ONE_HOUR, now: NOW + 29_999 });

      expect(result.current.byKey).toBe(byKey);
      expect(result.current.window).toBe(window);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('sends nothing again on 1 h, 15 min and back to 1 h within 30 s', async () => {
      serve();
      const { result, rerender } = renderSeries(ONE_HOUR);
      await waitFor(() => expect(result.current.status).toBe('ready'));

      rerender({ ...ONE_HOUR, range: '15m' });
      expect(result.current.status).toBe('live');
      rerender({ ...ONE_HOUR, now: NOW + 20_000 });
      await act(async () => {});

      expect(result.current.status).toBe('ready');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('the 30 s slide', () => {
    it('asks for the next window and keeps the last buckets on screen until it lands', async () => {
      serve();
      const { result, rerender } = renderSeries(ONE_HOUR);
      await waitFor(() => expect(result.current.status).toBe('ready'));
      const before = result.current;

      const release = holdNext();
      rerender({ ...ONE_HOUR, now: NOW + 30_000 });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

      expect(requested(1).searchParams.get('to')).toBe(iso(NOW + 30_000));
      // The previous slide, drawn on its own window, not shifted into the new one.
      expect(result.current.status).toBe('ready');
      expect(result.current.window).toEqual(before.window);
      expect(result.current.byKey.size).toBe(before.byKey.size);

      release();
      await waitFor(() =>
        expect(result.current.window).toEqual({ from: NOW + 30_000 - HOUR, to: NOW + 30_000 }),
      );
    });

    it("does not show another asset's buckets while it loads", async () => {
      serve();
      const { result, rerender } = renderSeries(ONE_HOUR);
      await waitFor(() => expect(result.current.status).toBe('ready'));

      holdNext();
      rerender({ ...ONE_HOUR, code: 'CT-02' });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

      expect(requested(1).pathname).toBe('/api/assets/CT-02/telemetry');
      expect(result.current.status).toBe('loading');
      expect(result.current.byKey.size).toBe(0);
    });

    it("does not show 1 h's buckets while Around the alarm loads", async () => {
      serve();
      const { result, rerender } = renderSeries(ONE_HOUR);
      await waitFor(() => expect(result.current.status).toBe('ready'));

      holdNext();
      rerender({ ...ONE_HOUR, range: 'alarm', reportedAt: iso(NOW - 20 * MIN) });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

      expect(result.current.status).toBe('loading');
      expect(result.current.byKey.size).toBe(0);
    });
  });

  describe('around the alarm', () => {
    it('reads the 15-minute window around the raised time and marks it', async () => {
      serve();
      const reportedAt = iso(NOW - 20 * MIN);
      const { result } = renderSeries({ ...ONE_HOUR, range: 'alarm', reportedAt });
      await waitFor(() => expect(result.current.status).toBe('ready'));

      expect(requested().searchParams.get('from')).toBe(iso(NOW - 30 * MIN));
      expect(requested().searchParams.get('to')).toBe(iso(NOW - 15 * MIN));
      expect(result.current.window).toEqual({ from: NOW - 30 * MIN, to: NOW - 15 * MIN });
      expect(result.current.markerAt).toBe(NOW - 20 * MIN);
    });

    it('marks nothing for 1 h, even with a raised time', async () => {
      serve();
      const { result } = renderSeries({ ...ONE_HOUR, reportedAt: iso(NOW - 20 * MIN) });
      await waitFor(() => expect(result.current.status).toBe('ready'));

      expect(result.current.markerAt).toBeNull();
    });
  });

  describe('nothing to ask for yet', () => {
    it('sends nothing and is loading while the server clock is not known', async () => {
      serve();
      const { result } = renderSeries({ ...ONE_HOUR, now: null });
      await act(async () => {});

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.current).toMatchObject({ window: null, status: 'loading' });
    });
  });

  describe('a failed request', () => {
    it.each([404, 500])('is an error with no buckets on a %i', async (status) => {
      fetchMock.mockImplementation(
        async () => new Response(JSON.stringify({ statusCode: status }), { status }),
      );
      const { result } = renderSeries(ONE_HOUR);

      await waitFor(() => expect(result.current.status).toBe('error'));
      expect(result.current.error).toMatchObject({ status });
      expect(result.current.byKey.size).toBe(0);
      // The window asked for stays known, for the error's own words (V3-23.4).
      expect(result.current.window).toEqual({ from: NOW - HOUR, to: NOW });
    });

    it('asks again on refetch', async () => {
      fetchMock.mockImplementationOnce(
        async () => new Response(JSON.stringify({ statusCode: 500 }), { status: 500 }),
      );
      const { result } = renderSeries(ONE_HOUR);
      await waitFor(() => expect(result.current.status).toBe('error'));

      serve();
      act(() => {
        result.current.refetch();
      });

      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  // V3-23.4: what the section needs to say where the range stands.
  describe('the states', () => {
    it('is empty for a range with no sample, and not for one with samples', async () => {
      serve([]);
      const { result } = renderSeries(ONE_HOUR);
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.empty).toBe(true);

      // A fresh client: nothing is shared with the empty range above.
      serve();
      const other = renderSeries(ONE_HOUR);
      await waitFor(() => expect(other.result.current.status).toBe('ready'));
      expect(other.result.current.empty).toBe(false);
    });

    it('is not empty for a range of enum readings only, which has no column either', async () => {
      serve([{ at: iso(NOW - 10 * MIN), values: { stage: 'cooling' } }]);
      const { result } = renderSeries(ONE_HOUR);

      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.byKey.size).toBe(0);
      expect(result.current.empty).toBe(false);
    });

    it('is fetching while a request is under way, and not once it lands', async () => {
      const release = holdNext();
      const { result } = renderSeries(ONE_HOUR);

      await waitFor(() => expect(result.current.fetching).toBe(true));
      expect(result.current.status).toBe('loading');

      release();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.fetching).toBe(false);
    });

    it('is rate limited while a 429 is retried, and an error once the retries are over', async () => {
      fetchMock.mockImplementation(
        async () => new Response(JSON.stringify({ statusCode: 429 }), { status: 429 }),
      );
      // The console's own policy: a 429 is retried after 2 s, which this case never waits for.
      const client = new QueryClient({
        defaultOptions: { queries: { retry: shouldRetryQuery, retryDelay: queryRetryDelay } },
      });
      const { result, unmount } = renderSeries(ONE_HOUR, client);

      await waitFor(() => expect(result.current.rateLimited).toBe(true));
      expect(result.current.status).toBe('loading');
      unmount();
      await client.cancelQueries();

      // The test client does not retry: the 429 is the error at once, and no longer "retrying".
      const exhausted = renderSeries(ONE_HOUR);
      await waitFor(() => expect(exhausted.result.current.status).toBe('error'));
      expect(exhausted.result.current.rateLimited).toBe(false);
      expect(exhausted.result.current.error).toMatchObject({ status: 429 });
    });

    it('is none of them on 15 min', () => {
      const { result } = renderSeries({ ...ONE_HOUR, range: '15m' });

      expect(result.current).toMatchObject({ empty: false, rateLimited: false, fetching: false });
    });
  });

  it('leaves no reader behind once unmounted, so nothing is fetched for it again', async () => {
    serve();
    const { result, unmount, client } = renderSeries(ONE_HOUR);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const [query] = client.getQueryCache().findAll({ queryKey: queryKeys.assetHistory('CT-01') });
    expect(query?.getObserversCount()).toBe(1);

    unmount();

    expect(query?.getObserversCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('isSameSlide', () => {
  const key = (code: string, from: number, to: number) =>
    [...queryKeys.assetHistory(code), iso(from), iso(to)] as const;
  const asked = (from: number, to: number) => ({ from: iso(from), to: iso(to) });

  it('continues the 1 h window that moved on the same asset', () => {
    expect(
      isSameSlide(key('CT-01', NOW - HOUR, NOW), 'CT-01', asked(NOW + 30_000 - HOUR, NOW + 30_000)),
    ).toBe(true);
  });

  it('continues an open alarm window that grew (same start)', () => {
    expect(
      isSameSlide(key('CT-01', NOW - 10 * MIN, NOW), 'CT-01', asked(NOW - 10 * MIN, NOW + 30_000)),
    ).toBe(true);
  });

  it.each([
    ['another asset', key('CT-02', NOW - HOUR, NOW), asked(NOW + 30_000 - HOUR, NOW + 30_000)],
    ['1 h to the alarm', key('CT-01', NOW - HOUR, NOW), asked(NOW - 30 * MIN, NOW - 15 * MIN)],
    ['the alarm to 1 h', key('CT-01', NOW - 30 * MIN, NOW - 15 * MIN), asked(NOW - HOUR, NOW)],
  ])('does not continue %s', (_label, previous, next) => {
    expect(isSameSlide(previous, 'CT-01', next)).toBe(false);
  });

  it('does not continue from nothing, or to nothing', () => {
    expect(isSameSlide(undefined, 'CT-01', asked(NOW - HOUR, NOW))).toBe(false);
    expect(isSameSlide(key('CT-01', NOW - HOUR, NOW), 'CT-01', null)).toBe(false);
    // The 15 min key of a disabled query carries no range.
    expect(
      isSameSlide(
        [...queryKeys.assetHistory('CT-01'), null, null],
        'CT-01',
        asked(NOW - HOUR, NOW),
      ),
    ).toBe(false);
  });
});
