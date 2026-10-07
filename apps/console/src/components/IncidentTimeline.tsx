import type { IncidentEvent } from '@occ/contracts';
import { eventLabel, formatAgo, formatClock } from '../lib/incidents';
import { useNow } from '../lib/useNow';
import { Icon } from '../ui/Icon';
import { actorKindIcon, eventKindIcon } from '../ui/icons';
import styles from './IncidentTimeline.module.css';

/**
 * The incident's history (frame 02): what happened, when (clock time and how long ago) and who did
 * it. The actor's icon tells a person from the system; `data-actor-kind` styles system actors.
 * Only the display name is shown, never the actor's subject (ADR-0011).
 */
export function IncidentTimeline({ timeline }: { timeline: readonly IncidentEvent[] }) {
  const now = useNow();

  return (
    <ol className={styles.timeline}>
      {timeline.map((event) => (
        <li key={event.id} className={styles.entry} data-actor-kind={event.actor.kind}>
          <span className={styles.badge}>
            <Icon glyph={eventKindIcon(event.kind)} size={16} />
          </span>
          <div className={styles.head}>
            <span className={styles.kind}>{eventLabel(event.kind)}</span>
            <time className={styles.time} dateTime={event.at}>
              {formatClock(event.at, now)}
              <span aria-hidden="true"> · </span>
              <span className={styles.hidden}>, </span>
              {formatAgo(event.at, now)}
            </time>
            <span className={styles.actor}>
              <Icon glyph={actorKindIcon(event.actor.kind)} size={14} />
              {event.actor.displayName}
            </span>
          </div>
          {event.note && <p className={styles.note}>{event.note}</p>}
        </li>
      ))}
    </ol>
  );
}
