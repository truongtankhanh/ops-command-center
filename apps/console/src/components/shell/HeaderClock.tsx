import { formatClockTime } from '../../lib/shared/time';
import { useNow } from '../../lib/shared/useNow';
import styles from './HeaderClock.module.css';

const DATE = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const ZONE = new Intl.DateTimeFormat('en-GB', { timeZoneName: 'shortOffset' });

/**
 * Local time and date with the browser's UTC offset; ticks on its own (D4). The header drops the date in a narrow
 * window; the video wall (V2-21.3) passes `dateAlways` and keeps it.
 */
export function HeaderClock({ dateAlways = false }: { dateAlways?: boolean }) {
  const now = new Date(useNow(1000));
  const zone = ZONE.formatToParts(now).find((part) => part.type === 'timeZoneName')?.value;
  return (
    <time
      className={styles.clock}
      dateTime={now.toISOString()}
      data-date={dateAlways ? 'always' : undefined}
    >
      <span className={styles.clockTime}>{formatClockTime(now)}</span>{' '}
      <span className={styles.clockDate}>
        {DATE.format(now)}
        {zone && ` · ${zone}`}
      </span>
    </time>
  );
}
