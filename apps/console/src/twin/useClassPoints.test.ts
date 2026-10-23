import type { AssetDetail, TelemetryPoint } from '@occ/contracts';
import { renderHook, waitFor } from '@testing-library/react';
import { api } from '../api/client';
import { queryKeys } from '../api/queries';
import type { ModelClass } from '../lib/twin-core/twinLoadQueue';
import { createTestQueryClient, queryWrapper } from '../test-utils';
import { useClassPoints } from './useClassPoints';

const point = (key: string): TelemetryPoint =>
  ({ key, label: key, kind: 'number', unit: 'rpm', min: 0, max: 1800 }) as TelemetryPoint;

const detail = (code: string, keys: string[]): AssetDetail =>
  ({ code, points: keys.map(point), rules: [] }) as unknown as AssetDetail;

const modelClass = (code: string, representative: string): ModelClass => ({
  code,
  name: code,
  modelUrl: `/models/${code}.0123456789ab.glb`,
  assetCount: 1,
  representative,
  distanceM: 0,
});

const TOWER = modelClass('cooling_tower', 'CT-01');
const GENERATOR = modelClass('standby_generator', 'GEN-01');

describe('useClassPoints', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads the points of each class from the cache of its representative asset', () => {
    const client = createTestQueryClient();
    client.setQueryData(queryKeys.asset('CT-01'), detail('CT-01', ['fanSpeedRpm', 'motorTempC']));
    client.setQueryData(queryKeys.asset('GEN-01'), detail('GEN-01', ['fuelLevelPct']));

    const { result } = renderHook(() => useClassPoints([TOWER, GENERATOR]), {
      wrapper: queryWrapper(client),
    });

    expect(Object.keys(result.current)).toEqual(['cooling_tower', 'standby_generator']);
    expect(result.current['cooling_tower']?.map((p) => p.key)).toEqual([
      'fanSpeedRpm',
      'motorTempC',
    ]);
    expect(result.current['standby_generator']?.map((p) => p.key)).toEqual(['fuelLevelPct']);
  });

  it('leaves a class out until its detail arrives, then has it', async () => {
    let arrive: (value: AssetDetail) => void = () => undefined;
    vi.spyOn(api, 'get').mockImplementation(
      () => new Promise<AssetDetail>((resolve) => (arrive = resolve)) as never,
    );
    const client = createTestQueryClient();

    const { result } = renderHook(() => useClassPoints([TOWER]), { wrapper: queryWrapper(client) });
    expect(Object.keys(result.current)).toHaveLength(0);

    arrive(detail('CT-01', ['fanSpeedRpm']));

    await waitFor(() => expect(result.current['cooling_tower']).toHaveLength(1));
  });

  it('leaves a class out when its detail fails, and keeps the others', async () => {
    vi.spyOn(api, 'get').mockImplementation(((path: string) =>
      path === '/assets/CT-01'
        ? Promise.reject(new Error('down'))
        : Promise.resolve(detail('GEN-01', ['fuelLevelPct']))) as typeof api.get);

    const { result } = renderHook(() => useClassPoints([TOWER, GENERATOR]), {
      wrapper: queryWrapper(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current['standby_generator']).toBeDefined());
    expect(result.current['cooling_tower']).toBeUndefined();
  });

  it('asks once per class, whatever else is in the cache, and not at all for a cached asset', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(detail('GEN-01', ['fuelLevelPct']) as never);
    const client = createTestQueryClient();
    client.setQueryData(queryKeys.asset('CT-01'), detail('CT-01', ['fanSpeedRpm']));

    const { result } = renderHook(() => useClassPoints([TOWER, GENERATOR]), {
      wrapper: queryWrapper(client),
    });
    await waitFor(() => expect(Object.keys(result.current)).toHaveLength(2));

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/assets/GEN-01');
  });

  it('asks for nothing when there is no modelled class', () => {
    const get = vi.spyOn(api, 'get');

    const { result } = renderHook(() => useClassPoints([]), {
      wrapper: queryWrapper(createTestQueryClient()),
    });

    expect(Object.keys(result.current)).toHaveLength(0);
    expect(get).not.toHaveBeenCalled();
  });

  it('keeps the same object while nothing changed', () => {
    const client = createTestQueryClient();
    client.setQueryData(queryKeys.asset('CT-01'), detail('CT-01', ['fanSpeedRpm']));
    const classes = [TOWER];

    const { result, rerender } = renderHook(() => useClassPoints(classes), {
      wrapper: queryWrapper(client),
    });
    const first = result.current;
    rerender();

    expect(result.current).toBe(first);
  });
});
