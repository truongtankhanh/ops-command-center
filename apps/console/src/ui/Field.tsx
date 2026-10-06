import type { ComponentProps, ReactNode } from 'react';
import styles from './Field.module.css';

const join = (...names: (string | undefined)[]) => names.filter(Boolean).join(' ');

/**
 * A labelled form control. The `<label>` wraps the label text and the control, so the control's
 * accessible name is exactly `label` with no id to wire. Put one control in `children`.
 *
 * There is no hint or error slot yet: errors are shown once for the whole form (`role="alert"`).
 * Field-level messages, linked with `aria-describedby`, arrive with the report form polish (UI-12).
 */
export function Field({
  label,
  className,
  children,
}: {
  label: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={join(styles.field, className)}>
      <span className={styles.label}>{label}</span>
      {children}
    </label>
  );
}

/** A single-line text control; fills its field. */
export function TextInput({ className, ...props }: ComponentProps<'input'>) {
  return <input {...props} className={join(styles.control, className)} />;
}

/** A native `<select>`, kept native for keyboard, screen-reader and mobile pickers. */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select {...props} className={join(styles.control, className)} />;
}

/** A multi-line text control. Its height comes from the caller's `className` (`min-height`). */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea {...props} className={join(styles.control, styles.multiline, className)} />;
}
