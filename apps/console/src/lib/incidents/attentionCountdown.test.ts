import { INCIDENT_SEVERITIES, type Incident } from '@occ/contracts';
import {
  ATTENTION_SOON_FRACTION,
  ATTENTION_THRESHOLD_MS,
  type AttentionCountdown,
  attentionCountdown,
  countdownSpeech,
  formatCountdown,
} from './attentionCountdown';
import { ATTENTION_THRESHOLD_MS as THRESHOLDS_FROM_INCIDENTS, isPastAttention } from './incidents';

const T0 = Date.parse('2026-10-01T08:00:00.000Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

const incident = (overrides: Partial<Incident> = {}): Incident => ({
  id: 'i1',
  code: 'INC-000001',
  type: 'fire_alarm',
  severity: 'critical',
  status: 'open',
  title: 'Test',
  description: null,
  zoneId: 'z1',
  position: [108.44, 11.95],
  source: 'operator',
  reportedAt: new Date(T0).toISOString(),
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

describe('attentionCountdown', () => {
  it('keeps the thresholds of V1 and a quarter for "soon"', () => {
    expect(ATTENTION_THRESHOLD_MS).toEqual({
      critical: 2 * MINUTE,
      high: 5 * MINUTE,
      medium: 15 * MINUTE,
      low: 30 * MINUTE,
    });
    expect(ATTENTION_SOON_FRACTION).toBe(0.25);
    expect(THRESHOLDS_FROM_INCIDENTS).toBe(ATTENTION_THRESHOLD_MS);
  });

  describe.each(INCIDENT_SEVERITIES)('an open %s incident', (severity) => {
    const threshold = ATTENTION_THRESHOLD_MS[severity];
    const countdownAt = (offsetMs: number) =>
      attentionCountdown(incident({ severity }), T0 + offsetMs);

    it('is normal and full the moment it is reported', () => {
      expect(countdownAt(0)).toEqual({ state: 'normal', remainingMs: threshold, fraction: 1 });
    });

    it('is normal at 30 % left', () => {
      expect(countdownAt(threshold - (threshold * 3) / 10)?.state).toBe('normal');
    });

    it('is normal just above a quarter left, and soon at exactly a quarter', () => {
      expect(countdownAt(threshold - threshold / 4 - 1)?.state).toBe('normal');
      expect(countdownAt(threshold - threshold / 4)).toMatchObject({
        state: 'soon',
        remainingMs: threshold / 4,
        fraction: 0.25,
      });
    });

    it('is soon one second before the threshold', () => {
      expect(countdownAt(threshold - SECOND)).toMatchObject({
        state: 'soon',
        remainingMs: SECOND,
      });
    });

    it('is overdue exactly at the threshold, with nothing left', () => {
      expect(countdownAt(threshold)).toEqual({ state: 'overdue', remainingMs: 0, fraction: 0 });
    });

    it('goes on counting below zero once overdue, and keeps the fraction at 0', () => {
      expect(countdownAt(threshold + 130 * SECOND)).toEqual({
        state: 'overdue',
        remainingMs: -130 * SECOND,
        fraction: 0,
      });
    });

    it('has its fraction as the share of the time left', () => {
      expect(countdownAt(threshold / 2)?.fraction).toBe(0.5);
    });
  });

  describe('when there is no countdown', () => {
    it.each(['acknowledged', 'resolved'] as const)('is null for a %s incident', (status) => {
      expect(attentionCountdown(incident({ status }), T0 + HOUR)).toBeNull();
    });

    it('is null for a severity this console does not know', () => {
      const unknown = incident({ severity: 'catastrophic' as Incident['severity'] });
      expect(attentionCountdown(unknown, T0 + MINUTE)).toBeNull();
    });

    it('is null when the reported time cannot be read', () => {
      expect(attentionCountdown(incident({ reportedAt: 'not a date' }), T0 + MINUTE)).toBeNull();
    });
  });

  describe('clock skew', () => {
    it('counts a report from the future as made now: normal, full, never longer than the threshold', () => {
      const reported = incident({ reportedAt: new Date(T0 + 5 * MINUTE).toISOString() });

      expect(attentionCountdown(reported, T0)).toEqual({
        state: 'normal',
        remainingMs: ATTENTION_THRESHOLD_MS.critical,
        fraction: 1,
      });
    });
  });

  describe('a deadline of its own', () => {
    it('counts to the deadline given, with the time since the report as the whole', () => {
      const tenMinutes = () => T0 + 10 * MINUTE;

      expect(attentionCountdown(incident(), T0 + 9 * MINUTE, tenMinutes)).toEqual({
        state: 'soon',
        remainingMs: MINUTE,
        fraction: 0.1,
      });
      expect(attentionCountdown(incident(), T0 + 5 * MINUTE, tenMinutes)).toEqual({
        state: 'normal',
        remainingMs: 5 * MINUTE,
        fraction: 0.5,
      });
    });

    it('reads the incident it is given', () => {
      const deadlineOf = vi.fn((item: Incident) => Date.parse(item.reportedAt) + MINUTE);
      const given = incident();

      attentionCountdown(given, T0, deadlineOf);

      expect(deadlineOf).toHaveBeenCalledWith(given);
    });

    it('is overdue with nothing left, and no division by zero, when the deadline is not after the report', () => {
      for (const deadline of [T0, T0 - SECOND]) {
        expect(attentionCountdown(incident(), T0 + 5 * SECOND, () => deadline)).toMatchObject({
          state: 'overdue',
          fraction: 0,
        });
      }
    });

    it('is null when the deadline is not a time', () => {
      expect(attentionCountdown(incident(), T0, () => NaN)).toBeNull();
      expect(attentionCountdown(incident(), T0, () => Infinity)).toBeNull();
    });

    it('counts a severity the console does not know when the deadline comes from elsewhere', () => {
      const unknown = incident({ severity: 'catastrophic' as Incident['severity'] });

      expect(attentionCountdown(unknown, T0, () => T0 + MINUTE)?.state).toBe('normal');
    });

    it('is still null for an acknowledged incident whatever the deadline', () => {
      expect(
        attentionCountdown(incident({ status: 'acknowledged' }), T0, () => T0 + MINUTE),
      ).toBeNull();
    });
  });
});

describe('formatCountdown', () => {
  it.each([
    [7 * SECOND, '0:07'],
    [112 * SECOND, '1:52'],
    [30 * MINUTE, '30:00'],
    [59 * MINUTE + 59 * SECOND, '59:59'],
    [HOUR + 5 * MINUTE, '1h 05m'],
    [-3 * SECOND, '+0:03 over'],
    [-130 * SECOND, '+2:10 over'],
    [-(HOUR + 5 * MINUTE), '+1h 05m over'],
    [-(23 * HOUR + 59 * MINUTE + 59 * SECOND), '+23h 59m over'],
    [-24 * HOUR, '+1d 00h over'],
    [-(22 * 24 * HOUR + 15 * HOUR + 50 * MINUTE), '+22d 15h over'],
  ])('writes %i ms as %s', (remainingMs, text) => {
    expect(formatCountdown(remainingMs)).toBe(text);
  });

  it('rounds the time left up to the second, so 0:00 is never shown before the deadline', () => {
    expect(formatCountdown(1)).toBe('0:01');
    expect(formatCountdown(6001)).toBe('0:07');
    expect(formatCountdown(7000)).toBe('0:07');
  });

  it('rounds the time over down, so +0:00 over is the first second after the deadline', () => {
    expect(formatCountdown(0)).toBe('+0:00 over');
    expect(formatCountdown(-999)).toBe('+0:00 over');
    expect(formatCountdown(-1000)).toBe('+0:01 over');
  });
});

describe('countdownSpeech', () => {
  const speech = (remainingMs: number) => {
    const countdown: AttentionCountdown = { state: 'normal', remainingMs, fraction: 1 };
    return countdownSpeech(countdown);
  };

  it.each([
    [2 * MINUTE, 'attention time in 2 minutes'],
    [MINUTE, 'attention time in 1 minute'],
    [MINUTE + SECOND, 'attention time in 2 minutes'],
    [MINUTE - 1, 'attention time in less than a minute'],
    [1, 'attention time in less than a minute'],
    [0, 'just past attention time'],
    [-(MINUTE - 1), 'just past attention time'],
    [-MINUTE, 'past attention time by 1 minute'],
    [-(2 * MINUTE - 1), 'past attention time by 1 minute'],
    [-5 * MINUTE, 'past attention time by 5 minutes'],
    [-75 * MINUTE, 'past attention time by 75 minutes'],
  ])('says %i ms as "%s"', (remainingMs, text) => {
    expect(speech(remainingMs)).toBe(text);
  });

  it('says no seconds, and the same words all through a minute', () => {
    for (const remainingMs of [119 * SECOND, 90 * SECOND, 61 * SECOND]) {
      expect(speech(remainingMs)).toBe('attention time in 2 minutes');
    }
    for (const remainingMs of [-61 * SECOND, -90 * SECOND, -119 * SECOND]) {
      expect(speech(remainingMs)).toBe('past attention time by 1 minute');
    }
    for (const remainingMs of [7 * SECOND, 90 * SECOND, -30 * SECOND, -200 * SECOND]) {
      expect(speech(remainingMs)).not.toMatch(/second|\d:\d\d/);
    }
  });
});

describe('isPastAttention', () => {
  /** The rule as it was before the countdown, written out: the new one must give the same answer everywhere. */
  const before = (item: Incident, now: number) =>
    item.status === 'open' &&
    now - Date.parse(item.reportedAt) >= ATTENTION_THRESHOLD_MS[item.severity];

  it('answers as it did before for every severity and status, either side of the threshold and before the report', () => {
    for (const severity of INCIDENT_SEVERITIES) {
      const threshold = ATTENTION_THRESHOLD_MS[severity];
      for (const status of ['open', 'acknowledged', 'resolved'] as const) {
        for (const offset of [-MINUTE, 0, threshold - 1, threshold, threshold + 1, 24 * HOUR]) {
          const given = incident({ severity, status });
          expect(isPastAttention(given, T0 + offset), `${severity} ${status} ${offset}`).toBe(
            before(given, T0 + offset),
          );
        }
      }
    }
  });

  it('is false for a severity this console does not know and for a time it cannot read', () => {
    const unknown = incident({ severity: 'catastrophic' as Incident['severity'] });

    expect(isPastAttention(unknown, T0 + 24 * HOUR)).toBe(false);
    expect(isPastAttention(incident({ reportedAt: 'not a date' }), T0 + 24 * HOUR)).toBe(false);
  });
});
