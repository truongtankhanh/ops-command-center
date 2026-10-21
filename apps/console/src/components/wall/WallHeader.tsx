import { Eye } from '../../ui/icons';
import { Icon } from '../../ui/Icon';
import { Brand } from '../Brand';
import { ConnectionPill, TelemetryPill } from '../ConnectionPills';
import { HeaderClock } from '../HeaderClock';
import { KpiTiles } from '../KpiTiles';
import styles from './WallHeader.module.css';

/**
 * The video wall's header (V2-21.3, frame 18): the product, the four severity counts as text, the two connection
 * states, "Wall N · view only" and the clock. Everything in it is the console's own part (`Brand`, `KpiTiles` read-only,
 * the pills and the clock the header shares), so the counts follow the feed's rule and the states are the same words.
 * Nothing in it can be pressed.
 */
export function WallHeader({ screen }: { screen: number }) {
  return (
    <header className={styles.header}>
      <Brand />
      <KpiTiles readOnly className={styles.kpis} />
      <div className={styles.conns}>
        <ConnectionPill />
        <TelemetryPill />
      </div>
      <span className={styles.tag}>
        <Icon glyph={Eye} size={14} />
        Wall {screen} · view only
      </span>
      <HeaderClock dateAlways />
    </header>
  );
}
