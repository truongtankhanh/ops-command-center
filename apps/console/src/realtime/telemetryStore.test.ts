import { act, renderHook } from '@testing-library/react';
import {
  type AssetTelemetryState,
  initialTelemetryState,
  type TelemetryState,
} from '../lib/telemetryState';
import { resetStore } from '../test-utils';
import type { TelemetryClient, TelemetryView } from './telemetryClient';
import {
  useAssetOverview,
  useAssetSeries,
  useAssetState,
  useAssetTelemetry,
  useServerNow,
  useTelemetryStatus,
  useTelemetryStore,
} from './telemetryStore';

const T0 = '2026-10-15T08:00:00.000Z';
const BASE = Date.parse(T0);

const asset = (patch: Partial<AssetTelemetryState> = {}): AssetTelemetryState => ({
  online: true,
  receivedAt: T0,
  headline: {},
  values: {},
  keyReceivedAt: {},
  ...patch,
});

const view = (
  patch: Partial<TelemetryState> = {},
  series: TelemetryView['series'] = new Map(),
): TelemetryView => ({ state: { ...initialTelemetryState, ...patch }, series });

const setView = (next: TelemetryView) => act(() => useTelemetryStore.setState({ view: next }));

/** A client that only remembers who subscribed, so `adopt` can be driven by hand. */
function fakeClient(initial: TelemetryView = view()) {
  let current = initial;
  const listeners = new Set<() => void>();
  const client: TelemetryClient = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getView: () => current,
    setWatch: vi.fn(),
    retry: vi.fn(),
    setLayout: vi.fn(() => 1),
    onTargets: vi.fn(() => () => {}),
    getTargets: vi.fn(() => null),
    getStats: vi.fn(() => ({ messages: 0, targetPosts: 0 })),
    dispose: vi.fn(),
  };
  return {
    client,
    listenerCount: () => listeners.size,
    push(next: TelemetryView) {
      current = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

describe('useTelemetryStore', () => {
  beforeEach(() => resetStore(useTelemetryStore));

  it('starts with nothing known and no client', () => {
    const { view: initial, client } = useTelemetryStore.getState();

    expect(initial.state).toBe(initialTelemetryState);
    expect(initial.series.size).toBe(0);
    expect(client).toBeNull();
  });

  describe('adopt', () => {
    it("takes the client's view at once and every change after it", () => {
      const fake = fakeClient();

      useTelemetryStore.getState().adopt(fake.client);
      expect(useTelemetryStore.getState().client).toBe(fake.client);

      const next = view({ socket: 'live' });
      fake.push(next);
      expect(useTelemetryStore.getState().view).toBe(next);
    });

    it('stops and resets when released', () => {
      const fake = fakeClient();
      const release = useTelemetryStore.getState().adopt(fake.client);
      fake.push(view({ socket: 'live' }));

      release();

      expect(fake.listenerCount()).toBe(0);
      expect(useTelemetryStore.getState().client).toBeNull();
      expect(useTelemetryStore.getState().view.state).toBe(initialTelemetryState);
    });

    it('does not reset a newer client when an older one is released late', () => {
      const first = fakeClient();
      const second = fakeClient(view({ socket: 'live' }));
      const releaseFirst = useTelemetryStore.getState().adopt(first.client);
      useTelemetryStore.getState().adopt(second.client);

      releaseFirst();

      expect(useTelemetryStore.getState().client).toBe(second.client);
      expect(useTelemetryStore.getState().view.state.socket).toBe('live');
    });
  });
});

describe('asset selectors', () => {
  beforeEach(() => resetStore(useTelemetryStore));

  it('re-renders a component that reads one asset only when that asset changes', () => {
    const ct01 = asset({ values: { fanSpeedRpm: 1000 } });
    const ct02 = asset({ values: { fanSpeedRpm: 500 } });
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useAssetState('CT-01');
    });
    setView(view({ assets: { 'CT-01': ct01, 'CT-02': ct02 } }));
    expect(result.current).toBe(ct01);
    const before = renders;

    setView(view({ assets: { 'CT-01': ct01, 'CT-02': asset({ values: { fanSpeedRpm: 600 } }) } }));
    expect(renders).toBe(before);

    setView(view({ assets: { 'CT-01': asset({ values: { fanSpeedRpm: 1100 } }), 'CT-02': ct02 } }));
    expect(renders).toBe(before + 1);
    expect(result.current?.values.fanSpeedRpm).toBe(1100);
  });

  it('is undefined for an asset nothing was received for', () => {
    const { result } = renderHook(() => useAssetState('CT-09'));

    expect(result.current).toBeUndefined();
  });

  it('reads one key of one asset, and keeps its identity while that series is unchanged', () => {
    const rpm = { t: new Float64Array([BASE]), v: new Float32Array([1000]) };
    const other = { t: new Float64Array([BASE]), v: new Float32Array([1]) };
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useAssetSeries('CT-01', 'fanSpeedRpm');
    });

    setView(view({}, new Map([['CT-01|fanSpeedRpm', rpm]])));
    const before = renders;
    setView(
      view(
        {},
        new Map([
          ['CT-01|fanSpeedRpm', rpm],
          ['CT-02|fanSpeedRpm', other],
        ]),
      ),
    );

    expect(result.current).toBe(rpm);
    expect(renders).toBe(before);
  });
});

describe('useTelemetryStatus', () => {
  beforeEach(() => resetStore(useTelemetryStore));

  it.each([
    ['connecting', {}, 'connecting'],
    ['live, nothing heard from the upstream yet', { socket: 'live' }, 'connecting'],
    ['live', { socket: 'live', upstream: 'live' }, 'live'],
    ['paused', { socket: 'live', upstream: 'paused' }, 'paused'],
    ['reconnecting', { socket: 'reconnecting', upstream: 'live' }, 'reconnecting'],
    ['unavailable', { socket: 'unavailable' }, 'unavailable'],
  ] as const)('reads %s', (_name, patch, expected) => {
    const { result } = renderHook(() => useTelemetryStatus());

    setView(view(patch));

    expect(result.current.pill).toBe(expected);
  });

  it('is unavailable against a replica without the namespace, and recovers on a later reconnect', () => {
    const { result } = renderHook(() => useTelemetryStatus());

    setView(view({ socket: 'unavailable' }));
    expect(result.current.pill).toBe('unavailable');

    setView(view({ socket: 'reconnecting' }));
    expect(result.current.pill).toBe('reconnecting');

    setView(view({ socket: 'live', upstream: 'live' }));
    expect(result.current.pill).toBe('live');
  });

  it("carries the API's time for paused and the console's own for reconnecting", () => {
    const { result } = renderHook(() => useTelemetryStatus());

    setView(view({ socket: 'live', upstream: 'paused', upstreamSince: T0 }));
    expect(result.current).toEqual({ pill: 'paused', upstreamSince: T0, socketSince: null });

    setView(
      view({ socket: 'reconnecting', upstream: 'paused', upstreamSince: T0, socketSince: 5 }),
    );
    expect(result.current).toEqual({ pill: 'reconnecting', upstreamSince: T0, socketSince: 5 });
  });

  it('keeps its identity when nothing it reads changed', () => {
    const { result } = renderHook(() => useTelemetryStatus());
    setView(view({ socket: 'live', upstream: 'live' }));
    const first = result.current;

    setView(view({ socket: 'live', upstream: 'live', assets: { 'CT-01': asset() } }));

    expect(result.current).toBe(first);
  });
});

describe('clock-based selectors', () => {
  let mono = 10_000;

  beforeEach(() => {
    resetStore(useTelemetryStore);
    vi.useFakeTimers();
    mono = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => mono);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** The server clock reads `at` when the monotonic clock reads `mono`. */
  const anchored = (at: number, patch: Partial<TelemetryState> = {}) =>
    view({ serverClock: { at, mono }, ...patch });

  const tick = (ms: number) =>
    act(() => {
      mono += ms;
      vi.advanceTimersByTime(ms);
    });

  describe('useServerNow', () => {
    it('is null before the first overview', () => {
      const { result } = renderHook(() => useServerNow());

      expect(result.current).toBeNull();
    });

    it('is the anchor plus the time since, read once a second', () => {
      const { result } = renderHook(() => useServerNow());

      setView(anchored(BASE));
      expect(result.current).toBe(BASE);

      tick(1_000);
      expect(result.current).toBe(BASE + 1_000);
      tick(3_000);
      expect(result.current).toBe(BASE + 4_000);
    });

    it('follows a re-anchor without waiting for the browser clock', () => {
      const { result } = renderHook(() => useServerNow());
      setView(anchored(BASE));
      tick(1_000);

      setView(view({ serverClock: { at: BASE + 60_000, mono } }));

      expect(result.current).toBe(BASE + 60_000);
    });

    it('stops ticking when unmounted', () => {
      const { unmount } = renderHook(() => useServerNow());

      unmount();

      expect(vi.getTimerCount()).toBe(0);
    });

    it('starts no timer while it is not active (V2-17.3)', () => {
      renderHook(() => useServerNow(false));

      expect(vi.getTimerCount()).toBe(0);
    });

    it('does not re-render an inactive caller every second, nor for each overview that re-anchors', () => {
      let renders = 0;
      const { result } = renderHook(() => {
        renders += 1;
        return useServerNow(false);
      });
      const before = renders;

      tick(5_000);
      setView(anchored(BASE));
      setView(anchored(BASE + 1_000));

      expect(renders).toBe(before);
      expect(result.current).toBeNull();
    });

    it('ticks once it becomes active and stops again when it is not', () => {
      const { result, rerender } = renderHook(({ active }) => useServerNow(active), {
        initialProps: { active: false },
      });
      setView(anchored(BASE));

      rerender({ active: true });
      expect(vi.getTimerCount()).toBe(1);
      tick(1_000);
      expect(result.current).toBe(BASE + 1_000);

      rerender({ active: false });
      expect(vi.getTimerCount()).toBe(0);
    });

    it('is active by default, as every other caller expects', () => {
      renderHook(() => useServerNow());

      expect(vi.getTimerCount()).toBe(1);
    });
  });

  describe('useAssetOverview', () => {
    it('is undefined for an asset nothing was received for', () => {
      setView(anchored(BASE));
      const { result } = renderHook(() => useAssetOverview('CT-09', 30_000));

      expect(result.current).toBeUndefined();
    });

    it('has no freshness until the server clock is known', () => {
      setView(view({ assets: { 'CT-01': asset({ headline: { fanSpeedRpm: 1420 } }) } }));
      const { result } = renderHook(() => useAssetOverview('CT-01', 30_000));

      expect(result.current).toEqual({
        online: true,
        headline: { fanSpeedRpm: 1420 },
        freshness: null,
      });
    });

    it('is fresh just under the threshold and stale at it', () => {
      setView(anchored(BASE + 29_000, { assets: { 'CT-01': asset() } }));
      const { result } = renderHook(() => useAssetOverview('CT-01', 30_000));
      expect(result.current?.freshness).toEqual({ receivedAt: T0, ageMs: 29_000, stale: false });

      tick(1_000);

      expect(result.current?.freshness).toEqual({ receivedAt: T0, ageMs: 30_000, stale: true });
    });

    it('never reads as stale without a threshold', () => {
      setView(anchored(BASE + 3_600_000, { assets: { 'CT-01': asset() } }));
      const { result } = renderHook(() => useAssetOverview('CT-01'));

      expect(result.current?.freshness).toEqual({
        receivedAt: T0,
        ageMs: 3_600_000,
        stale: false,
      });
    });

    it('reports an asset that went offline', () => {
      setView(anchored(BASE, { assets: { 'CT-01': asset({ online: false }) } }));
      const { result } = renderHook(() => useAssetOverview('CT-01', 30_000));

      expect(result.current?.online).toBe(false);
    });
  });

  describe('useAssetTelemetry', () => {
    it("gives the values, the age of each key and this asset's series by key", () => {
      const rpm = { t: new Float64Array([BASE]), v: new Float32Array([1000]) };
      const elsewhere = { t: new Float64Array([BASE]), v: new Float32Array([7]) };
      setView(
        anchored(BASE + 12_000, {
          assets: {
            'CT-01': asset({
              values: { fanSpeedRpm: 1000, motorTempC: 70 },
              keyReceivedAt: { fanSpeedRpm: iso(BASE + 10_000), motorTempC: T0 },
            }),
          },
        }),
      );
      act(() =>
        useTelemetryStore.setState({
          view: {
            ...useTelemetryStore.getState().view,
            series: new Map([
              ['CT-01|fanSpeedRpm', rpm],
              ['CT-02|fanSpeedRpm', elsewhere],
            ]),
          },
        }),
      );

      const { result } = renderHook(() => useAssetTelemetry('CT-01', 30_000));

      expect(result.current?.values).toEqual({ fanSpeedRpm: 1000, motorTempC: 70 });
      expect(result.current?.keyAgesMs).toEqual({ fanSpeedRpm: 2_000, motorTempC: 12_000 });
      expect([...(result.current?.series.keys() ?? [])]).toEqual(['fanSpeedRpm']);
      expect(result.current?.series.get('fanSpeedRpm')).toBe(rpm);
      expect(result.current?.freshness?.stale).toBe(false);
    });

    it('has no key ages before the clock is known', () => {
      setView(
        view({
          assets: {
            'CT-01': asset({ keyReceivedAt: { fanSpeedRpm: T0 }, values: { fanSpeedRpm: 1 } }),
          },
        }),
      );
      const { result } = renderHook(() => useAssetTelemetry('CT-01'));

      expect(result.current?.keyAgesMs).toEqual({});
      expect(result.current?.freshness).toBeNull();
    });
  });
});

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
