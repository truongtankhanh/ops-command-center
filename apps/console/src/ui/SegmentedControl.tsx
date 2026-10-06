import type { IncidentSeverity } from '@occ/contracts';
import styles from './SegmentedControl.module.css';

/**
 * One choice out of a few, shown side by side: a radio group in a `<fieldset>`, so arrow keys move
 * the choice and each option's accessible name is its `label`. The radios are visually hidden;
 * the focus ring is drawn on the visible option instead.
 *
 * An option with `severity` is marked in that severity's colour when checked; any other option in
 * the accent colour.
 */
export function SegmentedControl<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  className,
}: {
  legend: string;
  name: string;
  options: readonly { value: T; label: string; severity?: IncidentSeverity }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <fieldset className={className ? `${styles.group} ${className}` : styles.group}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.options}>
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
            <span className={styles.face}>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
