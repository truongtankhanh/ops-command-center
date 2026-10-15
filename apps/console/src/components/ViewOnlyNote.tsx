import type { ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { Eye, type Glyph } from '../ui/icons';
import styles from './ViewOnlyNote.module.css';

/**
 * The note that stands in for a sheet's actions when the user has none to take (frames 06, 11, 17):
 * a glyph and a sentence, a `role="note"` so the sheet never ends in a gap. It is the sheet's
 * foot: sticky at the bottom, as the response form it replaces.
 *
 * Three words use it: "View only" on an incident and on an asset (the role has no permission), and
 * "handled by operators" on an incident outside a technician's scope (`footer="out-of-scope"`).
 * `footer` is only for tests and styling hooks (`data-footer`); the sentence is the caller's, in
 * `children`, usually a `<strong>` heading and a line.
 *
 * The row is the slot for what comes later at its end (a "Focus" button, V2-12): the text grows,
 * so a `flex: none` sibling is pushed to the edge without a shift.
 */
export function ViewOnlyNote({
  icon = Eye,
  footer = 'view-only',
  children,
}: {
  icon?: Glyph;
  footer?: 'view-only' | 'out-of-scope';
  children: ReactNode;
}) {
  return (
    <div className={styles.note} role="note" data-footer={footer}>
      <Icon glyph={icon} size={18} className={styles.icon} />
      <p className={styles.text}>{children}</p>
    </div>
  );
}
