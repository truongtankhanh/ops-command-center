import type { Asset, Incident } from '@occ/contracts';
import {
  ALARM_HISTORY_MS,
  ALARM_RATE_WINDOW_MS,
  alarmRate,
  floodState,
  isPartial,
  noisyDevices,
  NOISY_TOP,
  NOISY_WINDOW_MS,
  RAISED_BUCKETS,
  raisedPerBucket,
  standingCount,
} from './alarmLoad';
import { INCIDENT_LIST_LIMIT } from './incidents';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** Thirty seconds past a minute: not a wall-clock boundary, so the flood's step at `now` is a step of its own. */
const NOW = Date.parse('2026-10-01T12:00:30.000Z');
const iso = (time: string) => `2026-10-01T${time}.000Z`;
const at = (time: string) => Date.parse(iso(time));
const ago = (ms: number, now = NOW) => new Date(now - ms).toISOString();

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

/** `count` incidents reported at the same instant. */
const burst = (count: number, reportedAt: string, overrides: Partial<Incident> = {}) =>
  Array.from({ length: count }, () => incident({ reportedAt, ...overrides }));

const asset = (id: string, code: string, name = `Asset ${code}`): Asset =>
  ({ id, code, name }) as Asset;

describe('alarmRate', () => {
  it('counts incidents of any source and status in (now - 10 min, now]', () => {
    const list = [
      incident({ reportedAt: ago(ALARM_RATE_WINDOW_MS) }), // exactly 10 min ago: out
      incident({ reportedAt: ago(ALARM_RATE_WINDOW_MS - SECOND), source: 'simulator' }),
      incident({ reportedAt: ago(0), source: 'telemetry', status: 'resolved' }),
    ];

    expect(alarmRate(list, NOW)).toBe(2);
  });

  it('is zero for an empty list', () => {
    expect(alarmRate([], NOW)).toBe(0);
  });

  it('counts an incident reported in the future (clock skew) as now, not dropped', () => {
    expect(alarmRate([incident({ reportedAt: ago(-5 * MINUTE) })], NOW)).toBe(1);
  });

  it('skips an incident whose date does not parse', () => {
    expect(alarmRate([incident({ reportedAt: 'not a date' }), incident()], NOW)).toBe(1);
  });
});

describe('floodState', () => {
  it('is calm for an empty list', () => {
    expect(floodState([], NOW)).toEqual({ flooding: false, since: null, rate: 0 });
  });

  it('is not a flood at 10 raised in 10 minutes', () => {
    const state = floodState(burst(10, ago(5 * MINUTE)), NOW);

    expect(state).toEqual({ flooding: false, since: null, rate: 10 });
  });

  it('is a flood at 11, since the first minute that counted them all', () => {
    const state = floodState(burst(11, ago(5 * MINUTE)), NOW); // reported 11:55:30

    expect(state).toEqual({ flooding: true, since: at('11:56:00'), rate: 11 });
  });

  it('floods at once when the eleventh is reported between two minutes', () => {
    const list = [...burst(10, iso('11:58:00')), incident({ reportedAt: iso('12:00:10') })];

    // At 12:00:00 there are 10; the step at `now` (12:00:30) sees 11.
    expect(floodState(list, NOW)).toEqual({ flooding: true, since: NOW, rate: 11 });
  });

  // 11 are raised in two groups so that the rate falls to `remaining` while the flood lasts: the first group leaves the
  // window at 11:40:30, the second at 11:45:30, and `now` is 11:42:30.
  describe('hysteresis', () => {
    const NOW_FALLING = at('11:42:30');
    const falling = (remaining: number) => [
      ...burst(11 - remaining, iso('11:30:30')),
      ...burst(remaining, iso('11:35:30')),
    ];

    it.each([9, 8, 7, 6, 5])('holds the flood through %i raised in 10 minutes', (remaining) => {
      expect(floodState(falling(remaining), NOW_FALLING)).toEqual({
        flooding: true,
        since: at('11:36:00'),
        rate: remaining,
      });
    });

    it.each([4, 1])('ends the flood at %i raised in 10 minutes', (remaining) => {
      expect(floodState(falling(remaining), NOW_FALLING)).toEqual({
        flooding: false,
        since: null,
        rate: remaining,
      });
    });

    it('never starts a flood between 5 and 10', () => {
      expect(floodState(burst(7, ago(5 * MINUTE)), NOW).flooding).toBe(false);
    });
  });

  describe('the replay', () => {
    it('keeps a flood that began two hours ago and never fell below 5, since its first minute', () => {
      // A burst of 11 at 10:00:30, then one a minute until now: the rate stays at 10 or so, always 5 or more.
      const list = [
        ...burst(11, iso('10:00:30')),
        ...Array.from({ length: 120 }, (_, minute) =>
          incident({ reportedAt: new Date(at('10:00:30') + (minute + 1) * MINUTE).toISOString() }),
        ),
      ];

      const state = floodState(list, NOW);

      expect(state.flooding).toBe(true);
      expect(state.since).toBe(at('10:01:00'));
    });

    it('reports the first step of its history for a flood that was already on', () => {
      // Two a minute for hours: 20 in every 10 minutes, so the first step of the 3-hour history already floods.
      const list = Array.from({ length: 2 * 240 }, (_, index) =>
        incident({ reportedAt: new Date(NOW - Math.floor(index / 2) * MINUTE).toISOString() }),
      );

      expect(floodState(list, NOW)).toMatchObject({
        flooding: true,
        since: at('09:01:00'), // the first minute boundary at or after now - 3 h (09:00:30)
      });
    });

    it('gives the same answer for the same list and clock, whatever the order of the list', () => {
      const list = [
        ...burst(6, iso('11:50:00')),
        ...burst(6, iso('11:54:00')),
        ...burst(3, iso('11:30:00')),
      ];

      expect(floodState([...list].reverse(), NOW)).toEqual(floodState(list, NOW));
      expect(floodState(list, NOW)).toEqual(floodState(list, NOW));
    });

    it('keeps `since` still while the clock moves inside a minute', () => {
      const list = burst(11, ago(5 * MINUTE));

      const first = floodState(list, NOW);
      const later = floodState(list, NOW + 20 * SECOND);

      expect(later.since).toBe(first.since);
    });

    it('counts an incident reported in the future as now', () => {
      const list = [...burst(10, ago(5 * MINUTE)), incident({ reportedAt: ago(-30 * MINUTE) })];

      expect(floodState(list, NOW)).toEqual({ flooding: true, since: NOW, rate: 11 });
    });
  });
});

describe('standingCount', () => {
  it('counts open incidents past their attention threshold, not acknowledged or younger ones', () => {
    const list = [
      incident({ severity: 'critical', reportedAt: ago(3 * MINUTE) }), // past 2 min
      incident({ severity: 'critical', reportedAt: ago(3 * MINUTE), status: 'acknowledged' }),
      incident({ severity: 'low', reportedAt: ago(3 * MINUTE) }), // 30 min
      incident({ severity: 'medium', reportedAt: ago(20 * MINUTE) }), // past 15 min
    ];

    expect(standingCount(list, NOW)).toBe(2);
  });

  it('is zero for an empty list', () => {
    expect(standingCount([], NOW)).toBe(0);
  });
});

describe('noisyDevices', () => {
  const assets = [
    asset('a1', 'AHU-1', 'Air handler 1'),
    asset('a2', 'AHU-2', 'Air handler 2'),
    asset('a3', 'CT-1', 'Cooling tower 1'),
  ];
  const raised = (assetId: string | null | undefined, ageMs: number) =>
    incident({ assetId, source: 'telemetry', reportedAt: ago(ageMs) });

  it('counts incidents by asset over the last 24 hours, most first', () => {
    const list = [
      raised('a2', HOUR),
      raised('a1', 2 * HOUR),
      raised('a1', 3 * HOUR),
      raised('a1', 4 * HOUR),
      raised('a2', 5 * HOUR),
      raised('a2', NOISY_WINDOW_MS + HOUR), // older than 24 h: out
    ];

    expect(noisyDevices(list, assets, NOW)).toEqual([
      { assetCode: 'AHU-1', name: 'Air handler 1', count: 3 },
      { assetCode: 'AHU-2', name: 'Air handler 2', count: 2 },
    ]);
  });

  it('leaves out an asset the catalogue lacks and incidents with no asset', () => {
    const list = [
      raised('unknown', HOUR),
      raised('unknown', 2 * HOUR),
      raised(null, HOUR),
      raised(undefined, HOUR),
      raised('a3', HOUR),
    ];

    expect(noisyDevices(list, assets, NOW)).toEqual([
      { assetCode: 'CT-1', name: 'Cooling tower 1', count: 1 },
    ]);
  });

  it('breaks a tie by the most recent incident, then by the lower code', () => {
    const catalogue = [asset('x', 'B-2'), asset('y', 'A-1'), asset('z', 'C-3'), asset('w', 'D-4')];
    const list = [
      raised('w', 5 * HOUR),
      raised('w', 6 * HOUR),
      raised('w', 7 * HOUR), // three: first
      raised('x', 30 * MINUTE),
      raised('x', 4 * HOUR),
      raised('y', 30 * MINUTE),
      raised('y', 4 * HOUR),
      raised('z', 2 * HOUR), // two as well, but older: after x and y
      raised('z', 4 * HOUR),
    ];

    expect(noisyDevices(list, catalogue, NOW).map((device) => device.assetCode)).toEqual([
      'D-4',
      'A-1', // the same count and the same latest as B-2: the lower code first
      'B-2',
      'C-3',
    ]);
  });

  it('lists at most five', () => {
    const catalogue = Array.from({ length: 7 }, (_, index) => asset(`a${index}`, `A-${index}`));
    const list = catalogue.flatMap((device, index) =>
      Array.from({ length: index + 1 }, () => raised(device.id, HOUR)),
    );

    const devices = noisyDevices(list, catalogue, NOW);

    expect(devices).toHaveLength(NOISY_TOP);
    expect(devices.map((device) => device.count)).toEqual([7, 6, 5, 4, 3]);
  });

  it('counts an incident reported in the future as now', () => {
    expect(noisyDevices([raised('a1', -10 * MINUTE)], assets, NOW)).toHaveLength(1);
  });

  it('is empty for an empty list or an empty catalogue', () => {
    expect(noisyDevices([], assets, NOW)).toEqual([]);
    expect(noisyDevices([raised('a1', HOUR)], [], NOW)).toEqual([]);
  });
});

describe('raisedPerBucket', () => {
  it('has one bar per 10 minutes of the last 3 hours, all zero for an empty list', () => {
    const bars = raisedPerBucket([], NOW);

    expect(bars).toHaveLength(RAISED_BUCKETS);
    expect(bars.every((bar) => bar === 0)).toBe(true);
  });

  it('puts each incident in its bar, oldest first, and drops what is 3 hours old or more', () => {
    const list = [
      incident({ reportedAt: ago(0) }), // newest bar
      incident({ reportedAt: ago(ALARM_RATE_WINDOW_MS - SECOND) }), // newest bar
      incident({ reportedAt: ago(ALARM_RATE_WINDOW_MS) }), // the one before
      incident({ reportedAt: ago(ALARM_HISTORY_MS - SECOND) }), // oldest bar
      incident({ reportedAt: ago(ALARM_HISTORY_MS) }), // exactly 3 h: out
      incident({ reportedAt: ago(ALARM_HISTORY_MS + HOUR) }), // out
    ];

    const bars = raisedPerBucket(list, NOW);

    expect(bars[RAISED_BUCKETS - 1]).toBe(2);
    expect(bars[RAISED_BUCKETS - 2]).toBe(1);
    expect(bars[0]).toBe(1);
    expect(bars.reduce((sum, bar) => sum + bar, 0)).toBe(4);
  });

  it('sums to the incidents of the last 3 hours and ends with the rate', () => {
    // 70 incidents three minutes apart reach back 3 h 27 min, so some fall outside the history.
    const list = Array.from({ length: 70 }, (_, index) =>
      incident({ reportedAt: ago(index * 3 * MINUTE + 10 * SECOND) }),
    );
    const inHistory = list.filter(
      (item) => NOW - Date.parse(item.reportedAt) < ALARM_HISTORY_MS,
    ).length;

    const bars = raisedPerBucket(list, NOW);

    expect(bars.reduce((sum, bar) => sum + bar, 0)).toBe(inHistory);
    expect(bars[RAISED_BUCKETS - 1]).toBe(alarmRate(list, NOW));
  });

  it('counts an incident reported in the future in the newest bar', () => {
    const bars = raisedPerBucket([incident({ reportedAt: ago(-5 * MINUTE) })], NOW);

    expect(bars[RAISED_BUCKETS - 1]).toBe(1);
  });
});

describe('isPartial', () => {
  const list = (count: number) => Array.from({ length: count }, () => incident());

  it('is false below the size the request asks for', () => {
    expect(isPartial([])).toBe(false);
    expect(isPartial(list(INCIDENT_LIST_LIMIT - 1))).toBe(false);
  });

  it('is true at the size the request asks for, and beyond (live events add to the cache)', () => {
    expect(isPartial(list(INCIDENT_LIST_LIMIT))).toBe(true);
    expect(isPartial(list(INCIDENT_LIST_LIMIT + 1))).toBe(true);
  });
});
