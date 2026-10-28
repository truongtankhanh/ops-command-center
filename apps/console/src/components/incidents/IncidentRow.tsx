import type { Incident } from '@occ/contracts';
import type { ComponentProps } from 'react';
import {
  formatAge,
  isPastAttention,
  severityLabel,
  typeLabel,
} from '../../lib/incidents/incidents';
import { useConsole } from '../../store';
import { Icon } from '../../ui/Icon';
import { Clock, incidentTypeIcon } from '../../ui/icons';
import { SeverityBadge } from '../../ui/SeverityBadge';
import { StatusChip } from '../../ui/StatusChip';
import styles from './IncidentRow.module.css';

/**
 * One incident in the feed (frames 01 and 02). The tile shows the incident's type in the severity's hue; the
 * severity is drawn as the chip's glyph and word, and said once to assistive tech by one hidden text node. The type
 * and a late age also have text for assistive tech, so none of them rests on colour alone. A click toggles the
 * selection.
 *
 * The chip and its hidden text come right after the tile in the DOM, and the grid moves the chip to the second line,
 * so the row reads as it always did: "{Severity} severity, {Type}: {title}, {age}, {status}, {zone}, {code}". The
 * chip is decorative and the words are one text node, not "Critical" next to " severity": an accessible name trims
 * each element's text, so two elements would read "Criticalseverity". The row is one button with nothing focusable
 * inside, so its reading order may differ from its drawing order.
 *
 * `tag` is the category the feed marks for a user who acts on some categories only (frame 09), so
 * "Mine to handle" can be seen in the other tabs too. It is plain text, read with the row.
 *
 * The feed owns keyboard navigation across rows: it passes the roving `tabIndex`, a `ref` to move
 * focus with the arrow keys, and `onFocus` to remember which row holds the tab stop.
 *
 * `readOnly` (the video wall's list, V2-21.5) draws the same row as text: not a button, so nothing to press or tab
 * to, no selection and no hover. It also counts the incident the wall holds in focus as fresh, for as long as it is.
 */
export function IncidentRow({
  incident,
  zone,
  tag,
  now,
  ref,
  tabIndex,
  onFocus,
  readOnly = false,
}: {
  incident: Incident;
  zone?: string;
  tag?: string;
  now: number;
  readOnly?: boolean;
} & Pick<ComponentProps<'button'>, 'ref' | 'tabIndex' | 'onFocus'>) {
  const selected = useConsole((s) => s.selectedIncidentId === incident.id);
  const fresh = useConsole((s) => s.fresh.has(incident.id));
  const focusedOnWall = useConsole((s) => s.wallFocusId === incident.id);
  const select = useConsole((s) => s.select);
  const late = isPastAttention(incident, now);

  const body = (
    <>
      <span className={styles.tile}>
        <Icon glyph={incidentTypeIcon(incident.type)} size={20} />
      </span>
      <SeverityBadge severity={incident.severity} size="s" decorative className={styles.severity} />
      <span className={styles.hidden}>{severityLabel(incident.severity)} severity, </span>
      <span className={styles.title}>
        <span className={styles.hidden}>{typeLabel(incident.type)}: </span>
        {/* `title` is the hover route to the full text; opening the sheet is the other. */}
        <span className={styles.titleText} title={incident.title}>
          {incident.title}
        </span>
      </span>
      <time className={styles.age} dateTime={incident.reportedAt} data-late={late}>
        {late && <Icon glyph={Clock} size={14} />}
        {formatAge(incident.reportedAt, now)}
        {late && <span className={styles.hidden}>, past attention time</span>}
      </time>
      <StatusChip status={incident.status} className={styles.status} />
      <span className={styles.foot}>
        {zone && (
          <span className={styles.zone} title={zone}>
            {zone}
          </span>
        )}
        {tag && (
          <span className={styles.tag} title={tag}>
            {tag}
          </span>
        )}
        <span className={styles.code}>{incident.code}</span>
      </span>
    </>
  );

  if (readOnly) {
    return (
      <div
        className={styles.row}
        data-severity={incident.severity}
        data-status={incident.status}
        data-fresh={fresh || focusedOnWall}
        data-readonly="true"
      >
        {body}
      </div>
    );
  }

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
      {body}
    </button>
  );
}
