import type { TelemetryPillState } from '../lib/telemetry/telemetryState';
import { formatAge } from '../lib/incidents/incidents';
import { formatClockTime } from '../lib/time';
import { useNow } from '../lib/useNow';
import { useTelemetryStatus } from '../realtime/telemetryStore';
import { type ConnectionState, useConsole } from '../store';
import { Icon } from '../ui/Icon';
import { connectionIcon, telemetryIcon } from '../ui/icons';
import styles from './ConnectionPills.module.css';

/*
 * The two connection pills (frames 01 and 05): events and telemetry. The header's and the video wall's (V2-21.3) both
 * draw them, so they live here; each reads its own slice of state.
 */

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  live: 'Live',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
};

// The wording of V2-08.1; frames 01 and 05 draw `live` and `paused`.
const TELEMETRY_LABEL: Record<TelemetryPillState, string> = {
  connecting: 'Telemetry connecting…',
  live: 'Telemetry',
  paused: 'Telemetry paused',
  reconnecting: 'Telemetry reconnecting…',
  unavailable: 'Telemetry unavailable',
};

/**
 * The state word is the live region, announced when it changes; the ticking age and the time the
 * link was lost sit outside it, so screen readers are not told every few seconds.
 */
export function ConnectionPill() {
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

/**
 * The second pill (frames 01, 05): whether readings are arriving, which is separate from whether
 * incidents are (the Live pill). Same markup and live-region rule as `ConnectionPill`. It says the
 * state only: since when the readings stopped is the banner's line, over the stage.
 */
export function TelemetryPill() {
  const { pill } = useTelemetryStatus();
  return (
    <div className={styles.pill} data-state={pill}>
      <span role="status" className={styles.pillState}>
        <Icon glyph={telemetryIcon(pill)} size={14} />
        {TELEMETRY_LABEL[pill]}
      </span>
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
