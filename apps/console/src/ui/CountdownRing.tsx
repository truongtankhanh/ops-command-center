import type { CountdownState } from '../lib/incidents/attentionCountdown';
import styles from './CountdownRing.module.css';

// Frame 17's ring: a 22-unit box, a circle of radius 9 and a stroke of 3, drawn at 18 px (the CSS sets the size).
const CENTRE = 11;
const RADIUS = 9;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** SVG attributes need no more than a hundredth of a viewBox unit. */
const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * The share of an incident's attention time that is left, as a ring (V3-22.2, frame 17): a track and an arc that shortens
 * clockwise from 12 o'clock as the time runs out. Past the deadline (`overdue`) the ring is full, whatever the fraction.
 *
 * Accessibility contract: decorative and hidden from assistive tech, with no text inside. The ring never says the state alone:
 * the countdown's text (`m:ss`, `+m:ss over`) and its glyph sit beside it, and the row's name carries the sentence
 * (`countdownSpeech`). The look follows `state` (neutral, `--warning`, `--danger`), and there is no animation or transition: the
 * ring is set at each tick, so `prefers-reduced-motion` has nothing to turn off.
 */
export function CountdownRing({
  fraction,
  state,
  className,
}: {
  /** Time left over the whole time allowed, from 0 to 1 (`AttentionCountdown.fraction`). */
  fraction: number;
  state: CountdownState;
  className?: string;
}) {
  const share = state === 'overdue' ? 1 : Math.min(1, Math.max(0, fraction));
  const arc = round(CIRCUMFERENCE * share);
  return (
    <svg
      className={className ? `${styles.ring} ${className}` : styles.ring}
      viewBox="0 0 22 22"
      aria-hidden="true"
      focusable="false"
      data-state={state}
    >
      <circle className={styles.track} cx={CENTRE} cy={CENTRE} r={RADIUS} />
      {/* No arc at all for an empty one: a round cap would draw a dot. */}
      {arc > 0 && (
        <circle
          className={styles.arc}
          cx={CENTRE}
          cy={CENTRE}
          r={RADIUS}
          strokeDasharray={`${arc} ${round(CIRCUMFERENCE - arc)}`}
          transform={`rotate(-90 ${CENTRE} ${CENTRE})`}
        />
      )}
    </svg>
  );
}
