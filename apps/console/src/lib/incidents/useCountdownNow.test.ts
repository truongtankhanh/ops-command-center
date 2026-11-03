import type { Incident } from '@occ/contracts';
import { act, renderHook } from '@testing-library/react';
import { ATTENTION_THRESHOLD_MS } from './attentionCountdown';
import { COUNTDOWN_TICK_UNDER_MS, useCountdownNow } from './useCountdownNow';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const NOW = Date.parse('2026-10-01T12:00:00.000Z');

let sequence = 0;
/** An incident with `remainingMs` left of its attention time at `NOW` (negative once it is overdue). */
const incident = (remainingMs: number, overrides: Partial<Incident> = {}): Incident => {
  sequence += 1;
  const severity = overrides.severity ?? 'medium';
  return {
    id: `i${sequence}`,
    code: `INC-${sequence}`,
    type: 'fire_alarm',
    severity,
    status: 'open',
    title: 'Test',
    description: null,
    zoneId: 'z1',
    position: [108.44, 11.95],
    source: 'operator',
    reportedAt: new Date(NOW - (ATTENTION_THRESHOLD_MS[severity] - remainingMs)).toISOString(),
    acknowledgedAt: null,
    resolvedAt: null,
    version: 1,
    ...overrides,
  };
};

// `document.hidden` is read-only in jsdom: define it per case, and dispatch the event inside `act` as a browser would.
let hidden = false;
function setHidden(next: boolean) {
  hidden = next;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

// Only the clock and the interval are faked, so React's own scheduling is untouched and `getTimerCount` counts this hook's timer.
describe('useCountdownNow', () => {
  beforeEach(() => {
    sequence = 0;
    hidden = false;
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  });
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(document, 'hidden');
  });

  const render = (incidents: readonly Incident[]) =>
    renderHook(({ list }) => useCountdownNow(list), { initialProps: { list: incidents } });
  const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

  it('starts at the current time', () => {
    const { result } = render([]);

    expect(result.current).toBe(NOW);
  });

  describe('far from every deadline', () => {
    it('ticks every 15 s, not before', () => {
      const { result } = render([incident(COUNTDOWN_TICK_UNDER_MS + MINUTE)]);

      advance(15 * SECOND - 1);
      expect(result.current).toBe(NOW);

      advance(1);
      expect(result.current).toBe(NOW + 15 * SECOND);
    });

    it('ticks every 15 s with no incident at all', () => {
      const { result } = render([]);

      advance(15 * SECOND);

      expect(result.current).toBe(NOW + 15 * SECOND);
    });

    it.each(['acknowledged', 'resolved'] as const)(
      'does not count a %s incident that is under ten minutes',
      (status) => {
        const at = new Date(NOW).toISOString();
        const { result } = render([
          incident(MINUTE, {
            status,
            acknowledgedAt: at,
            resolvedAt: status === 'resolved' ? at : null,
          }),
        ]);

        advance(SECOND);
        expect(result.current).toBe(NOW);

        advance(14 * SECOND);
        expect(result.current).toBe(NOW + 15 * SECOND);
      },
    );
  });

  describe('with an incident in its last ten minutes', () => {
    it('ticks every second', () => {
      const { result } = render([incident(COUNTDOWN_TICK_UNDER_MS - MINUTE)]);

      advance(SECOND - 1);
      expect(result.current).toBe(NOW);

      advance(1);
      expect(result.current).toBe(NOW + SECOND);

      advance(3 * SECOND);
      expect(result.current).toBe(NOW + 4 * SECOND);
    });

    it('counts an incident with exactly ten minutes left', () => {
      const { result } = render([incident(COUNTDOWN_TICK_UNDER_MS)]);

      advance(SECOND);

      expect(result.current).toBe(NOW + SECOND);
    });

    it('counts an overdue incident, whose time over keeps running', () => {
      const { result } = render([incident(-3 * MINUTE, { severity: 'critical' })]);

      advance(SECOND);

      expect(result.current).toBe(NOW + SECOND);
    });

    it('is enough that one incident of many is near its deadline', () => {
      const { result } = render([
        incident(COUNTDOWN_TICK_UNDER_MS + 5 * MINUTE),
        incident(COUNTDOWN_TICK_UNDER_MS - MINUTE),
        incident(COUNTDOWN_TICK_UNDER_MS + 9 * MINUTE),
      ]);

      advance(SECOND);

      expect(result.current).toBe(NOW + SECOND);
    });

    it('goes back to 15 s once the list has none that near', () => {
      const { result, rerender } = render([incident(COUNTDOWN_TICK_UNDER_MS - MINUTE)]);
      advance(3 * SECOND);
      expect(result.current).toBe(NOW + 3 * SECOND);

      rerender({ list: [] });

      advance(15 * SECOND - 1);
      expect(result.current).toBe(NOW + 3 * SECOND);
      advance(1);
      expect(result.current).toBe(NOW + 18 * SECOND);
    });

    it('notices an incident entering its last ten minutes at the next slow tick', () => {
      const { result } = render([incident(COUNTDOWN_TICK_UNDER_MS + 5 * SECOND)]);

      advance(15 * SECOND);
      expect(result.current).toBe(NOW + 15 * SECOND);

      advance(SECOND - 1);
      expect(result.current).toBe(NOW + 15 * SECOND);
      advance(1);
      expect(result.current).toBe(NOW + 16 * SECOND);
    });
  });

  describe('one timer', () => {
    it('serves any number of incidents with a single interval', () => {
      render(Array.from({ length: 50 }, () => incident(COUNTDOWN_TICK_UNDER_MS - MINUTE)));

      expect(vi.getTimerCount()).toBe(1);
    });

    it('keeps one interval when the period changes', () => {
      const { rerender } = render([]);
      expect(vi.getTimerCount()).toBe(1);

      rerender({ list: [incident(MINUTE)] });

      expect(vi.getTimerCount()).toBe(1);
    });

    it('is cleared on unmount', () => {
      const { unmount } = render([incident(MINUTE)]);
      expect(vi.getTimerCount()).toBe(1);

      unmount();

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('in a hidden tab', () => {
    it('has no timer at all', () => {
      hidden = true;
      const { result } = render([incident(MINUTE)]);

      expect(vi.getTimerCount()).toBe(0);
      advance(10 * MINUTE);
      expect(result.current).toBe(NOW);
    });

    it('stops the timer when the tab is hidden', () => {
      render([incident(MINUTE)]);
      expect(vi.getTimerCount()).toBe(1);

      setHidden(true);

      expect(vi.getTimerCount()).toBe(0);
    });

    it('reads the clock at once when the tab is back, then resumes', () => {
      hidden = true;
      const { result } = render([incident(COUNTDOWN_TICK_UNDER_MS - MINUTE)]);
      advance(5 * MINUTE);
      expect(result.current).toBe(NOW);

      setHidden(false);

      expect(result.current).toBe(NOW + 5 * MINUTE);
      expect(vi.getTimerCount()).toBe(1);
      advance(SECOND);
      expect(result.current).toBe(NOW + 5 * MINUTE + SECOND);
    });

    it('does not read the clock for a change that leaves the tab hidden', () => {
      hidden = true;
      const { result } = render([incident(MINUTE)]);
      advance(MINUTE);

      setHidden(true);

      expect(result.current).toBe(NOW);
    });
  });
});
