const CLOCK_TIME = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * Wall-clock time as `HH:MM`, 24-hour, in the browser's time zone: the header clock and every
 * "since" / "as of" time, so they all read alike.
 */
export const formatClockTime = (at: number | Date): string => CLOCK_TIME.format(at);
