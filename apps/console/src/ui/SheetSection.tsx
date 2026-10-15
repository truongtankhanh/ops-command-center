import { type ReactNode, useId } from 'react';
import styles from './SheetSection.module.css';

/**
 * One section of a sheet (frames 03, 15 `.sheet-section`): an eyebrow `h3` that names the region,
 * an optional `aside` beside it, then the content. The eyebrow is the section's accessible name, so
 * a screen reader lists the sheet's sections by their words.
 *
 * `AssetReadings` draws the same eyebrow with a copy of this CSS; moving it here is a one-line
 * follow-up that V2-09.9 left alone.
 */
export function SheetSection({
  title,
  aside,
  children,
}: {
  title: string;
  /** Drawn at the end of the eyebrow row: a freshness text, a count. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section className={styles.section} aria-labelledby={titleId}>
      <div className={styles.head}>
        <h3 id={titleId}>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}
