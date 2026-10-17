import { useId } from 'react';
import { useLegendOpen } from '../lib/useLegendOpen';
import { Icon } from '../ui/Icon';
import { cameraIcon, ChevronDown } from '../ui/icons';
import styles from './TwinLegend.module.css';

/**
 * The 3D stage's legend (V2-12.10, frame 01 `.tw-legend`), bottom-left, in the 2D legend's look and with its
 * toggle: the same open or closed preference (`useLegendOpen`), so a legend closed in one view is closed in
 * the other. Status is shape (a filled disc is open, a ring is being handled), not colour, so the swatches
 * are neutral; the camera entry is the camera glyph.
 *
 * It names what the stage will show: the incident markers arrive with V2-16 and the asset hover with V2-15.
 * The 3D view stays behind the preview gate until both are in (V2-19.8).
 */
export function TwinLegend() {
  const entriesId = useId();
  const [open, toggle] = useLegendOpen();

  return (
    <div className={styles.legend}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={entriesId}
        onClick={toggle}
      >
        Legend
        <Icon glyph={ChevronDown} size={16} className={styles.chevron} />
      </button>
      <ul id={entriesId} className={styles.entries} hidden={!open}>
        <li>
          <span className={`${styles.swatch} ${styles.open}`} aria-hidden />
          Open
        </li>
        <li>
          <span className={`${styles.swatch} ${styles.handled}`} aria-hidden />
          Being handled
        </li>
        <li>
          <Icon glyph={cameraIcon(true)} size={16} />
          Camera
        </li>
        <li>
          <span className={styles.asset} aria-hidden />
          Asset — hover for readings
        </li>
      </ul>
    </div>
  );
}
