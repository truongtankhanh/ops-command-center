import {
  ALARM_AFTER_MS,
  ALARM_BEFORE_MS,
  RANGE_ROUND_MS,
  READING_RANGE_MAX_MS,
  READING_RANGES,
  type ReadingRange,
  type ReadingRangeContext,
  rangeCaption,
  rangeOffered,
  rangeWindow,
} from './readingRange';
import { formatClockTime } from '../shared/time';

const T0 = Date.parse('2026-11-04T08:00:00.000Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const BUCKET = 5 * SECOND;

const iso = (t: number): string => new Date(t).toISOString();

/** The window as epoch ms, so a case can do arithmetic on it. */
function msOf(range: { from: string; to: string } | null): { from: number; to: number } {
  if (range === null) throw new Error('expected a window, got null');
  return { from: Date.parse(range.from), to: Date.parse(range.to) };
}

const ALL_RANGES: readonly ReadingRange[] = ['15m', '1h', 'alarm'];

describe('READING_RANGES', () => {
  it('lists the three ranges in the switch order with frame 18 labels', () => {
    expect(READING_RANGES).toEqual([
      { id: '15m', label: '15 min' },
      { id: '1h', label: '1 h' },
      { id: 'alarm', label: 'Around the alarm' },
    ]);
  });

  it('holds the figures the brief and the API docs give', () => {
    expect(RANGE_ROUND_MS).toBe(30 * SECOND);
    expect(READING_RANGE_MAX_MS).toBe(HOUR);
    expect(ALARM_BEFORE_MS).toBe(10 * MINUTE);
    expect(ALARM_AFTER_MS).toBe(5 * MINUTE);
  });
});

describe('rangeWindow', () => {
  describe('15m and 1h', () => {
    it('reads the last 15 minutes up to now rounded down to 30 s', () => {
      expect(rangeWindow('15m', T0 + 12_345)).toEqual({
        from: iso(T0 - 15 * MINUTE),
        to: iso(T0),
      });
    });

    it('reads the last hour up to now rounded down to 30 s', () => {
      expect(rangeWindow('1h', T0 + 42_000)).toEqual({
        from: iso(T0 + 30 * SECOND - HOUR),
        to: iso(T0 + 30 * SECOND),
      });
    });

    it('makes 1h exactly 3,600,000 ms, never 3,600,001', () => {
      for (const offset of [0, 1, 29_999, 30_000, 59_999]) {
        const { from, to } = msOf(rangeWindow('1h', T0 + offset));
        expect(to - from).toBe(3_600_000);
      }
    });

    it.each(['15m', '1h'] as const)('ignores reportedAt for %s', (range) => {
      expect(rangeWindow(range, T0, iso(T0 - 20 * MINUTE))).toEqual(rangeWindow(range, T0));
      expect(rangeWindow(range, T0, 'not a date')).toEqual(rangeWindow(range, T0));
    });
  });

  describe('every window', () => {
    it.each(ALL_RANGES)(
      '%s has from before to, at most an hour, on 5 s buckets, as UTC ISO strings',
      (range) => {
        const result = rangeWindow(range, T0 + 17_777, iso(T0 - 20 * MINUTE + 2_345));
        const { from, to } = msOf(result);
        expect(from).toBeLessThan(to);
        expect(to - from).toBeLessThanOrEqual(READING_RANGE_MAX_MS);
        expect(from % BUCKET).toBe(0);
        expect(to % BUCKET).toBe(0);
        expect(result?.from).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(result?.to).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      },
    );
  });

  describe('the 30 s rounding', () => {
    it.each(ALL_RANGES)('%s gives the same strings within one 30 s', (range) => {
      const reportedAt = iso(T0 - 2 * MINUTE);
      const first = rangeWindow(range, T0, reportedAt);
      expect(rangeWindow(range, T0 + 1, reportedAt)).toEqual(first);
      expect(rangeWindow(range, T0 + 29_999, reportedAt)).toEqual(first);
    });

    it.each(ALL_RANGES)('%s gives new strings in the next 30 s', (range) => {
      const reportedAt = iso(T0 - 2 * MINUTE);
      const first = msOf(rangeWindow(range, T0 + 29_999, reportedAt));
      const next = msOf(rangeWindow(range, T0 + 30_000, reportedAt));
      expect(next.to).toBe(first.to + RANGE_ROUND_MS);
    });
  });

  describe('alarm', () => {
    it('is the 15-minute window around an alarm raised 20 minutes ago', () => {
      const raised = T0 - 20 * MINUTE;
      expect(rangeWindow('alarm', T0, iso(raised))).toEqual({
        from: iso(raised - 10 * MINUTE),
        to: iso(raised + 5 * MINUTE),
      });
    });

    it('floors both ends to the 5 s bucket, so a closed window is exactly 15 minutes', () => {
      const raised = T0 - 20 * MINUTE + 2_345;
      const { from, to } = msOf(rangeWindow('alarm', T0, iso(raised)));
      expect(from).toBe(T0 - 30 * MINUTE);
      expect(to).toBe(T0 - 15 * MINUTE);
      expect(to - from).toBe(15 * MINUTE);
    });

    it('does not move once its end has passed', () => {
      const reportedAt = iso(T0 - 20 * MINUTE);
      expect(rangeWindow('alarm', T0 + 5 * MINUTE, reportedAt)).toEqual(
        rangeWindow('alarm', T0, reportedAt),
      );
    });

    it('ends at now (rounded down to 30 s) for an alarm raised 2 minutes ago', () => {
      const raised = T0 - 2 * MINUTE;
      expect(rangeWindow('alarm', T0 + 12_000, iso(raised))).toEqual({
        from: iso(raised - 10 * MINUTE),
        to: iso(T0),
      });
    });

    it('clamps a reportedAt ahead of the clock (skew) to now', () => {
      const raised = T0 + 3 * MINUTE;
      expect(rangeWindow('alarm', T0 + SECOND, iso(raised))).toEqual({
        from: iso(T0 - 7 * MINUTE),
        to: iso(T0),
      });
    });

    it.each([
      ['exactly 10 minutes ahead', 10 * MINUTE],
      ['11 minutes ahead', 11 * MINUTE],
    ])('is null for a reportedAt %s (the window would be empty)', (_label, ahead) => {
      expect(rangeWindow('alarm', T0, iso(T0 + ahead))).toBeNull();
    });

    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['not a date', 'yesterday-ish'],
    ])('is null when reportedAt is %s', (_label, reportedAt) => {
      expect(rangeWindow('alarm', T0, reportedAt)).toBeNull();
    });

    it('accepts a reportedAt written with an offset and answers in UTC', () => {
      expect(rangeWindow('alarm', T0, '2026-11-04T14:40:00+07:00')).toEqual({
        from: '2026-11-04T07:30:00.000Z',
        to: '2026-11-04T07:45:00.000Z',
      });
    });
  });

  describe('a now that cannot be a window', () => {
    it.each(
      ALL_RANGES.flatMap((range) =>
        [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].map(
          (now) => [range, now] as const,
        ),
      ),
    )('%s at %d is null', (range, now) => {
      expect(rangeWindow(range, now, iso(T0 - 2 * MINUTE))).toBeNull();
    });

    it.each(['15m', '1h'] as const)('%s at a time beyond what Date can hold is null', (range) => {
      expect(() => rangeWindow(range, 9e15)).not.toThrow();
      expect(rangeWindow(range, 9e15)).toBeNull();
    });
  });
});

describe('rangeOffered', () => {
  type IncidentContext = Extract<ReadingRangeContext, { kind: 'incident' }>;
  const incident = (overrides: Partial<IncidentContext> = {}): IncidentContext => ({
    kind: 'incident',
    assetId: 'a1',
    reportedAt: iso(T0),
    ...overrides,
  });

  it.each(['15m', '1h'] as const)('always offers %s', (range) => {
    expect(rangeOffered(range, { kind: 'asset' })).toBe(true);
    expect(rangeOffered(range, incident())).toBe(true);
    expect(rangeOffered(range, incident({ assetId: null }))).toBe(true);
  });

  it('offers Around the alarm for an incident with an asset', () => {
    expect(rangeOffered('alarm', incident())).toBe(true);
  });

  it('never offers Around the alarm on an asset', () => {
    expect(rangeOffered('alarm', { kind: 'asset' })).toBe(false);
  });

  it.each([
    ['a null assetId', { assetId: null }],
    ['an empty assetId', { assetId: '' }],
    ['a reportedAt that does not parse', { reportedAt: 'not a date' }],
  ])('does not offer Around the alarm for an incident with %s', (_label, overrides) => {
    expect(rangeOffered('alarm', incident(overrides))).toBe(false);
  });

  it('does not offer Around the alarm for an incident without an assetId', () => {
    expect(rangeOffered('alarm', { kind: 'incident', reportedAt: iso(T0) })).toBe(false);
  });

  it('offers Around the alarm exactly when the incident has a raised time to build it from', () => {
    const offered = incident({ reportedAt: iso(T0 - 20 * MINUTE) });
    expect(rangeOffered('alarm', offered)).toBe(true);
    expect(rangeWindow('alarm', T0, offered.reportedAt)).not.toBeNull();
  });
});

// V3-23.3: the line under the switch. The clock times are the browser's own (`formatClockTime`), so the
// expected strings are built with it rather than written for one time zone.
describe('rangeCaption', () => {
  const HOUR_WINDOW = { from: T0 - HOUR, to: T0 };
  const ALARM_WINDOW = { from: T0 - 30 * MINUTE, to: T0 - 15 * MINUTE };
  const at = (t: number) => formatClockTime(t);

  it('says nothing for 15 min: the live ring has no fixed window', () => {
    expect(rangeCaption('15m', HOUR_WINDOW, null)).toBeNull();
  });

  it.each(['1h', 'alarm'] as const)('says nothing for %s while no window is known', (range) => {
    expect(rangeCaption(range, null, T0)).toBeNull();
  });

  it('gives the hour as two clock times joined by an en dash', () => {
    expect(rangeCaption('1h', HOUR_WINDOW, null)).toBe(`${at(T0 - HOUR)}–${at(T0)}`);
  });

  it('names the raised time around the alarm', () => {
    expect(rangeCaption('alarm', ALARM_WINDOW, T0 - 20 * MINUTE)).toBe(
      `${at(T0 - 30 * MINUTE)}–${at(T0 - 15 * MINUTE)} · raised ${at(T0 - 20 * MINUTE)}`,
    );
  });

  it.each([
    ['none', null],
    ['not a number', Number.NaN],
  ])('gives only the window around the alarm when the raised time is %s', (_label, markerAt) => {
    expect(rangeCaption('alarm', ALARM_WINDOW, markerAt)).toBe(
      `${at(T0 - 30 * MINUTE)}–${at(T0 - 15 * MINUTE)}`,
    );
  });

  it('never names a raised time on 1 h', () => {
    expect(rangeCaption('1h', HOUR_WINDOW, T0 - 20 * MINUTE)).toBe(`${at(T0 - HOUR)}–${at(T0)}`);
  });

  it('writes HH:MM times', () => {
    expect(rangeCaption('1h', HOUR_WINDOW, null)).toMatch(/^\d{2}:\d{2}–\d{2}:\d{2}$/);
  });
});
