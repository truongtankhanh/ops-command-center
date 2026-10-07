import { type ComponentProps, createContext, type ReactNode, useContext, useId } from 'react';
import styles from './Field.module.css';

const join = (...names: (string | undefined)[]) => names.filter(Boolean).join(' ');

/** What a `Field` tells its control: whether it is invalid, and the ids of the text describing it. */
interface FieldState {
  invalid: boolean;
  describedBy: string | undefined;
}

const FieldContext = createContext<FieldState>({ invalid: false, describedBy: undefined });

/**
 * A labelled form control. The `<label>` wraps the label text and the control, so the control's
 * accessible name is exactly `label` with no id to wire. Put one control in `children`.
 *
 * - `error` is shown under the field; the control gets `aria-invalid` and is described by it.
 *   The error stays outside the `<label>`, so it never becomes part of the control's name.
 * - `count` (e.g. "33 / 160") sits right of the label for sighted users only: it is `aria-hidden`,
 *   since the control's `maxLength` already holds the limit and a name that changes on every
 *   keystroke would be read out again and again.
 * - `describedBy` adds the ids of other elements describing the control (a hint beside the field).
 *
 * The control picks these up from the field: `TextInput`, `Select` and `Textarea` set
 * `aria-invalid` / `aria-describedby` themselves, unless the caller passes its own.
 */
export function Field({
  label,
  count,
  error,
  describedBy,
  className,
  children,
}: {
  label: ReactNode;
  count?: string;
  error?: string;
  describedBy?: string;
  className?: string;
  children: ReactNode;
}) {
  const errorId = useId();
  const state: FieldState = {
    invalid: Boolean(error),
    describedBy: join(error ? errorId : undefined, describedBy) || undefined,
  };

  return (
    <div className={join(styles.field, className)}>
      <label className={styles.labelWrap}>
        <span className={styles.labelRow}>
          <span className={styles.label}>{label}</span>
          {count !== undefined && (
            <span className={styles.count} aria-hidden="true">
              {count}
            </span>
          )}
        </span>
        <FieldContext.Provider value={state}>{children}</FieldContext.Provider>
      </label>
      {error && (
        <p id={errorId} className={styles.error} data-field-error>
          {error}
        </p>
      )}
    </div>
  );
}

/** The field's `aria-*` props for its control; the caller's own props are spread after them. */
function useFieldAria() {
  const { invalid, describedBy } = useContext(FieldContext);
  return { 'aria-invalid': invalid || undefined, 'aria-describedby': describedBy };
}

/** A single-line text control; fills its field. */
export function TextInput({ className, ...props }: ComponentProps<'input'>) {
  const aria = useFieldAria();
  return <input {...aria} {...props} className={join(styles.control, className)} />;
}

/** A native `<select>`, kept native for keyboard, screen-reader and mobile pickers. */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  const aria = useFieldAria();
  return <select {...aria} {...props} className={join(styles.control, className)} />;
}

/** A multi-line text control. Its height comes from the caller's `className` (`min-height`). */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  const aria = useFieldAria();
  return (
    <textarea {...aria} {...props} className={join(styles.control, styles.multiline, className)} />
  );
}
