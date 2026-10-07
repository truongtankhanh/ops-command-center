import type { ReactNode } from 'react';
import styles from './Hint.module.css';
import { Icon } from './Icon';
import { type Glyph, Info } from './icons';

export type HintTone = 'info' | 'warning';

/**
 * A one-line hint under a field or the actions (frames 02 / 03), such as "Esc keeps your note.
 * Close discards it.". `warning` draws it in `--warning` to stress it after the operator ran into
 * it; the text says the same either way, so the colour only adds emphasis. `data-tone` is set for
 * tests (ADR-0016 §4).
 *
 * Not a live region: a hint shown while typing would be read out on every first keystroke. The
 * caller announces what needs announcing (e.g. `Sheet`'s `keptMessage`).
 */
export function Hint({
  tone = 'info',
  icon = Info,
  id,
  children,
}: {
  tone?: HintTone;
  /** Decorative; `Info` unless the hint is about something with its own glyph (the report pin). */
  icon?: Glyph;
  /** For a control that names this hint in its `aria-describedby`. */
  id?: string;
  children: ReactNode;
}) {
  return (
    <p id={id} className={styles.hint} data-tone={tone}>
      <Icon glyph={icon} size={14} />
      {children}
    </p>
  );
}
