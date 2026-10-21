import { useSession } from '../../auth/store';
import { Icon } from '../../ui/Icon';
import { Lock } from '../../ui/icons';
import styles from './WallSessionNotice.module.css';

/**
 * A line in the wall's header while its session is being renewed after a failure (V2-21.10): the wall keeps its last data
 * on screen and signs itself in again (`useWallReauth`), and this is what tells a person walking past a stuck wall from a
 * quiet one. It says "Session" because the event pill beside it already says "Reconnecting…" for its own link. A status,
 * with nothing to press; it goes when a renewal succeeds.
 */
export function WallSessionNotice() {
  const expired = useSession((s) => s.expired);
  if (!expired) return null;
  return (
    <div className={styles.notice} role="status">
      <Icon glyph={Lock} size={14} />
      Session reconnecting…
    </div>
  );
}
