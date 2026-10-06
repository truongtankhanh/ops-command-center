import type { IncidentStatus } from '@occ/contracts';
import { statusLabel } from '../lib/incidents';
import { Icon } from './Icon';
import { statusIcon } from './icons';
import styles from './StatusChip.module.css';

/**
 * An incident's status as icon + text, in neutral tones so it never competes with severity.
 * `inline` sits in running text (feed rows); `pill` stands alone with a background (detail facts).
 * The icon is decorative: the chip's accessible text is the status label alone.
 */
export function StatusChip({
  status,
  form = 'inline',
  className,
}: {
  status: IncidentStatus;
  form?: 'inline' | 'pill';
  className?: string;
}) {
  return (
    <span
      className={className ? `${styles.chip} ${className}` : styles.chip}
      data-status={status}
      data-form={form === 'pill' ? 'pill' : undefined}
    >
      <Icon glyph={statusIcon(status)} size={14} />
      {statusLabel(status)}
    </span>
  );
}
