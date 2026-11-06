import type { Incident } from '@occ/contracts';
import type { ComponentProps } from 'react';
import {
  attentionCountdown,
  countdownSpeech,
  formatCountdown,
} from '../../lib/incidents/attentionCountdown';
import {
  formatAge,
  isPastAttention,
  severityLabel,
  typeLabel,
} from '../../lib/incidents/incidents';
import { useConsole } from '../../store';
import { CountdownRing } from '../../ui/CountdownRing';
import { Icon } from '../../ui/Icon';
import { Clock, incidentTypeIcon } from '../../ui/icons';
import { SeverityBadge } from '../../ui/SeverityBadge';
import { StatusChip } from '../../ui/StatusChip';
import styles from './IncidentRow.module.css';

/** An overdue time already reads "+m:ss over"; only a time still left needs its word (frame 17: "4:02 left"). */
const countdownLabel = (remainingMs: number): string =>
  remainingMs > 0 ? `${formatCountdown(remainingMs)} left` : formatCountdown(remainingMs);

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
 *
 * `countdown` (V3-22.3, frame 17) adds the time an open incident has left before its attention threshold: a ring and
 * `m:ss left`, then `+m:ss over`, on the chip's line under the age. It is off by default and only the feed and the wall
 * turn it on: the other lists that draw this row (the sheets' Related tabs) keep a 15 s clock, which would show a figure
 * standing still and then jumping. The block is `aria-hidden` and never a live region; the row's name carries the
 * coarse sentence of `countdownSpeech` instead, which changes once a minute, so a focused row is not read out again
 * every second. The age keeps its late look (V3-07.2); the block's own `Clock` is only for `soon`, because an overdue row
 * already has the age's clock, the word "over" and a full danger ring. Colour never says it alone. The figure is an
 * attention threshold, display only and not an SLA: nothing enforces it on the server (V1 Approved decision 3).
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
  countdown = false,
}: {
  incident: Incident;
  zone?: string;
  tag?: string;
  now: number;
  readOnly?: boolean;
  countdown?: boolean;
} & Pick<ComponentProps<'button'>, 'ref' | 'tabIndex' | 'onFocus'>) {
  const selected = useConsole((s) => s.selectedIncidentId === incident.id);
  const fresh = useConsole((s) => s.fresh.has(incident.id));
  const focusedOnWall = useConsole((s) => s.wallFocusId === incident.id);
  const select = useConsole((s) => s.select);
  const late = isPastAttention(incident, now);
  // `null` for an acknowledged or resolved incident, so acknowledging removes the block with the next render.
  const left = countdown ? attentionCountdown(incident, now) : null;
  // One hidden phrase after the age, one text node. With a countdown it is the coarse sentence, which already says
  // "past attention time" once overdue; without one, the V3-07.2 words.
  const spoken = left ? countdownSpeech(left) : late ? 'past attention time' : null;

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
        {spoken && <span className={styles.hidden}>{`, ${spoken}`}</span>}
      </time>
      {/*
       * Line 2 after the chip: the status, or the countdown in its place. A countdown is drawn only for an incident
       * nobody has acknowledged, whose status is always "Open", so the ring says it and the word would only crowd the
       * line (an overdue "+22d 15h over" and "Open" do not fit beside the chip in a 360 px column). The word stays for
       * assistive tech, hidden, so the row's name is unchanged.
       */}
      <span className={styles.state}>
        <StatusChip status={incident.status} className={left ? styles.hidden : styles.status} />
        {left && (
          <span className={styles.countdown} aria-hidden="true" data-attention={left.state}>
            <CountdownRing fraction={left.fraction} state={left.state} />
            {left.state === 'soon' && <Icon glyph={Clock} size={14} />}
            <span>{countdownLabel(left.remainingMs)}</span>
          </span>
        )}
      </span>
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
