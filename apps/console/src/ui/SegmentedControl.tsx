import type { IncidentSeverity } from '@occ/contracts';
import { type Ref, useId } from 'react';
import { Icon } from './Icon';
import type { Glyph } from './icons';
import styles from './SegmentedControl.module.css';

/**
 * One choice out of a few, shown side by side: a radio group in a `<fieldset>`, so arrow keys move
 * the choice and each option's accessible name is its `label`. The radios are visually hidden;
 * the focus ring is drawn on the visible option instead.
 *
 * An option with `severity` is marked in that severity's colour when checked; any other option in
 * the accent colour. An option's `icon` is decorative (the label names it) and drawn before the
 * label in a `row`, above it in a `grid` (three columns of taller tiles, frame 03's type grid).
 *
 * `value: null` checks no option, for a choice the user has not made yet. `error` is shown under
 * the options and describes the group. `ref` is the `<fieldset>`, for a caller that moves focus to
 * the group.
 */
export function SegmentedControl<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  layout = 'row',
  error,
  className,
  ref,
}: {
  legend: string;
  name: string;
  options: readonly { value: T; label: string; severity?: IncidentSeverity; icon?: Glyph }[];
  value: T | null;
  onChange: (value: T) => void;
  layout?: 'row' | 'grid';
  error?: string;
  className?: string;
  ref?: Ref<HTMLFieldSetElement>;
}) {
  const errorId = useId();
  return (
    <fieldset
      ref={ref}
      className={className ? `${styles.group} ${className}` : styles.group}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.options} data-layout={layout === 'grid' ? 'grid' : undefined}>
        {options.map((option) => (
          <label key={option.value} className={styles.option} data-severity={option.severity}>
            <input
              type="radio"
              className={styles.input}
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span className={styles.face}>
              {option.icon && (
                <Icon
                  glyph={option.icon}
                  size={layout === 'grid' ? 22 : 16}
                  className={styles.icon}
                />
              )}
              {option.label}
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p id={errorId} className={styles.error} data-field-error>
          {error}
        </p>
      )}
    </fieldset>
  );
}
