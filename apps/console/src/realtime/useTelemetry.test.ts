import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { initialTelemetryState } from '../lib/telemetryState';
import { resetStore } from '../test-utils';
import { createTelemetryClient, type TelemetryClient, type TelemetryView } from './telemetryClient';
import type * as TelemetryClientModule from './telemetryClient';
import { useTelemetryStore } from './telemetryStore';
import { retryTelemetry, useTelemetry, useTelemetryWatch } from './useTelemetry';

// The store imports `seriesKey` from the same module: keep every real export but the factory.
vi.mock('./telemetryClient', async (importOriginal) => ({
  ...(await importOriginal<typeof TelemetryClientModule>()),
  createTelemetryClient: vi.fn(),
}));

/** A client with nothing behind it: it records what it is asked and lets the test push a view. */
function fakeClient() {
  let current: TelemetryView = { state: initialTelemetryState, series: new Map() };
  const listeners = new Set<() => void>();
  const client: TelemetryClient = {
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    }),
    getView: vi.fn(() => current),
    setWatch: vi.fn(),
    retry: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    client,
    push(next: TelemetryView) {
      current = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

describe('telemetry hooks', () => {
  let made: ReturnType<typeof fakeClient>[];

  beforeEach(() => {
    vi.useFakeTimers();
    resetStore(useTelemetryStore);
    made = [];
    vi.mocked(createTelemetryClient).mockImplementation(() => {
      const fake = fakeClient();
      made.push(fake);
      return fake.client;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(createTelemetryClient).mockReset();
  });

  describe('useTelemetry', () => {
    it('makes one client and fills the store with it', () => {
      renderHook(() => useTelemetry());

      expect(createTelemetryClient).toHaveBeenCalledTimes(1);
      expect(useTelemetryStore.getState().client).toBe(made[0]?.client);
    });

    it('shows the store what the client changes', () => {
      renderHook(() => useTelemetry());
      const next: TelemetryView = {
        state: { ...initialTelemetryState, socket: 'live', upstream: 'live' },
        series: new Map(),
      };

      act(() => made[0]?.push(next));

      expect(useTelemetryStore.getState().view).toBe(next);
    });

    it('disposes the client once and resets the store when unmounted', () => {
      const { unmount } = renderHook(() => useTelemetry());

      unmount();

      expect(made[0]?.client.dispose).toHaveBeenCalledTimes(1);
      expect(useTelemetryStore.getState().client).toBeNull();
      expect(useTelemetryStore.getState().view.state).toBe(initialTelemetryState);
    });

    it('leaves one live client under StrictMode, the first disposed', () => {
      renderHook(() => useTelemetry(), { wrapper: StrictMode });

      expect(made).toHaveLength(2);
      expect(made[0]?.client.dispose).toHaveBeenCalledTimes(1);
      expect(made[1]?.client.dispose).not.toHaveBeenCalled();
      expect(useTelemetryStore.getState().client).toBe(made[1]?.client);
    });
  });

  describe('useTelemetryWatch', () => {
    const setup = (codes: readonly string[]) =>
      renderHook(
        ({ wanted }) => {
          useTelemetry();
          useTelemetryWatch(wanted);
        },
        { initialProps: { wanted: codes } },
      );
    const settle = (ms = 200) => act(() => void vi.advanceTimersByTime(ms));

    it('sends the set once it has held still for 200 ms, not before', () => {
      setup(['CT-01', 'CT-02']);

      settle(199);
      expect(made[0]?.client.setWatch).not.toHaveBeenCalled();
      settle(1);

      expect(made[0]?.client.setWatch).toHaveBeenCalledExactlyOnceWith(['CT-01', 'CT-02']);
    });

    it('sends only the last of a quick run of changes', () => {
      const { rerender } = setup(['CT-01']);

      settle(100);
      rerender({ wanted: ['CT-02'] });
      settle(100);
      rerender({ wanted: ['CT-03'] });
      settle(200);

      expect(made[0]?.client.setWatch).toHaveBeenCalledExactlyOnceWith(['CT-03']);
    });

    it('sends nothing more for an equal set in a new array', () => {
      const { rerender } = setup(['CT-01']);
      settle();
      expect(made[0]?.client.setWatch).toHaveBeenCalledTimes(1);

      rerender({ wanted: ['CT-01'] });
      settle(1_000);

      expect(made[0]?.client.setWatch).toHaveBeenCalledTimes(1);
    });

    it('sends an empty set as an empty list', () => {
      const { rerender } = setup(['CT-01']);
      settle();

      rerender({ wanted: [] });
      settle();

      expect(made[0]?.client.setWatch).toHaveBeenLastCalledWith([]);
    });

    it('waits for a client, then sends', () => {
      renderHook(() => useTelemetryWatch(['CT-01']));
      settle(1_000);
      const fake = fakeClient();

      act(() => void useTelemetryStore.getState().adopt(fake.client));
      settle();

      expect(fake.client.setWatch).toHaveBeenCalledExactlyOnceWith(['CT-01']);
    });

    it('sends the set to a new client', () => {
      setup(['CT-01']);
      settle();
      const second = fakeClient();

      act(() => void useTelemetryStore.getState().adopt(second.client));
      settle();

      expect(second.client.setWatch).toHaveBeenCalledExactlyOnceWith(['CT-01']);
    });

    it('does not clear the set when the caller unmounts', () => {
      const { unmount } = renderHook(() => useTelemetryWatch(['CT-01']));
      const fake = fakeClient();
      act(() => void useTelemetryStore.getState().adopt(fake.client));
      settle();

      unmount();
      settle(1_000);

      expect(fake.client.setWatch).toHaveBeenCalledTimes(1);
    });
  });

  describe('retryTelemetry', () => {
    it('asks the live client to reconnect', () => {
      renderHook(() => useTelemetry());

      retryTelemetry();

      expect(made[0]?.client.retry).toHaveBeenCalledTimes(1);
    });

    it('does nothing while no client is mounted', () => {
      expect(() => retryTelemetry()).not.toThrow();
    });
  });
});
