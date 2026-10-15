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

const CLOCK_TIME_SECONDS = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * The same wall-clock time with seconds, `HH:MM:SS`. Only the telemetry banner uses it: a pause is
 * told to the second (frame 05, V2-08.1), where every other "since" stays at the minute.
 */
export const formatClockTimeSeconds = (at: number | Date): string => CLOCK_TIME_SECONDS.format(at);
