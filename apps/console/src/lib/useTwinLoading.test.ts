import { act, renderHook, waitFor } from '@testing-library/react';
import { api } from '../api/client';
import { queryKeys } from '../api/queries';
import { createTestQueryClient, queryWrapper } from '../test-utils';
import { useTwinLoading } from './useTwinLoading';

const states = (steps: { id: string; state: string }[]) =>
  steps.map(({ id, state }) => [id, state]);

/** The API faked path by path, so no request leaves the test. */
function fakeApi(routes: Record<string, () => Promise<unknown>>) {
  return vi.spyOn(api, 'get').mockImplementation(((path: string) => {
    const route = routes[path];
    return route ? route() : Promise.reject(new Error(`unexpected ${path}`));
  }) as typeof api.get);
}

const PLAN = { id: 'plan-1', code: 'P', name: 'P', center: [0, 0], features: [] };

function renderLoading(
  codeLoaded: boolean,
  seed?: (client: ReturnType<typeof createTestQueryClient>) => void,
) {
  const client = createTestQueryClient();
  seed?.(client);
  return renderHook(() => useTwinLoading(codeLoaded), { wrapper: queryWrapper(client) });
}

describe('useTwinLoading', () => {
  afterEach(() => vi.restoreAllMocks());

  it('has the site plan done and the code still loading when only the data is in', () => {
    const { result } = renderLoading(false, (client) => {
      client.setQueryData(queryKeys.zones, []);
      client.setQueryData(queryKeys.sitePlan, PLAN);
    });

    expect(states(result.current.steps)).toEqual([
      ['site-plan', 'done'],
      ['code', 'active'],
    ]);
    expect(result.current.loading).toBe(true);
  });

  it('is done and not loading once the code has arrived too', () => {
    const { result } = renderLoading(true, (client) => {
      client.setQueryData(queryKeys.zones, []);
      client.setQueryData(queryKeys.sitePlan, PLAN);
    });

    expect(states(result.current.steps)).toEqual([
      ['site-plan', 'done'],
      ['code', 'done'],
    ]);
    expect(result.current.loading).toBe(false);
  });

  it('has the site plan active while the zones are on their way', () => {
    fakeApi({
      '/zones': () => new Promise(() => undefined),
      '/site-plan': () => new Promise(() => undefined),
    });

    const { result } = renderLoading(true);

    expect(states(result.current.steps)).toEqual([
      ['site-plan', 'active'],
      ['code', 'done'],
    ]);
    expect(result.current.loading).toBe(true);
  });

  it('has the site plan active while only the plan is on its way', () => {
    fakeApi({ '/site-plan': () => new Promise(() => undefined) });

    const { result } = renderLoading(true, (client) => client.setQueryData(queryKeys.zones, []));

    expect(result.current.steps[0]).toMatchObject({ state: 'active' });
  });

  it('fails the site plan when the zones fail, and is then not loading', async () => {
    fakeApi({
      '/zones': () => Promise.reject(new Error('down')),
      '/site-plan': () => Promise.resolve(PLAN),
    });

    const { result } = renderLoading(true);

    await waitFor(() => expect(result.current.steps[0]).toMatchObject({ state: 'failed' }));
    expect(result.current.loading).toBe(false);
  });

  it('does not fail the site plan when only the plan fails: the zones draw alone', async () => {
    fakeApi({
      '/zones': () => Promise.resolve([]),
      '/site-plan': () => Promise.reject(new Error('404')),
    });

    const { result } = renderLoading(true);

    await waitFor(() => expect(result.current.steps[0]).toMatchObject({ state: 'done' }));
    expect(result.current.loading).toBe(false);
  });

  it('asks for the zones again on retry, and shows that it is asking', async () => {
    let zonesCalls = 0;
    fakeApi({
      '/zones': () =>
        ++zonesCalls === 1 ? Promise.reject(new Error('down')) : Promise.resolve([]),
      '/site-plan': () => Promise.resolve(PLAN),
    });
    const { result } = renderLoading(true);
    await waitFor(() => expect(result.current.steps[0]).toMatchObject({ state: 'failed' }));

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.steps[0]).toMatchObject({ state: 'done' }));
    expect(zonesCalls).toBe(2);
    expect(result.current.retrying).toBe(false);
  });
});
