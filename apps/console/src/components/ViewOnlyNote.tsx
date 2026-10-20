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
 * `action` is the slot at the row's end (V2-15.11: the asset inspector's "Focus", which a viewer has as well as the
 * note). It sits after the paragraph, not inside it: the text grows and the action is `flex: none`, so it is pushed
 * to the edge without a shift. A foot that has none renders exactly as before.
 */
export function ViewOnlyNote({
  icon = Eye,
  footer = 'view-only',
  action,
  children,
}: {
  icon?: Glyph;
  footer?: 'view-only' | 'out-of-scope';
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.note} role="note" data-footer={footer}>
      <Icon glyph={icon} size={18} className={styles.icon} />
      <p className={styles.text}>{children}</p>
      {action !== undefined && <div className={styles.action}>{action}</div>}
    </div>
  );
}
