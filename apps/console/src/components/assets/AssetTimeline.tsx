import type { Asset, Incident } from '@occ/contracts';
import { useMemo } from 'react';
import { useIncidents } from '../../api/queries';
import { incidentHistoryOf } from '../../lib/assets/assetInspector';
import { formatAgo, formatClock, severityLabel, typeLabel } from '../../lib/incidents/incidents';
import { useNow } from '../../lib/shared/useNow';
import { useConsole } from '../../store';
import text from '../../styles/text.module.css';
import { EmptyState } from '../../ui/EmptyState';
import { Hint } from '../../ui/Hint';
import { Icon } from '../../ui/Icon';
import { incidentTypeIcon } from '../../ui/icons';
import { SeverityBadge } from '../../ui/SeverityBadge';
import { Skeleton } from '../../ui/Skeleton';
import { StatusChip } from '../../ui/StatusChip';
import styles from './AssetTimeline.module.css';

/**
 * The asset sheet's Timeline tab (V3-09.8): every incident this asset raised, in any status,
 * newest first, each with the clock time it was reported and how long ago, so a history that
 * spans days reads as one. `incidentHistoryOf` is a client-side join over the incident list the
 * console already holds (no request of its own, no route for an asset's history), and it is
 * chronological on purpose: the feed's order (unresolved first, by severity) answers "what needs
 * me", this tab answers "what happened here".
 *
 * How far back it goes is the feed's depth, not the asset's: the console asks for the latest 200
 * incidents on site (`useIncidents`) and live events patch that list, so an asset that raised
 * something long ago may show nothing. The hint under the list says so, in the empty case too.
 *
 * Choosing an entry opens that incident: the sheet is replaced by the incident's (`App` keys it by
 * id, so it opens on Details), whose "Open asset" is the way back. Reading only: no role is
 * checked, opening an incident is not an action on the site.
 *
 * Two things it will not say by guess: while the list is on its way it is a skeleton, and a list
 * that could not be loaded says so. "No incidents" is drawn only for a list that arrived and
 * held none for this asset.
 *
 * The tab names the panel, so the list has no heading of its own.
 */
export function AssetTimeline({ asset }: { asset: Pick<Asset, 'id'> }) {
  const { data: incidents, isError } = useIncidents();
  // Keyed on the id, not the object: the asset's detail refetches without this list changing.
  const { id } = asset;
  const history = useMemo(
    () => (incidents === undefined ? [] : incidentHistoryOf({ id }, incidents)),
    [id, incidents],
  );

  if (incidents === undefined) {
    return isError ? (
      <div className={styles.section}>
        <p className={text.muted}>Incidents could not be loaded.</p>
      </div>
    ) : (
      <TimelineSkeleton />
    );
  }

  return (
    <div className={styles.section}>
      {history.length === 0 ? (
        <EmptyState>No incidents have been raised by this asset.</EmptyState>
      ) : (
        <Entries history={history} />
      )}
      <Hint>Shows the incidents the console holds: up to the latest 200 on site.</Hint>
    </div>
  );
}

/** Its own component so the clock ticks only for a tab that has entries to age. */
function Entries({ history }: { history: readonly Incident[] }) {
  const now = useNow();

  return (
    <ul className={styles.list}>
      {history.map((incident) => (
        <li key={incident.id}>
          <Entry incident={incident} now={now} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One incident of the history: the type in the severity's hue, the severity and the status as
 * words and glyphs, when it was reported and the code. The whole entry is the button. Its name
 * reads "{Severity} severity, {Type}, {time}, {ago}, {Status}, {code}": the severity word is one
 * hidden text node and the visible badge is decorative, since an accessible name trims each
 * element's text and two elements would read "Criticalseverity".
 */
function Entry({ incident, now }: { incident: Incident; now: number }) {
  const select = useConsole((s) => s.select);

  return (
    <button
      type="button"
      className={styles.entry}
      data-severity={incident.severity}
      data-status={incident.status}
      onClick={() => select(incident.id)}
    >
      <span className={styles.tile}>
        <Icon glyph={incidentTypeIcon(incident.type)} size={20} />
      </span>
      <span className={styles.type}>
        <span className={styles.hidden}>{severityLabel(incident.severity)} severity, </span>
        {typeLabel(incident.type)}
      </span>
      <SeverityBadge severity={incident.severity} size="s" decorative className={styles.severity} />
      <time className={styles.time} dateTime={incident.reportedAt}>
        {formatClock(incident.reportedAt, now)}
        <span aria-hidden="true"> · </span>
        <span className={styles.hidden}>, </span>
        {formatAgo(incident.reportedAt, now)}
      </time>
      <StatusChip status={incident.status} className={styles.status} />
      <span className={styles.code}>{incident.code}</span>
    </button>
  );
}

/** Three entries' worth, so nothing jumps when the list arrives. */
function TimelineSkeleton() {
  return (
    <div className={styles.section} aria-busy="true">
      <p role="status" className={styles.hidden}>
        Loading incidents…
      </p>
      <Skeleton className={styles.skeletonEntry} />
      <Skeleton className={styles.skeletonEntry} />
      <Skeleton className={styles.skeletonEntry} />
    </div>
  );
}
