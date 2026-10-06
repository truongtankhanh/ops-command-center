import type { IncidentSeverity } from '@occ/contracts';
import { severityLabel } from '../lib/incidents';
import { Icon } from './Icon';
import { severityIcon } from './icons';
import styles from './SeverityBadge.module.css';

/**
 * An incident's severity as icon + text, never colour alone. The label stays in the primary text
 * colour on every severity; the hue is carried by the icon, the tint and the border, so even
 * critical keeps AA contrast on its tint.
 */
export function SeverityBadge({
  severity,
  className,
}: {
  severity: IncidentSeverity;
  className?: string;
}) {
  return (
    <span
      className={className ? `${styles.badge} ${className}` : styles.badge}
      data-severity={severity}
    >
      <Icon glyph={severityIcon(severity)} size={16} className={styles.icon} />
      {severityLabel(severity)}
    </span>
  );
}
