import { useIncidents, useZones } from '../../api/queries';
import { compareIncidents, isActive } from '../../lib/incidents/incidents';
import { useNow } from '../../lib/shared/useNow';
import text from '../../styles/text.module.css';
import { Icon } from '../../ui/Icon';
import { statusIcon } from '../../ui/icons';
import { Skeleton } from '../../ui/Skeleton';
import { IncidentRow } from '../IncidentRow';
import styles from './WallIncidents.module.css';

/** The most rows drawn: the list shows what fits and cuts the rest, so there is no need to build a long night's worth. */
export const WALL_LIST_LIMIT = 12;
/** Placeholder rows while the incidents load. */
const LOADING_ROWS = 5;

/**
 * The video wall's active-incident list (V2-21.5, frame 18): the feed's rows, in the feed's order (unresolved, then
 * the most severe, then the newest) and by the feed's rule for "active", drawn read-only by `IncidentRow`: no button, no
 * selection, no filter and no scroll. It shows as many rows as fit; the heading over it (`WallApp`) counts all of them.
 * The incident the wall holds in focus keeps the row's "fresh" look while it does (V2-21.8 sets it).
 *
 * The list is a `ul`; it is not announced when it changes, because the wall's own focus banner is what announces a new
 * critical incident (V2-21.8), and a list that reads itself out on every update would talk all day.
 */
export function WallIncidents() {
  const { data: incidents, isPending, isError } = useIncidents();
  const { data: zones = [] } = useZones();
  const now = useNow(5000);

  if (isPending) {
    return (
      <div className={styles.list} aria-busy="true">
        <p role="status" className={styles.hidden}>
          Loading incidents…
        </p>
        {Array.from({ length: LOADING_ROWS }, (_, row) => (
          <Skeleton key={row} className={styles.skeleton} />
        ))}
      </div>
    );
  }
  // A line, not a button: nobody at a wall can retry, and the query retries by itself.
  if (isError || !incidents) {
    return <p className={`${text.muted} ${styles.message}`}>Incidents could not be loaded.</p>;
  }

  const active = incidents.filter(isActive).sort(compareIncidents);
  if (active.length === 0) {
    return (
      <p className={styles.empty}>
        <Icon glyph={statusIcon('resolved')} size={20} className={styles.emptyIcon} />
        No active incidents
      </p>
    );
  }

  const zoneName = new Map(zones.map((zone) => [zone.id, zone.name]));
  return (
    <ul className={styles.list} role="list">
      {active.slice(0, WALL_LIST_LIMIT).map((incident) => (
        <li key={incident.id} className={styles.item}>
          <IncidentRow
            incident={incident}
            zone={zoneName.get(incident.zoneId)}
            now={now}
            readOnly
          />
        </li>
      ))}
    </ul>
  );
}
