import type { IncidentSeverity } from '@occ/contracts';
import type { ReactNode } from 'react';
import styles from './InspectorHeader.module.css';

/**
 * The header of the inspector's sheet (V3-09.4; frame 02, brief § Inspector): a tile with the
 * object's icon, its title, a line under it (the code and the place), the Close control, and under
 * them a row of chips. The incident's detail uses it now, the asset inspector in V3-09.7 and the
 * countdown chip of V3-22.4 goes in the row, so it knows nothing about incidents, assets or
 * statuses: the caller passes the icon, the words and the chips.
 *
 * - **The tile is decorative.** The words next to it name the object; a glyph alone names nothing
 *   to a screen reader. `severity` only gives the tile its hue (`data-severity`, read through the
 *   global `--sev`); a neutral tile has none.
 * - **The title is the sheet's `h2`** and is drawn only when there is one: a sheet that could not be
 *   loaded has a Close control and nothing to head.
 * - **The Close control is the caller's.** Close and Escape are not always the same step (the asset
 *   inspector's Escape first closes a part's callout, V3-09.1), so the caller owns the button, its
 *   name and its `Esc` hint; the header only gives it the corner.
 * - **The chips row is children.** Severity, status and age are words with a glyph, never colour
 *   alone: that is the caller's part, as it is for any chip.
 */
export function InspectorHeader({
  tile,
  severity,
  title,
  subtitle,
  closeButton,
  children,
}: {
  /** An icon, drawn in a square; decorative. */
  tile?: ReactNode;
  /** The hue of the tile; none for a neutral tile. */
  severity?: IncidentSeverity;
  title?: ReactNode;
  /** The line under the title: a code and a place. */
  subtitle?: ReactNode;
  closeButton: ReactNode;
  /** The row of chips under the title. */
  children?: ReactNode;
}) {
  return (
    <div className={styles.header}>
      <div className={styles.top}>
        {tile !== undefined && (
          <span className={styles.tile} data-severity={severity} aria-hidden="true">
            {tile}
          </span>
        )}
        <div className={styles.heading}>
          {title !== undefined && <h2 className={styles.title}>{title}</h2>}
          {subtitle !== undefined && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {closeButton}
      </div>
      {children !== undefined && <div className={styles.meta}>{children}</div>}
    </div>
  );
}
