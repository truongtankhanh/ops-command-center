import { formatClockTime } from '../lib/time';
import { useConsole } from '../store';
import { Banner } from '../ui/Banner';
import { connectionIcon } from '../ui/icons';
import styles from './OfflineBanner.module.css';

/**
 * Frame 05: while the live connection is down, what the operator sees may be stale. Mounted only
 * from the loss until the connection is back (`offlineSince`), so it is announced once and clears
 * by itself. No "Retry now" (Q2): the socket already reconnects on its own, and the second line
 * says so. The header pill and the feed show the same time.
 */
export function OfflineBanner() {
  const offlineSince = useConsole((s) => s.offlineSince);
  if (offlineSince === null) return null;
  return (
    <Banner
      role="status"
      icon={connectionIcon('offline')}
      detail="Reconnecting automatically. This clears by itself once the connection is back."
      className={styles.banner}
    >
      Live updates paused since {formatClockTime(offlineSince)} — data may be stale
    </Banner>
  );
}
