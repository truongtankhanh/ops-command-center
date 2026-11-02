import type { Ref } from 'react';
import styles from './ScaleBar.module.css';

/**
 * A map's scale bar (V3-10.3, frames 01 and 09): a bracket as wide as `widthPx` and a label under it. Decorative to
 * assistive technology (`aria-hidden`), not focusable, and it takes no pointer: it is a picture of the scale, and the same
 * figure has no other text equivalent a screen reader would need.
 *
 * It renders **nothing that changes**: the width and the label are written with `writeScale` from the 2D map's `zoom`
 * event and from the 3D canvas' frame loop, so neither view holds React state for it and no zoom or frame renders anything.
 * Until the first reading the bar is invisible (no `data-ready`). Like `Panel` it sets no outer layout: the caller passes a
 * `className` that places it.
 *
 * The structure is part of the contract with `writeScale` (`./writeScale`): the label is the last child.
 */
export function ScaleBar({ ref, className }: { ref?: Ref<HTMLDivElement>; className?: string }) {
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={className ? `${styles.scale} ${className}` : styles.scale}
    >
      <span className={styles.bar} />
      <span className={styles.label} />
    </div>
  );
}
