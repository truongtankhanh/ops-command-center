import type { IncidentSeverity } from '@occ/contracts';
import { severityLabel } from '../lib/incidents/incidents';
import { Icon } from './Icon';
import { severityIcon } from './icons';
import styles from './SeverityBadge.module.css';

/**
 * An incident's severity as icon + text, never colour alone. The label stays in the primary text
 * colour on every severity; the hue is carried by the icon, the tint and the border, so even
 * critical keeps AA contrast on its tint.
 *
 * `size` `s` is the compact chip of a feed row (V3-07.2, 20 px): the same tint, border and label colour, a 14 px
 * glyph and `--type-s`. `m` (the default) is the sheet's badge and draws exactly as before.
 *
 * `decorative` hides the badge from assistive tech, for a caller that already says the severity in its own text (the
 * feed row's name reads "Critical severity, …" from one hidden text node, and a screen reader would otherwise hear
 * the word twice).
 */
export function SeverityBadge({
  severity,
  size = 'm',
  decorative = false,
  className,
}: {
  severity: IncidentSeverity;
  size?: 'm' | 's';
  decorative?: boolean;
  className?: string;
}) {
  return (
    <span
      className={className ? `${styles.badge} ${className}` : styles.badge}
      data-severity={severity}
      data-size={size === 's' ? 's' : undefined}
      aria-hidden={decorative ? true : undefined}
    >
      <Icon glyph={severityIcon(severity)} size={size === 's' ? 14 : 16} className={styles.icon} />
      {severityLabel(severity)}
    </span>
  );
}
