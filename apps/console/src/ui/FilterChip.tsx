import type { ComponentProps } from 'react';
import styles from './FilterChip.module.css';
import { Icon } from './Icon';
import { type Glyph, X } from './icons';

/**
 * An active filter that can be removed (frame 00). The glyph takes `--sev` when the chip (or a
 * parent) carries `data-severity`, the accent otherwise. The glyph is decorative; the label is the
 * text, and the clear button is named by `clearLabel` ("Clear severity filter").
 *
 * Clearing usually removes the chip, and with it the focused button: the consumer moves focus
 * somewhere stable in `onClear`.
 */
export function FilterChip({
  glyph,
  label,
  clearLabel,
  onClear,
  className,
  ...props
}: Omit<ComponentProps<'span'>, 'children'> & {
  glyph: Glyph;
  label: string;
  clearLabel: string;
  onClear: () => void;
}) {
  return (
    <span {...props} className={className ? `${styles.chip} ${className}` : styles.chip}>
      <Icon glyph={glyph} size={16} className={styles.icon} />
      {label}
      <button type="button" className={styles.clear} aria-label={clearLabel} onClick={onClear}>
        <Icon glyph={X} size={14} />
      </button>
    </span>
  );
}
