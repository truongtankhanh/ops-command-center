import type { Asset, Incident, IncidentDetail, TelemetryPoint } from '@occ/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { type ReactNode, StrictMode } from 'react';
import { queryKeys } from '../api/queries';
import { initialTelemetryState } from '../lib/telemetry/telemetryState';
import type { Binding } from '../lib/twinBindings';
import type { TargetsView, TelemetryClient } from '../realtime/telemetryClient';
import type { TargetSlot } from '../realtime/telemetryProtocol';
import { useTelemetryStore } from '../realtime/telemetryStore';
import { createTestQueryClient, resetStore } from '../test-utils';
import { useTwinFeed } from './useTwinFeed';

const point = (key: string, headline: 1 | 2, expectedIntervalS: number): TelemetryPoint => ({
  key,
  label: key,
  unit: null,
  kind: 'number',
  min: null,
  max: null,
  enumValues: null,
  expectedIntervalS,
  headline,
});

const asset = (code: string, id: string): Asset => ({
  id,
  code,
  name: code,
  class: {
    id: 'class-cooling-tower',
    code: 'cooling_tower',
    name: 'Cooling tower',
    modelUrl: null,
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  zoneId: 'zone-dc',
  position: [108.44, 11.95],
  elevationM: 0,
  headingDeg: 0,
  headline: [point('fanSpeedRpm', 1, 1)],
});

const CT01 = asset('CT-01', 'asset-ct-01');
const CT02 = asset('CT-02', 'asset-ct-02');

const OPEN: Incident = {
  id: 'inc-1',
  code: 'INC-000108',
  type: 'equipment_fault',
  severity: 'critical',
  status: 'open',
  title: 'Motor over-temperature — Cooling tower 1',
  description: null,
  zoneId: 'zone-dc',
  position: [108.44, 11.95],
  source: 'telemetry',
  assetId: 'asset-ct-01',
  reportedAt: '2026-10-15T07:50:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
};

const DETAIL: IncidentDetail = {
  ...OPEN,
  timeline: [
    {
      id: 'event-1',
      kind: 'reported',
      note: 'motorTempC 92 > 85 for 60 s',
      at: OPEN.reportedAt,
      actor: { kind: 'system', subject: 'telemetry', displayName: 'Telemetry' },
    },
  ],
};

const FAN: Binding = {
  node: 'FanBlade',
  key: 'fanSpeedRpm',
  motion: 'spin',
  axis: 'y',
  range: [0, 1800],
  point: { kind: 'number', min: 0, max: 1800, enumValues: null },
  parent: null,
};

/** A telemetry client with nothing behind it: it records the layouts and lets the test push buffers. */
function fakeClient() {
  const viewListeners = new Set<() => void>();
  const targetListeners = new Set<(targets: TargetsView) => void>();
  const layouts: (readonly TargetSlot[])[] = [];
  const client: TelemetryClient = {
    subscribe: (listener) => {
      viewListeners.add(listener);
      return () => void viewListeners.delete(listener);
    },
    getView: () => ({ state: initialTelemetryState, series: new Map() }),
    setWatch: vi.fn(),
    retry: vi.fn(),
    setLayout: vi.fn((slots: readonly TargetSlot[]) => {
      layouts.push(slots);
      return layouts.length;
    }),
    onTargets: (listener) => {
      targetListeners.add(listener);
      return () => void targetListeners.delete(listener);
    },
    getTargets: () => null,
    getStats: () => ({ messages: 0, targetPosts: 0 }),
    dispose: vi.fn(),
  };
  return {
    client,
    layouts,
    viewListeners,
    targetListeners,
    emitTargets(layoutId: number, ...numbers: number[]) {
      const targets: TargetsView = { layoutId, buffer: Float32Array.from(numbers) };
      for (const listener of [...targetListeners]) listener(targets);
    },
  };
}

describe('useTwinFeed', () => {
  let queryClient: ReturnType<typeof createTestQueryClient>;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const strictWrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </StrictMode>
  );
  const adopt = (client: TelemetryClient | null) =>
    act(() => useTelemetryStore.setState({ client }));
  /** Lets the query cache's scheduled notifications run. */
  const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

  beforeEach(() => {
    vi.useFakeTimers();
    resetStore(useTelemetryStore);
    queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.assets, [CT01]);
    queryClient.setQueryData(queryKeys.incidents, []);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetStore(useTelemetryStore);
  });

  it('is null without a telemetry client, and a feed once there is one', () => {
    const fake = fakeClient();
    const { result } = renderHook(() => useTwinFeed({ invalidate: vi.fn() }), { wrapper });
    expect(result.current).toBeNull();

    adopt(fake.client);

    expect(result.current).not.toBeNull();
    expect(fake.viewListeners.size).toBe(1);
    expect(fake.targetListeners.size).toBe(1);
  });

  it('reads the assets from the query cache, with no request of its own', () => {
    const fake = fakeClient();
    adopt(fake.client);
    const { result } = renderHook(() => useTwinFeed({ invalidate: vi.fn() }), { wrapper });

    act(() => result.current?.setBindings('cooling_tower', [FAN]));

    expect(fake.layouts).toEqual([[{ assetCode: 'CT-01', key: 'fanSpeedRpm', enumValues: null }]]);
  });

  it('refreshes when the assets, the incidents or an incident’s detail change in the cache', async () => {
    const fake = fakeClient();
    adopt(fake.client);
    const { result } = renderHook(() => useTwinFeed({ invalidate: vi.fn() }), { wrapper });
    act(() => result.current?.setBindings('cooling_tower', [FAN]));

    act(() => {
      queryClient.setQueryData(queryKeys.assets, [CT01, CT02]);
    });
    await flush();
    expect(fake.layouts.at(-1)?.map((slot) => slot.assetCode)).toEqual(['CT-01', 'CT-02']);

    act(() => {
      queryClient.setQueryData(queryKeys.incidents, [OPEN]);
    });
    await flush();
    expect(result.current?.read().flags('CT-01').alarm).toBe('critical');
    expect(result.current?.read().flags('CT-01').ruleKey).toBeNull();

    act(() => {
      queryClient.setQueryData(queryKeys.incident(OPEN.id), DETAIL);
    });
    await flush();
    expect(result.current?.read().flags('CT-01').ruleKey).toBe('motorTempC');
  });

  it('calls the latest invalidate, without making a new feed for it', () => {
    const fake = fakeClient();
    adopt(fake.client);
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ invalidate }) => useTwinFeed({ invalidate }), {
      wrapper,
      initialProps: { invalidate: first },
    });
    const feed = result.current;
    act(() => feed?.setBindings('cooling_tower', [FAN]));
    first.mockClear();

    rerender({ invalidate: second });
    fake.emitTargets(1, 1420);

    expect(result.current).toBe(feed);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('disposes the feed on unmount: no listener is left', () => {
    const fake = fakeClient();
    adopt(fake.client);
    const { unmount } = renderHook(() => useTwinFeed({ invalidate: vi.fn() }), { wrapper });
    expect(fake.viewListeners.size).toBe(1);

    unmount();

    expect(fake.viewListeners.size).toBe(0);
    expect(fake.targetListeners.size).toBe(0);
  });

  it('leaves one live feed after StrictMode’s mount, cleanup and mount', () => {
    const fake = fakeClient();
    adopt(fake.client);

    const { result } = renderHook(() => useTwinFeed({ invalidate: vi.fn() }), {
      wrapper: strictWrapper,
    });

    expect(result.current).not.toBeNull();
    expect(fake.viewListeners.size).toBe(1);
    expect(fake.targetListeners.size).toBe(1);
  });

  it('makes a new feed for a new client and disposes the old one', () => {
    const first = fakeClient();
    const second = fakeClient();
    adopt(first.client);
    const { result } = renderHook(() => useTwinFeed({ invalidate: vi.fn() }), { wrapper });
    const before = result.current;

    adopt(second.client);

    expect(result.current).not.toBe(before);
    expect(first.viewListeners.size).toBe(0);
    expect(second.viewListeners.size).toBe(1);

    adopt(null);

    expect(result.current).toBeNull();
    expect(second.viewListeners.size).toBe(0);
  });
});
