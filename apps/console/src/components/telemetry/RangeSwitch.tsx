import { type KeyboardEvent, useRef } from 'react';
import type { ReadingRange, ReadingRangeOption } from '../../lib/telemetry/readingRange';
import { nextTabIndex } from '../../ui/tabNavigation';
import styles from './RangeSwitch.module.css';

/** ↑ and ↓ move as ← and → do (APG radio group); `nextTabIndex` stays horizontal for `Tabs`. */
const VERTICAL_AS_HORIZONTAL: Readonly<Record<string, string>> = {
  ArrowUp: 'ArrowLeft',
  ArrowDown: 'ArrowRight',
};

/**
 * The Telemetry tabs' range switch (V3-23.3, frame 18): 15 min | 1 h | Around the alarm, one choice
 * at a time. A radio group (WAI-ARIA APG): one Tab stop on the checked option, ← / → and ↑ / ↓ move
 * and check at once (wrapping), Home and End jump to the ends, Space and a click check. The change
 * is not announced by a live region: the radio's own name and state are what a screen reader says,
 * and the tab's eyebrow names the range drawn.
 *
 * Not `ui/SegmentedControl`: that is native radios in a `<fieldset>` with a visible legend, which
 * exposes no `aria-checked` and gets no Home / End from the browser, and frame 18 draws no legend;
 * the shared primitive is left as it is. The keys are `Tabs`' own (`nextTabIndex`), the look is
 * `SegmentedControl`'s row.
 *
 * `options` come filtered by the caller (`rangeOffered`), so this knows nothing of incidents or
 * assets. The same for every role: choosing a range reads, it changes nothing.
 */
export function RangeSwitch({
  options,
  value,
  onChange,
  className,
}: {
  options: readonly ReadingRangeOption[];
  value: ReadingRange;
  onChange: (range: ReadingRange) => void;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const checked = options.findIndex((option) => option.id === value);
  // A value that is not offered checks nothing, and the first option keeps the group reachable.
  const stop = Math.max(0, checked);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = refs.current.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    const key = VERTICAL_AS_HORIZONTAL[event.key] ?? event.key;
    const next = nextTabIndex(key, current, options.length);
    const target = next === null ? undefined : options[next];
    if (next === null || !target) return;
    event.preventDefault();
    onChange(target.id);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Reading range"
      className={className ? `${styles.switch} ${className}` : styles.switch}
      onKeyDown={onKeyDown}
    >
      {options.map((option, index) => (
        <button
          key={option.id}
          ref={(element) => {
            refs.current[index] = element;
          }}
          type="button"
          role="radio"
          aria-checked={option.id === value}
          tabIndex={index === stop ? 0 : -1}
          className={styles.option}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
