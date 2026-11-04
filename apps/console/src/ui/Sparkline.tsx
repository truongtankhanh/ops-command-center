import {
  SPARK_HEIGHT,
  SPARK_WIDTH,
  sparklineGeometry,
  type SparklineInput,
} from '../lib/telemetry/sparkline';
import styles from './Sparkline.module.css';

/** What `over` can tint the line with; the same four words as an incident's severity. */
export type SparklineSeverity = 'critical' | 'high' | 'medium' | 'low';

/** The series' hue: live data, or the second series on the same area (V3-04.6, brief § Inspector). */
export type SparklineTone = 'signal' | 'secondary';

/** SVG attributes need no more than a hundredth of a viewBox unit. */
const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * A reading's last 15 minutes as a 96 × 28 line, with the rule's limit dashed and a dot at the
 * newest reading (frames 03, 05, 10, 15).
 *
 * Accessibility contract: decorative and hidden from assistive tech, with no text inside. The
 * value drawn beside it is the accessible reading, and colour is never its only signal: a stale
 * or over-limit series also changes the value's own text (the caller's part, frames 05 and 10).
 *
 * `over` is the severity of the rule the latest reading has passed: the caller decides that, it
 * knows the comparator. `stale` wins over `over` in CSS: a fault keeps its stale values grey.
 * The series is drawn as given and never extended to `to` (see `lib/telemetry/sparkline.ts`).
 *
 * `tone` is the hue of a series within its limit: `signal` (default, `--signal`, live data) or
 * `secondary` (`--accent-2`, a second series on the same area). `data-tone` is set only for
 * `secondary`, like `data-severity` and `data-stale`. `over` and `stale` win over either tone in
 * CSS, and the tone alone never says anything the value beside the drawing does not.
 *
 * `marker` is a time drawn as a vertical dashed line across the height, under the series: Around
 * the alarm's raised time (V3-23.2, frame 18b). Neutral (`--text-secondary`), so it never reads as
 * a severity, and untouched by tone, severity and stale. Still decorative: the tab says the range
 * in words.
 */
export function Sparkline({
  stale = false,
  over,
  tone = 'signal',
  className,
  ...series
}: SparklineInput & {
  stale?: boolean;
  over?: SparklineSeverity;
  tone?: SparklineTone;
  className?: string;
}) {
  const { points, dot, limitY, markerX } = sparklineGeometry(series);
  return (
    <svg
      className={className ? `${styles.spark} ${className}` : styles.spark}
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
      aria-hidden="true"
      focusable="false"
      data-stale={stale ? true : undefined}
      data-severity={over}
      data-tone={tone === 'secondary' ? 'secondary' : undefined}
    >
      {markerX !== undefined && (
        <line
          className={styles.marker}
          x1={round(markerX)}
          x2={round(markerX)}
          y1={0}
          y2={SPARK_HEIGHT}
        />
      )}
      {limitY !== null && (
        <line
          className={styles.limit}
          x1={0}
          x2={SPARK_WIDTH}
          y1={round(limitY)}
          y2={round(limitY)}
        />
      )}
      {points.length >= 2 && (
        <polyline
          className={styles.line}
          points={points.map(([x, y]) => `${round(x)},${round(y)}`).join(' ')}
        />
      )}
      {dot && <circle className={styles.dot} cx={round(dot.x)} cy={round(dot.y)} r={2.5} />}
    </svg>
  );
}
