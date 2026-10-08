import { usePermission } from '../auth/usePermission';
import { formatAge } from '../lib/incidents';
import { formatClockTime } from '../lib/time';
import { useNow } from '../lib/useNow';
import { useShortcut } from '../lib/useShortcut';
import { type ConnectionState, useConsole } from '../store';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { connectionIcon, Plus } from '../ui/icons';
import { Brand } from './Brand';
import styles from './Header.module.css';
import { KpiTiles } from './KpiTiles';
import { UserMenu } from './UserMenu';

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  live: 'Live',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
};

const DATE = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const ZONE = new Intl.DateTimeFormat('en-GB', { timeZoneName: 'shortOffset' });

/**
 * The app shell's header (frames 01, 04, 06). Each part reads its own slice of state, so the
 * clock's tick or a new count re-renders that part only, never the whole header.
 */
export function Header() {
  const canReport = usePermission('incident:report');
  const reporting = useConsole((s) => s.reporting);
  const startReport = useConsole((s) => s.startReport);

  // A note being written in the open incident survives the report form (`noteDrafts`), so `N` and
  // the button can always open it.
  useShortcut('n', startReport, canReport && !reporting);

  return (
    <header className={styles.header}>
      <Brand />
      <KpiTiles className={styles.kpis} />
      <ConnectionPill />
      <Clock />
      {canReport && (
        <Button
          variant="primary"
          icon={Plus}
          shortcut="N"
          aria-expanded={reporting}
          aria-controls="report-incident-panel"
          onClick={startReport}
        >
          Report incident
        </Button>
      )}
      <UserMenu />
    </header>
  );
}

/**
 * The state word is the live region, announced when it changes; the ticking age and the time the
 * link was lost sit outside it, so screen readers are not told every few seconds.
 */
function ConnectionPill() {
  const connection = useConsole((s) => s.connection);
  const offlineSince = useConsole((s) => s.offlineSince);
  return (
    <div className={styles.pill} data-state={connection}>
      <span role="status" className={styles.pillState}>
        <Icon glyph={connectionIcon(connection)} size={14} />
        {CONNECTION_LABEL[connection]}
      </span>
      {connection === 'live' && <LastSignOfLife />}
      {/* Frame 05; never set while live. The stage's banner says what it means for the data. */}
      {offlineSince !== null && (
        <small className={styles.age}>since {formatClockTime(offlineSince)}</small>
      )}
    </div>
  );
}

/** Age of the last event or heartbeat; it grows only when the link has gone quiet (D3). */
function LastSignOfLife() {
  const lastEventAt = useConsole((s) => s.lastEventAt);
  const now = useNow(5000);
  if (lastEventAt === null) return null;
  const age = formatAge(new Date(lastEventAt).toISOString(), now);
  return <small className={styles.age}>{age === 'now' ? 'now' : `${age} ago`}</small>;
}

/** Local time and date with the browser's UTC offset; ticks on its own (D4). */
function Clock() {
  const now = new Date(useNow(1000));
  const zone = ZONE.formatToParts(now).find((part) => part.type === 'timeZoneName')?.value;
  return (
    <time className={styles.clock} dateTime={now.toISOString()}>
      <span className={styles.clockTime}>{formatClockTime(now)}</span>{' '}
      <span className={styles.clockDate}>
        {DATE.format(now)}
        {zone && ` · ${zone}`}
      </span>
    </time>
  );
}
