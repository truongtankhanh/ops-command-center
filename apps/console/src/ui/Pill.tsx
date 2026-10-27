import type { ComponentProps } from 'react';
import styles from './Pill.module.css';

export type PillTone = 'neutral' | 'signal' | 'warning';

/**
 * A small status pill (frames 00, 01, 05): a fully rounded `div` the height of a control row, for a
 * word and a glyph.
 *
 * - `neutral` (default) is a state not yet good or bad news; `signal` is live data (the Live pill,
 *   `--signal`); `warning` is a link or readings that are not arriving. `--success` is not a tone:
 *   it stays for system feedback.
 * - `data-tone` is always set (`neutral`, `signal` or `warning`), so tests and later visual tests
 *   select on it, never on class names (ADR-0016 §4); a caller's own `data-tone` cannot override it.
 * - The tone never carries the state alone: the caller draws the state as a word and a glyph
 *   inside the pill. The caller also puts `role="status"` on the element it wants announced when
 *   it changes (a ticking age is kept outside it). The pill has no role of its own; any other `div`
 *   attribute (`data-state`, `aria-label`, `ref`) passes through.
 * - The pill sets no outer layout beyond not shrinking and not wrapping (`flex: none`,
 *   `white-space: nowrap`); pass a `className` for placement.
 *
 * Text on each tone is held to the pairs in `docs/design/tokens.md`.
 */
export function Pill({
  tone = 'neutral',
  className,
  ...props
}: ComponentProps<'div'> & { tone?: PillTone }) {
  return (
    <div
      {...props}
      className={className ? `${styles.pill} ${className}` : styles.pill}
      data-tone={tone}
    />
  );
}
