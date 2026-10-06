import type { ComponentProps } from 'react';
import styles from './Button.module.css';
import { Icon } from './Icon';
import type { Glyph } from './icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

/**
 * The console's button (frame 00). `type` defaults to `"button"`; pass `type="submit"` in a form.
 *
 * - `data-variant` is set for every variant except the default `secondary`, and `data-size` only
 *   for `sm`: tests and later visual tests select on these attributes, never on class names
 *   (ADR-0016 §4).
 * - `loading` disables the button and sets `aria-busy`; the caller keeps a label that says what is
 *   happening ("Reporting…"). There is no spinner: only arrival, selection and escalation animate.
 * - `icon` is drawn before the label and hidden from assistive tech, so the accessible name stays
 *   the visible text.
 * - The button sets no outer layout (`flex`, `width`, `margin`); pass a `className` for that.
 * - `secondary` draws its boundary in `--border-strong`, which reaches 3:1 only on `--surface-0` and
 *   `--surface-1`. On a lighter surface use `primary` or `ghost`.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  type = 'button',
  disabled,
  className,
  children,
  ...props
}: ComponentProps<'button'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: Glyph;
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      type={type}
      className={className ? `${styles.button} ${className}` : styles.button}
      data-variant={variant === 'secondary' ? undefined : variant}
      data-size={size === 'sm' ? 'sm' : undefined}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {icon && <Icon glyph={icon} size={size === 'sm' ? 16 : 18} />}
      {children}
    </button>
  );
}
