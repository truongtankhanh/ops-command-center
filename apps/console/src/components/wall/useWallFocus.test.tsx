import type { Incident } from '@occ/contracts';
import { act, renderHook } from '@testing-library/react';
import { queryKeys } from '../../api/queries';
import { twinCommands } from '../../lib/twin-core/twinCommands';
import { WALL_HOLD_MS } from '../../lib/wall/wallFocus';
import { useConsole } from '../../store';
import { createTestQueryClient, queryWrapper, resetStore } from '../../test-utils';
import { useWallFocus } from './useWallFocus';

// The rig is the twin's; what is asserted here is what the wall asks of it.
vi.mock('../../lib/twin-core/twinCommands', () => ({
  twinCommands: { flyToIncident: vi.fn(), home: vi.fn() },
}));

const incident = (id: string, overrides: Partial<Incident> = {}): Incident => ({
  id,
  code: `INC-${id}`,
  type: 'equipment_fault',
  severity: 'critical',
  status: 'open',
  title: `Title ${id}`,
  description: null,
  zoneId: 'z1',
  position: [108.44, 11.95],
  source: 'telemetry',
  reportedAt: '2026-10-08T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

function setup(initial: Incident[] = []) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.incidents, initial);
  const view = renderHook(() => useWallFocus(), { wrapper: queryWrapper(client) });
  /**
   * The cache after a live event or a refetch: a changed incident carries a higher `version`. Query's notifier hands the
   * change to its observers on a `setTimeout(0)`, which fake timers hold back, so it is run here and the hook has seen the
   * list when this returns (and the second the countdown starts from is not lost).
   */
  const publish = (list: Incident[]) =>
    act(() => {
      client.setQueryData(queryKeys.incidents, list);
      vi.advanceTimersByTime(0);
    });
  const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
  return { ...view, publish, wait };
}

describe('useWallFocus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore(useConsole);
    useConsole.setState({ wall: 1 });
    vi.mocked(twinCommands.flyToIncident).mockClear();
    vi.mocked(twinCommands.home).mockClear();
    // A safety net: a query a case does not seed stays pending, and no request leaves the test.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('flies to a new critical incident, counts down from 60 and sets the wall’s own focus', () => {
    const { result, publish } = setup();
    expect(result.current).toEqual({ incidentId: null, secondsLeft: 0, returned: false });

    publish([incident('a')]);

    expect(result.current).toEqual({ incidentId: 'a', secondsLeft: 60, returned: false });
    expect(twinCommands.flyToIncident).toHaveBeenCalledExactlyOnceWith('a');
    expect(useConsole.getState().wallFocusId).toBe('a');
  });

  it('never selects the incident, because that opens the detail sheet', () => {
    const { publish } = setup();

    publish([incident('a')]);

    expect(useConsole.getState().selectedIncidentId).toBeNull();
  });

  it('does not fly to what was already open when the wall started', () => {
    const { result } = setup([incident('a')]);

    expect(result.current.incidentId).toBeNull();
    expect(twinCommands.flyToIncident).not.toHaveBeenCalled();
  });

  it('ignores an incident that is not critical', () => {
    const { result, publish } = setup();

    publish([incident('h', { severity: 'high' })]);

    expect(result.current.incidentId).toBeNull();
    expect(twinCommands.flyToIncident).not.toHaveBeenCalled();
  });

  it('counts the seconds down and goes home at 60 s', () => {
    const { result, publish, wait } = setup();
    publish([incident('a')]);

    wait(1000);
    expect(result.current.secondsLeft).toBe(59);
    wait(WALL_HOLD_MS - 2000);
    expect(result.current.secondsLeft).toBe(1);
    expect(twinCommands.home).not.toHaveBeenCalled();

    wait(1000);

    expect(result.current).toEqual({ incidentId: null, secondsLeft: 0, returned: true });
    expect(twinCommands.home).toHaveBeenCalledOnce();
    expect(useConsole.getState().wallFocusId).toBeNull();
  });

  it('goes home as soon as the incident is acknowledged', () => {
    const { result, publish, wait } = setup();
    publish([incident('a')]);
    wait(10_000);

    publish([incident('a', { status: 'acknowledged', version: 2 })]);

    expect(result.current.incidentId).toBeNull();
    expect(result.current.returned).toBe(true);
    expect(twinCommands.home).toHaveBeenCalledOnce();
  });

  it('is replaced by a second critical incident, which restarts the 60 s, without going home between', () => {
    const { result, publish, wait } = setup();
    publish([incident('a')]);
    wait(30_000);

    publish([incident('a'), incident('b', { reportedAt: '2026-10-08T08:00:30.000Z' })]);

    expect(result.current).toEqual({ incidentId: 'b', secondsLeft: 60, returned: false });
    expect(twinCommands.flyToIncident).toHaveBeenLastCalledWith('b');
    expect(twinCommands.home).not.toHaveBeenCalled();
    expect(useConsole.getState().wallFocusId).toBe('b');
  });

  it('runs no timer while idle, and one while a focus is held', () => {
    const { publish, wait } = setup();
    expect(vi.getTimerCount()).toBe(0);

    publish([incident('a')]);
    expect(vi.getTimerCount()).toBe(1);

    wait(WALL_HOLD_MS);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets go of the focus when it unmounts', () => {
    const { publish, unmount } = setup();
    publish([incident('a')]);

    unmount();

    expect(useConsole.getState().wallFocusId).toBeNull();
  });

  it('does nothing outside wall mode: the console’s camera is only moved by a person', () => {
    useConsole.setState({ wall: null });
    const { result, publish, wait } = setup();

    publish([incident('a')]);
    wait(5000);

    expect(result.current.incidentId).toBeNull();
    expect(twinCommands.flyToIncident).not.toHaveBeenCalled();
    expect(twinCommands.home).not.toHaveBeenCalled();
    expect(useConsole.getState().wallFocusId).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
