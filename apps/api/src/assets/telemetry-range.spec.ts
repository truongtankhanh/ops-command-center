import {
  HISTORY_DEFAULT_WINDOW_MS,
  HISTORY_MAX_BUCKETS,
  HISTORY_MAX_SPAN_MS,
  resolveTelemetryRange,
} from './telemetry-range';

const NOW = new Date('2026-10-14T08:30:00.000Z');
const MINUTE = 60_000;

/** The range of a call that must be accepted. */
function accepted(query: { from?: string; to?: string }, now = NOW) {
  const range = resolveTelemetryRange(query, now);
  if (!range.ok) throw new Error(`refused: ${range.problems.join('; ')}`);
  return { from: range.from.toISOString(), to: range.to.toISOString() };
}

/** The reasons of a call that must be refused. */
function refused(query: { from?: string; to?: string }, now = NOW): string[] {
  const range = resolveTelemetryRange(query, now);
  if (range.ok) throw new Error('accepted');
  return range.problems;
}

describe('resolveTelemetryRange', () => {
  it('states the limits it applies: 15 minutes by default, 1 hour at most, 720 buckets', () => {
    expect(HISTORY_DEFAULT_WINDOW_MS).toBe(15 * MINUTE);
    expect(HISTORY_MAX_SPAN_MS).toBe(60 * MINUTE);
    expect(HISTORY_MAX_BUCKETS).toBe(720);
  });

  describe('defaults', () => {
    it('serves the last 15 minutes ending now when nothing is given', () => {
      expect(accepted({})).toEqual({
        from: '2026-10-14T08:15:00.000Z',
        to: '2026-10-14T08:30:00.000Z',
      });
    });

    it('ends now and starts at `from` when only `from` is given', () => {
      expect(accepted({ from: '2026-10-14T08:00:00Z' })).toEqual({
        from: '2026-10-14T08:00:00.000Z',
        to: '2026-10-14T08:30:00.000Z',
      });
    });

    it('starts 15 minutes before `to` when only `to` is given', () => {
      expect(accepted({ to: '2026-10-14T07:00:00Z' })).toEqual({
        from: '2026-10-14T06:45:00.000Z',
        to: '2026-10-14T07:00:00.000Z',
      });
    });

    it('uses both when both are given, and normalises an offset to the same instant', () => {
      expect(
        accepted({ from: '2026-10-14T15:00:00+07:00', to: '2026-10-14T08:15:00.250Z' }),
      ).toEqual({ from: '2026-10-14T08:00:00.000Z', to: '2026-10-14T08:15:00.250Z' });
    });
  });

  describe('limits', () => {
    it('accepts exactly one hour, which is 720 buckets of 5 seconds', () => {
      expect(accepted({ from: '2026-10-14T07:00:00Z', to: '2026-10-14T08:00:00Z' })).toEqual({
        from: '2026-10-14T07:00:00.000Z',
        to: '2026-10-14T08:00:00.000Z',
      });
    });

    it('refuses one millisecond more, naming the limit', () => {
      const problems = refused({ from: '2026-10-14T07:00:00Z', to: '2026-10-14T08:00:00.001Z' });

      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('1 hour');
      expect(problems[0]).toContain('720 buckets');
    });

    it('refuses a `from` more than an hour before now when `to` is left to default', () => {
      expect(refused({ from: '2026-10-14T07:29:59Z' })).toHaveLength(1);
      expect(accepted({ from: '2026-10-14T07:30:00Z' }).from).toBe('2026-10-14T07:30:00.000Z');
    });

    it('refuses a `to` before `from`', () => {
      expect(refused({ from: '2026-10-14T08:00:00Z', to: '2026-10-14T07:59:59.999Z' })).toEqual([
        'to must not be before from',
      ]);
    });

    it('accepts `from` equal to `to`: an empty range, not an error', () => {
      expect(accepted({ from: '2026-10-14T08:00:00Z', to: '2026-10-14T08:00:00Z' })).toEqual({
        from: '2026-10-14T08:00:00.000Z',
        to: '2026-10-14T08:00:00.000Z',
      });
    });

    it('accepts a `to` in the future when the span is within the limit', () => {
      expect(accepted({ from: '2026-10-14T08:30:00Z', to: '2026-10-14T09:30:00Z' }).to).toBe(
        '2026-10-14T09:30:00.000Z',
      );
    });
  });

  describe('a value that is not a date', () => {
    it('is named, and never reaches the comparison', () => {
      expect(refused({ from: 'nope', to: '2026-10-14T08:00:00Z' })).toEqual([
        'from must be an ISO 8601 date and time',
      ]);
      expect(refused({ to: 'nope' })).toEqual(['to must be an ISO 8601 date and time']);
    });

    it('lists both fields when both are wrong', () => {
      expect(refused({ from: 'a', to: 'b' })).toEqual([
        'to must be an ISO 8601 date and time',
        'from must be an ISO 8601 date and time',
      ]);
    });
  });
});
