import type { Incident } from '@occ/contracts';
import {
  next,
  secondsLeft,
  WALL_CAMPUS,
  WALL_HOLD_MS,
  type WallFocusEvent,
  type WallFocusState,
  wallFocusEvents,
} from './wallFocus';

const created = (
  id: string,
  overrides: Partial<Extract<WallFocusEvent, { type: 'incident-created' }>> = {},
): WallFocusEvent => ({
  type: 'incident-created',
  id,
  severity: 'critical',
  status: 'open',
  version: 1,
  ...overrides,
});

const updated = (
  id: string,
  status: 'open' | 'acknowledged' | 'resolved',
  version: number,
): WallFocusEvent => ({ type: 'incident-updated', id, status, version });

const TICK: WallFocusEvent = { type: 'tick' };

/** The machine run over `steps`, each an event at a time. */
function run(
  steps: [WallFocusEvent, number][],
  from: WallFocusState = WALL_CAMPUS,
): WallFocusState {
  return steps.reduce((state, [event, at]) => next(state, event, at), from);
}

const held = (incidentId: string, since: number, version = 1): WallFocusState => ({
  phase: 'focus',
  incidentId,
  version,
  since,
});

describe('next', () => {
  it('starts on the campus view', () => {
    expect(WALL_CAMPUS).toEqual({ phase: 'campus' });
  });

  describe('a critical incident', () => {
    it('takes the focus, with the hold starting now', () => {
      expect(next(WALL_CAMPUS, created('a'), 5_000)).toEqual(held('a', 5_000));
    });

    it('is replaced by a newer critical, which restarts the 60 s', () => {
      const state = run([
        [created('a'), 1_000],
        [created('b', { version: 3 }), 30_000],
      ]);

      expect(state).toEqual(held('b', 30_000, 3));
      // 60 s after the first would have ended it; the second holds until 90 s.
      expect(next(state, TICK, 61_000)).toBe(state);
      expect(next(state, TICK, 90_000)).toEqual(WALL_CAMPUS);
    });

    it('is not taken when it arrives already acknowledged or resolved', () => {
      expect(next(WALL_CAMPUS, created('a', { status: 'acknowledged' }), 0)).toBe(WALL_CAMPUS);
      expect(next(WALL_CAMPUS, created('a', { status: 'resolved' }), 0)).toBe(WALL_CAMPUS);
    });

    it('seen again with a version the machine has leaves the hold alone', () => {
      const state = held('a', 1_000, 2);

      expect(next(state, created('a', { version: 2 }), 20_000)).toBe(state);
      expect(next(state, created('a', { version: 1 }), 20_000)).toBe(state);
    });
  });

  describe('any other severity', () => {
    it.each(['high', 'medium', 'low'] as const)('%s is ignored on the campus view', (severity) => {
      expect(next(WALL_CAMPUS, created('a', { severity }), 0)).toBe(WALL_CAMPUS);
    });

    it('does not replace a critical that is held, nor restart its clock', () => {
      const state = held('a', 1_000);

      expect(next(state, created('b', { severity: 'high' }), 30_000)).toBe(state);
    });
  });

  describe('the incident held', () => {
    it('ends when it is acknowledged, before the 60 s', () => {
      const state = run([
        [created('a'), 0],
        [updated('a', 'acknowledged', 2), 10_000],
      ]);

      expect(state).toEqual(WALL_CAMPUS);
    });

    it('ends when it is resolved', () => {
      expect(next(held('a', 0), updated('a', 'resolved', 2), 5_000)).toEqual(WALL_CAMPUS);
    });

    it('goes on when an update leaves it open, and keeps the newer version', () => {
      const state = next(held('a', 0), updated('a', 'open', 2), 5_000);

      expect(state).toEqual(held('a', 0, 2));
    });

    it('ends when it is removed', () => {
      expect(next(held('a', 0), { type: 'incident-removed', id: 'a' }, 5_000)).toEqual(WALL_CAMPUS);
    });

    it('does not fly to another critical that is still open when it ends', () => {
      // `b` was open all along; nothing says it is new, so the wall returns to the campus and stays.
      const state = run([
        [created('a'), 0],
        [updated('a', 'acknowledged', 2), 10_000],
        [TICK, 20_000],
      ]);

      expect(state).toEqual(WALL_CAMPUS);
    });
  });

  describe('an update with a version that is not higher', () => {
    it.each([1, 2])('is ignored, whatever it says (version %i against 2)', (version) => {
      const state = held('a', 0, 2);

      expect(next(state, updated('a', 'resolved', version), 5_000)).toBe(state);
    });

    it('is ignored when it would end the hold, and a higher one then ends it', () => {
      const state = held('a', 0, 3);

      expect(next(state, updated('a', 'acknowledged', 2), 1_000)).toBe(state);
      expect(next(state, updated('a', 'acknowledged', 4), 2_000)).toEqual(WALL_CAMPUS);
    });
  });

  describe('events about another incident', () => {
    it('change nothing', () => {
      const state = held('a', 0);

      expect(next(state, updated('b', 'resolved', 9), 1_000)).toBe(state);
      expect(next(state, { type: 'incident-removed', id: 'b' }, 1_000)).toBe(state);
    });
  });

  describe('on the campus view', () => {
    it('an update, a removal and a tick change nothing', () => {
      expect(next(WALL_CAMPUS, updated('a', 'acknowledged', 2), 0)).toBe(WALL_CAMPUS);
      expect(next(WALL_CAMPUS, { type: 'incident-removed', id: 'a' }, 0)).toBe(WALL_CAMPUS);
      expect(next(WALL_CAMPUS, TICK, 1e9)).toBe(WALL_CAMPUS);
    });
  });

  describe('the clock', () => {
    it('holds until the last millisecond before 60 s and ends at exactly 60 s', () => {
      const state = held('a', 10_000);

      expect(next(state, TICK, 10_000 + WALL_HOLD_MS - 1)).toBe(state);
      expect(next(state, TICK, 10_000 + WALL_HOLD_MS)).toEqual(WALL_CAMPUS);
    });

    it('ends when the clock jumps far ahead', () => {
      expect(next(held('a', 0), TICK, 3_600_000)).toEqual(WALL_CAMPUS);
    });

    it('starts the hold again from the clock when it goes backwards, and does not end it', () => {
      const state = held('a', 100_000);

      const after = next(state, TICK, 40_000);

      expect(after).toEqual(held('a', 40_000));
      expect(next(after, TICK, 40_000 + WALL_HOLD_MS - 1)).toBe(after);
      expect(next(after, TICK, 40_000 + WALL_HOLD_MS)).toEqual(WALL_CAMPUS);
    });
  });

  it('never reads the clock itself', () => {
    const now = vi.spyOn(Date, 'now');
    const perf = vi.spyOn(performance, 'now');

    run([
      [created('a'), 0],
      [TICK, 61_000],
    ]);
    secondsLeft(held('a', 0), 1_000);

    expect(now).not.toHaveBeenCalled();
    expect(perf).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('secondsLeft', () => {
  it('is 0 on the campus view', () => {
    expect(secondsLeft(WALL_CAMPUS, 123)).toBe(0);
  });

  it('reads 60 when the hold begins and counts down, rounding up', () => {
    const state = held('a', 5_000);

    expect(secondsLeft(state, 5_000)).toBe(60);
    expect(secondsLeft(state, 5_001)).toBe(60);
    expect(secondsLeft(state, 6_000)).toBe(59);
    expect(secondsLeft(state, 64_000)).toBe(1);
    expect(secondsLeft(state, 64_999)).toBe(1);
  });

  it('is 0 at 60 s and after', () => {
    const state = held('a', 0);

    expect(secondsLeft(state, WALL_HOLD_MS)).toBe(0);
    expect(secondsLeft(state, WALL_HOLD_MS + 5_000)).toBe(0);
  });

  it('never leaves 0 – 60 when the clock goes backwards', () => {
    expect(secondsLeft(held('a', 100_000), 40_000)).toBe(60);
  });
});

const incident = (id: string, overrides: Partial<Incident> = {}): Incident => ({
  id,
  code: id.toUpperCase(),
  type: 'fire_alarm',
  severity: 'critical',
  status: 'open',
  title: id,
  description: null,
  zoneId: 'z1',
  position: [108.44, 11.95],
  source: 'operator',
  reportedAt: '2026-10-21T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

describe('wallFocusEvents', () => {
  it('treats the first list as a baseline: what was open when the wall started is not news', () => {
    expect(wallFocusEvents(undefined, [incident('a'), incident('b')])).toEqual([]);
  });

  it('says nothing for a list that did not change, or whose versions did not go up', () => {
    const list = [incident('a', { version: 3 })];

    expect(wallFocusEvents(list, [incident('a', { version: 3 })])).toEqual([]);
    expect(wallFocusEvents(list, [incident('a', { version: 2, status: 'resolved' })])).toEqual([]);
  });

  it('says an incident that is new was created, with what the machine needs of it', () => {
    expect(wallFocusEvents([], [incident('a', { severity: 'high', version: 2 })])).toEqual([
      created('a', { severity: 'high', version: 2 }),
    ]);
  });

  it('says a higher version was an update, with its status', () => {
    expect(
      wallFocusEvents([incident('a')], [incident('a', { version: 2, status: 'acknowledged' })]),
    ).toEqual([updated('a', 'acknowledged', 2)]);
  });

  it('says an incident that is gone was removed', () => {
    expect(wallFocusEvents([incident('a'), incident('b')], [incident('b')])).toEqual([
      { type: 'incident-removed', id: 'a' },
    ]);
  });

  it('orders removed, updated, created, and the created ones oldest first', () => {
    const events = wallFocusEvents(
      [incident('gone'), incident('held')],
      [
        incident('held', { version: 2, status: 'acknowledged' }),
        incident('late', { reportedAt: '2026-10-21T08:05:00.000Z' }),
        incident('early', { reportedAt: '2026-10-21T08:01:00.000Z' }),
      ],
    );

    expect(
      events.map((event) => ('id' in event ? `${event.type}:${event.id}` : event.type)),
    ).toEqual([
      'incident-removed:gone',
      'incident-updated:held',
      'incident-created:early',
      'incident-created:late',
    ]);
  });

  it('ends on the newest critical when several arrive in one read', () => {
    const events = wallFocusEvents(
      [],
      [
        incident('newest', { reportedAt: '2026-10-21T08:05:00.000Z' }),
        incident('older', { reportedAt: '2026-10-21T08:01:00.000Z' }),
      ],
    );

    const state = events.reduce((state, event) => next(state, event, 1_000), WALL_CAMPUS);

    expect(state).toMatchObject({ phase: 'focus', incidentId: 'newest' });
  });

  it('lets an acknowledgement of the incident held and a new critical in one read end on the new one', () => {
    const events = wallFocusEvents(
      [incident('held')],
      [incident('held', { version: 2, status: 'acknowledged' }), incident('fresh')],
    );

    const state = events.reduce((state, event) => next(state, event, 1_000), held('held', 0));

    expect(state).toMatchObject({ phase: 'focus', incidentId: 'fresh' });
  });
});
