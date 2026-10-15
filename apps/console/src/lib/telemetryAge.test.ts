import { formatAgeCoarse, formatReadingAge, formatSince } from './telemetryAge';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

describe('formatReadingAge', () => {
  it.each([
    [0, '0.0 s'],
    [400, '0.4 s'],
    [999, '0.9 s'],
    [1_000, '1 s'],
    [9_900, '9 s'],
    [59_000, '59 s'],
    [60_000, '1 min'],
    [72_000, '1 min 12 s'],
    [59 * MINUTE + 59 * SECOND, '59 min 59 s'],
    [HOUR, '1 h'],
    [HOUR + 5 * MINUTE, '1 h 5 min'],
    [47 * HOUR + 59 * MINUTE, '47 h 59 min'],
    [48 * HOUR, '2 d'],
    [49 * HOUR, '2 d 1 h'],
  ])('writes %i ms as "%s"', (ms, expected) => {
    expect(formatReadingAge(ms)).toBe(expected);
  });

  it('reads a negative age as zero', () => {
    expect(formatReadingAge(-5_000)).toBe('0.0 s');
  });
});

describe('formatAgeCoarse', () => {
  it.each([
    [400, '0.4 s'],
    [12_000, '12 s'],
    [59_000, '59 s'],
    [60_000, '1 min'],
    [72_000, '1 min'],
    [59 * MINUTE + 59 * SECOND, '59 min'],
    [HOUR + 5 * MINUTE, '1 h'],
    [47 * HOUR, '47 h'],
    [49 * HOUR, '2 d'],
  ])('writes %i ms as "%s"', (ms, expected) => {
    expect(formatAgeCoarse(ms)).toBe(expected);
  });
});

// Built from local dates and the same locale options, so the cases hold in any time zone and locale.
describe('formatSince', () => {
  const at = new Date(2026, 9, 15, 15, 41);
  const clock = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  it('shows only the clock time on the same day as the server time', () => {
    expect(formatSince(at.toISOString(), new Date(2026, 9, 15, 16, 30).getTime())).toBe(clock);
  });

  it('adds the date on another day', () => {
    const date = at.toLocaleDateString([], { day: 'numeric', month: 'short' });
    expect(formatSince(at.toISOString(), new Date(2026, 9, 16, 9, 0).getTime())).toBe(
      `${date} ${clock}`,
    );
  });
});
