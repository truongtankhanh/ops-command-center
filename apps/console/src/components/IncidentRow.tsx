import type { Incident } from '@occ/contracts';
import type { ComponentProps } from 'react';
import { formatAge, isPastAttention, severityLabel, typeLabel } from '../lib/incidents';
import { useConsole } from '../store';
import { Icon } from '../ui/Icon';
import { Clock, incidentTypeIcon, severityIcon } from '../ui/icons';
import { StatusChip } from '../ui/StatusChip';
import styles from './IncidentRow.module.css';

/**
 * One incident in the feed (frame 01). Severity, type and a late age are drawn as icons and colour
 * for scanning; each also has text for assistive tech, so none of them rests on colour alone.
 * A click toggles the selection.
 *
 * The feed owns keyboard navigation across rows: it passes the roving `tabIndex`, a `ref` to move
 * focus with the arrow keys, and `onFocus` to remember which row holds the tab stop.
 */
export function IncidentRow({
  incident,
  zone,
  now,
  ref,
  tabIndex,
  onFocus,
}: {
  incident: Incident;
  zone?: string;
  now: number;
} & Pick<ComponentProps<'button'>, 'ref' | 'tabIndex' | 'onFocus'>) {
  const selected = useConsole((s) => s.selectedIncidentId === incident.id);
  const fresh = useConsole((s) => s.fresh.has(incident.id));
  const select = useConsole((s) => s.select);
  const late = isPastAttention(incident, now);

  return (
    <button
      ref={ref}
      type="button"
      tabIndex={tabIndex}
      onFocus={onFocus}
      className={styles.row}
      data-severity={incident.severity}
      data-status={incident.status}
      data-fresh={fresh}
      aria-current={selected}
      onClick={() => select(selected ? null : incident.id)}
    >
      <span className={styles.tile}>
        <Icon glyph={severityIcon(incident.severity)} size={18} />
        <span className={styles.hidden}>{severityLabel(incident.severity)} severity, </span>
      </span>
      <span className={styles.title}>
        <Icon glyph={incidentTypeIcon(incident.type)} size={14} className={styles.typeIcon} />
        <span className={styles.hidden}>{typeLabel(incident.type)}: </span>
        {incident.title}
      </span>
      <time className={styles.age} dateTime={incident.reportedAt} data-late={late}>
        {late && <Icon glyph={Clock} size={14} />}
        {formatAge(incident.reportedAt, now)}
        {late && <span className={styles.hidden}>, past attention time</span>}
      </time>
      <span className={styles.meta}>
        <StatusChip status={incident.status} className={styles.status} />
        {zone && (
          <>
            <span className={styles.separator} aria-hidden="true">
              ·
            </span>
            <span className={styles.zone}>{zone}</span>
          </>
        )}
        <span className={styles.code}>{incident.code}</span>
      </span>
    </button>
  );
}
