import { useSitePlan } from '../../api/queries';
import { Eye } from '../../ui/icons';
import { Icon } from '../../ui/Icon';
import { Brand } from '../shell/Brand';
import { ConnectionPill, TelemetryPill } from '../shell/ConnectionPills';
import { HeaderClock } from '../shell/HeaderClock';
import { KpiTiles } from '../incidents/KpiTiles';
import styles from './WallHeader.module.css';
import { WallSessionNotice } from './WallSessionNotice';

/**
 * The video wall's header (V2-21.3, frame 18): the product, the four severity counts as text, the two connection
 * states, "Wall N · view only" and the clock. Everything in it is the console's own part (`Brand`, `KpiTiles` read-only,
 * the pills and the clock the header shares), so the counts follow the feed's rule and the states are the same words.
 * Nothing in it can be pressed. While the session is being renewed after a failure a line says so (V2-21.10).
 * The wall is signed in, so it shows the site's name from the same plan the console header reads (V3-05.1).
 */
export function WallHeader({ screen }: { screen: number }) {
  const { data: plan } = useSitePlan();
  return (
    <header className={styles.header}>
      <Brand site={plan?.name} />
      <KpiTiles readOnly className={styles.kpis} />
      <div className={styles.conns}>
        <WallSessionNotice />
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
