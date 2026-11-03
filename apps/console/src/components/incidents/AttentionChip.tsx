import type { Incident } from '@occ/contracts';
import {
  attentionCountdown,
  countdownSpeech,
  formatCountdown,
} from '../../lib/incidents/attentionCountdown';
import { useCountdownNow } from '../../lib/incidents/useCountdownNow';
import { CountdownRing } from '../../ui/CountdownRing';
import { Icon } from '../../ui/Icon';
import { Clock } from '../../ui/icons';
import styles from './AttentionChip.module.css';

/** An overdue time already reads "+m:ss over"; only a time still left needs its words (frame 17c: "to attention"). */
const attentionLabel = (remainingMs: number): string =>
  remainingMs > 0 ? `${formatCountdown(remainingMs)} to attention` : formatCountdown(remainingMs);

/**
 * The time an open incident has left before its attention threshold, in the inspector's header (V3-22.4, frame 17c): a
 * ring, a `Clock` and `m:ss to attention`, then `+m:ss over`. It sits in the chip row, right after the status, and draws
 * nothing for an incident that is not open, so acknowledging or resolving removes it while the sheet stays open. The asset
 * inspector never mounts it.
 *
 * It owns its clock (`useCountdownNow`, 1 s near the deadline), like `IncidentAge` owns `useNow`, so the tick re-renders this
 * chip and not the header around it.
 *
 * Accessibility: the figure (ring, glyph and digits) is `aria-hidden` and the chip is never a live region, so the seconds are
 * not announced. A screen reader reads the one hidden sentence of `countdownSpeech`, in whole minutes, which changes once a
 * minute. The state never rests on colour: it has the arc, the words ("to attention", "over") and, for `soon` and `overdue`,
 * the `Clock`. Unlike the feed row's, the clock is drawn for both, because the header's age carries a clock all the time and
 * so says nothing about lateness. It complements the late flag `IncidentLifecycle` draws on the open step; both read
 * `attentionCountdown`. Nothing animates.
 *
 * The figure is an attention threshold, display only and not an SLA: nothing enforces it on the server (V1 Approved
 * decision 3).
 */
export function AttentionChip({ incident }: { incident: Incident }) {
  const now = useCountdownNow([incident]);
  const left = attentionCountdown(incident, now);
  if (!left) return null;

  return (
    <span className={styles.attention} data-attention={left.state}>
      <span className={styles.figure} aria-hidden="true">
        <CountdownRing fraction={left.fraction} state={left.state} />
        {left.state !== 'normal' && <Icon glyph={Clock} size={14} />}
        <span>{attentionLabel(left.remainingMs)}</span>
      </span>
      <span className={styles.hidden}>{countdownSpeech(left)}</span>
    </span>
  );
}
