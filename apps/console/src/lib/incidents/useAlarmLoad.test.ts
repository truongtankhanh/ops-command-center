import type { Asset, Incident } from '@occ/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { api } from '../../api/client';
import { queryKeys } from '../../api/queries';
import { createTestQueryClient, queryWrapper } from '../../test-utils';
import { ALARM_RATE_WINDOW_MS, RAISED_BUCKETS } from './alarmLoad';
import { useAlarmLoad } from './useAlarmLoad';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const NOW = Date.parse('2026-10-01T12:00:30.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

let sequence = 0;
const incident = (overrides: Partial<Incident> = {}): Incident => {
  sequence += 1;
  return {
    id: `i${sequence}`,
    code: `INC-${sequence}`,
    type: 'fire_alarm',
    severity: 'medium',
    status: 'open',
    title: 'Test',
    description: null,
    zoneId: 'z1',
    position: [108.44, 11.95],
    source: 'operator',
    reportedAt: ago(MINUTE),
    acknowledgedAt: null,
    resolvedAt: null,
    version: 1,
    ...overrides,
  };
};

const ROUTER: Asset = {
  id: 'asset-rt-01',
  code: 'RT-01',
  name: 'Core router',
  class: {
    id: 'class-router',
    code: 'router',
    name: 'Router',
    modelUrl: null,
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  zoneId: 'z1',
  position: [108.44, 11.95],
  elevationM: 0,
  headingDeg: 0,
  headline: [],
};

// The clock is the hook's only state (`useNow`): the timers that drive it are faked, and a seeded list makes no request
// (`useIncidents` never goes stale), so a case that must not see a request holds the other one back with a promise that never settles.
describe('useAlarmLoad', () => {
  let client: QueryClient;

  beforeEach(() => {
    sequence = 0;
    client = createTestQueryClient();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const render = () => renderHook(() => useAlarmLoad(), { wrapper: queryWrapper(client) });
  const hold = () => vi.spyOn(api, 'get').mockReturnValue(new Promise(() => undefined));
  // A change made to the cache from outside reaches the hook on a `setTimeout(0)` (TanStack's notify batch). Only the clock's timers
  // are faked, so a real one is awaited; `waitFor` is not used, it polls with the `setInterval` that is faked here.
  const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

  describe('before the list arrives', () => {
    it('is not loaded, and every measure is a zero or an empty value, never a number to draw', () => {
      hold();
      const { result } = render();

      expect(result.current).toMatchObject({
        loaded: false,
        failed: false,
        now: 0,
        rate: 0,
        standing: 0,
        noisy: [],
        noisyKnown: false,
        partial: false,
      });
      expect(result.current.flood).toEqual({ flooding: false, since: null, rate: 0 });
      expect(result.current.buckets).toEqual(Array.from({ length: RAISED_BUCKETS }, () => 0));
    });

    it('keeps one value across renders, so a consumer’s memo holds', () => {
      hold();
      const { result, rerender } = render();
      const first = result.current;

      rerender();

      expect(result.current).toBe(first);
    });
  });

  describe('when the list fails', () => {
    it('says so, once nothing is cached, and is still not loaded', async () => {
      vi.spyOn(api, 'get').mockRejectedValue(new Error('down'));
      const { result } = render();

      await waitFor(() => expect(result.current.failed).toBe(true));

      expect(result.current.loaded).toBe(false);
      expect(result.current.rate).toBe(0);
    });
  });

  describe('once the list is in', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
      vi.setSystemTime(NOW);
      hold();
    });

    const seed = (incidents: Incident[]) => client.setQueryData(queryKeys.incidents, incidents);

    it('is loaded and carries the clock the model was computed at', () => {
      seed([incident(), incident(), incident({ reportedAt: ago(2 * 60 * MINUTE) })]);
      const { result } = render();

      expect(result.current).toMatchObject({ loaded: true, failed: false, now: NOW, rate: 2 });
      expect(result.current.flood.flooding).toBe(false);
      expect(result.current.buckets).toHaveLength(RAISED_BUCKETS);
      expect(result.current.buckets.at(-1)).toBe(2);
      expect(result.current.partial).toBe(false);
    });

    it('is loaded for an empty list, with a rate of 0 that is known', () => {
      seed([]);
      const { result } = render();

      expect(result.current).toMatchObject({ loaded: true, rate: 0 });
    });

    it('floods above ten in ten minutes and says since when', () => {
      seed(Array.from({ length: 11 }, () => incident()));
      const { result } = render();

      expect(result.current.flood).toMatchObject({ flooding: true, rate: 11 });
      expect(result.current.flood.since).not.toBeNull();
    });

    it('counts the open incidents past their attention time as standing', () => {
      seed([
        incident({ severity: 'critical', reportedAt: ago(5 * MINUTE) }),
        incident({ severity: 'critical', reportedAt: ago(MINUTE) }),
      ]);
      const { result } = render();

      expect(result.current.standing).toBe(1);
    });

    it('moves the clock every 15 seconds, and lets an incident leave the 10-minute window', () => {
      seed([incident({ reportedAt: ago(ALARM_RATE_WINDOW_MS - 10 * SECOND) })]);
      const { result } = render();
      expect(result.current.rate).toBe(1);

      act(() => vi.advanceTimersByTime(15 * SECOND));

      expect(result.current.now).toBe(NOW + 15 * SECOND);
      expect(result.current.rate).toBe(0);
    });

    it('counts a live incident at once, between two ticks', async () => {
      seed([]);
      const { result } = render();

      act(() => {
        client.setQueryData(queryKeys.incidents, [
          incident({ reportedAt: new Date().toISOString() }),
        ]);
      });
      await settle();

      expect(result.current.rate).toBe(1);
    });

    it('stays loaded when a refetch fails over a cached list', async () => {
      seed([incident()]);
      const { result } = render();
      // `hold` never settles, so this case lets the requests fail instead.
      vi.spyOn(api, 'get').mockRejectedValue(new Error('down'));

      await act(async () => {
        await client.refetchQueries({ queryKey: queryKeys.incidents }).catch(() => undefined);
      });

      expect(result.current).toMatchObject({ loaded: true, failed: false, rate: 1 });
    });

    describe('the noisy devices', () => {
      const raised = () => incident({ assetId: ROUTER.id, reportedAt: ago(3 * 60 * MINUTE) });

      it('are not known until the catalogue arrives, and empty meanwhile', () => {
        seed([raised()]);
        const { result } = render();

        expect(result.current.noisyKnown).toBe(false);
        expect(result.current.noisy).toEqual([]);
      });

      it('are listed, and known, once it does', async () => {
        seed([raised(), raised()]);
        const { result } = render();

        act(() => {
          client.setQueryData(queryKeys.assets, [ROUTER]);
        });
        await settle();

        expect(result.current.noisyKnown).toBe(true);
        expect(result.current.noisy).toEqual([
          { assetCode: 'RT-01', name: 'Core router', count: 2 },
        ]);
      });

      it('are known and empty for a catalogue that no incident points into', () => {
        seed([incident()]);
        client.setQueryData(queryKeys.assets, [ROUTER]);
        const { result } = render();

        expect(result.current.noisyKnown).toBe(true);
        expect(result.current.noisy).toEqual([]);
      });
    });
  });
});
