import type { Asset } from '@occ/contracts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { api } from '../../api/client';
import { queryKeys } from '../../api/queries';
import { createTestQueryClient, queryWrapper } from '../../test-utils';
import { useTwinModelStore } from './twinModelStore';
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
  // The card also reads the catalogue (for the model rows): empty unless a case says otherwise.
  client.setQueryData(queryKeys.assets, []);
  seed?.(client);
  return renderHook(() => useTwinLoading(codeLoaded), { wrapper: queryWrapper(client) });
}

/** An asset of a class that has a model, `east` degrees of longitude from the origin. */
const modelled = (code: string, classCode: string, name: string, lng = 0): Asset => ({
  id: code,
  code,
  name: code,
  class: {
    id: classCode,
    code: classCode,
    name,
    modelUrl: `/models/${classCode}.0123456789ab.glb`,
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  zoneId: 'Z',
  position: [lng, 0],
  elevationM: 0,
  headingDeg: 0,
  headline: [],
});

describe('useTwinLoading', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    act(() => useTwinModelStore.getState().reset());
  });

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
  describe('the equipment models (V2-14.7)', () => {
    const seedModels = (client: ReturnType<typeof createTestQueryClient>) => {
      client.setQueryData(queryKeys.zones, []);
      client.setQueryData(queryKeys.sitePlan, PLAN);
      client.setQueryData(queryKeys.assets, [
        modelled('CT-01', 'cooling_tower', 'Cooling tower', 0.0001),
        modelled('CT-02', 'cooling_tower', 'Cooling tower', 0.0002),
        modelled('GEN-01', 'standby_generator', 'Standby generator', 0.0003),
      ]);
    };

    it('adds a queued row per class once the site plan is ready', () => {
      const { result } = renderLoading(true, seedModels);

      expect(result.current.steps.map(({ id, state, label }) => [id, state, label])).toEqual([
        ['site-plan', 'done', 'Site plan'],
        ['code', 'done', '3D view code'],
        ['model:cooling_tower', 'queued', 'Cooling tower × 2'],
        ['model:standby_generator', 'queued', 'Standby generator × 1'],
      ]);
      expect(result.current.loading).toBe(true);
    });

    it('adds none while the site plan is on its way, so a stage that cannot start is not busy for ever', () => {
      fakeApi({
        '/zones': () => new Promise(() => undefined),
        '/site-plan': () => new Promise(() => undefined),
      });

      const { result } = renderLoading(true, (client) =>
        client.setQueryData(queryKeys.assets, [
          modelled('CT-01', 'cooling_tower', 'Cooling tower'),
        ]),
      );

      expect(result.current.steps.map(({ id }) => id)).toEqual(['site-plan', 'code']);
    });

    it('adds none when the zones failed', async () => {
      fakeApi({
        '/zones': () => Promise.reject(new Error('down')),
        '/site-plan': () => Promise.resolve(PLAN),
      });

      const { result } = renderLoading(true, (client) =>
        client.setQueryData(queryKeys.assets, [
          modelled('CT-01', 'cooling_tower', 'Cooling tower'),
        ]),
      );

      await waitFor(() => expect(result.current.steps[0]).toMatchObject({ state: 'failed' }));
      expect(result.current.steps.map(({ id }) => id)).toEqual(['site-plan', 'code']);
      expect(result.current.loading).toBe(false);
    });

    it('has no row for a catalogue with no model', () => {
      const { result } = renderLoading(true, (client) => {
        client.setQueryData(queryKeys.zones, []);
        client.setQueryData(queryKeys.sitePlan, PLAN);
      });

      expect(result.current.steps.map(({ id }) => id)).toEqual(['site-plan', 'code']);
      expect(result.current.loading).toBe(false);
    });

    it('follows a class’s bytes, and is busy until every class has finished', () => {
      const { result } = renderLoading(true, seedModels);

      act(() =>
        useTwinModelStore
          .getState()
          .report('cooling_tower', { state: 'loading', loaded: 600_000, total: 1_400_000 }),
      );
      expect(result.current.steps[2]).toMatchObject({ state: 'active', detail: '0.6 / 1.4 MB' });

      act(() => {
        useTwinModelStore
          .getState()
          .report('cooling_tower', { state: 'ready', loaded: 1_400_000, total: 1_400_000 });
        useTwinModelStore
          .getState()
          .report('standby_generator', { state: 'loading', loaded: 10, total: 20 });
      });
      expect(result.current.steps[2]).toMatchObject({ state: 'done', detail: '1.4 MB' });
      expect(result.current.loading).toBe(true);

      act(() =>
        useTwinModelStore
          .getState()
          .report('standby_generator', { state: 'ready', loaded: 20, total: 20 }),
      );
      expect(result.current.loading).toBe(false);
      expect(result.current.steps.every(({ state }) => state === 'done')).toBe(true);
    });

    it('finishes a class whose model failed, so the card can close and the stage is not busy', () => {
      const { result } = renderLoading(true, seedModels);

      act(() => {
        useTwinModelStore
          .getState()
          .report('cooling_tower', { state: 'failed', loaded: 0, total: 0 });
        useTwinModelStore
          .getState()
          .report('standby_generator', { state: 'ready', loaded: 20, total: 20 });
      });

      expect(result.current.steps[2]).toMatchObject({ state: 'done', detail: 'drawn as a box' });
      expect(result.current.steps.every(({ state }) => state === 'done')).toBe(true);
      expect(result.current.loading).toBe(false);
    });
  });
});
