import { useId } from 'react';
import { useLegendOpen } from '../lib/useLegendOpen';
import { Icon } from '../ui/Icon';
import { cameraIcon, ChevronDown } from '../ui/icons';
import styles from './MapLegend.module.css';

/**
 * Frame 01's legend, bottom-left. Status is shape (filled = open, ring = being handled), not
 * colour, so the swatches are neutral; the hue is severity, said in words as the last entry.
 * The three asset entries (frame 14) are the marker's three looks, each a shape and its words: the
 * light edge, the severity tint and edge, the dim dashed edge.
 * Open by default; an operator who closes it keeps it closed after a reload (`useLegendOpen`, shared with
 * the 3D stage's legend).
 */
export function MapLegend() {
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
          <span className={styles.cluster} aria-hidden>
            3
          </span>
          Several incidents, badge = most severe
        </li>
        <li>
          <Icon glyph={cameraIcon(true)} size={16} />
          Camera
        </li>
        <li>
          <Icon glyph={cameraIcon(false)} size={16} className={styles.offline} />
          Camera offline
        </li>
        <li>
          <span className={styles.view} aria-hidden />
          Camera view
        </li>
        <li>
          <span className={styles.asset} aria-hidden />
          Asset
        </li>
        <li>
          <span className={styles.asset} data-look="fault" aria-hidden />
          Asset fault
        </li>
        <li>
          <span className={styles.asset} data-look="nodata" aria-hidden />
          Asset no data
        </li>
        <li>Colour = severity</li>
      </ul>
    </div>
  );
}
