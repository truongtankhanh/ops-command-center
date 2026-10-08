import { useId, useState } from 'react';
import { Icon } from '../ui/Icon';
import { cameraIcon, ChevronDown } from '../ui/icons';
import styles from './MapLegend.module.css';

/** Per browser, like any view preference; nothing else reads it. */
const STORAGE_KEY = 'occ.console.mapLegendOpen';

/**
 * Frame 01's legend, bottom-left. Status is shape (filled = open, ring = being handled), not
 * colour, so the swatches are neutral; the hue is severity, said in words as the last entry.
 * Open by default; an operator who closes it keeps it closed after a reload.
 */
export function MapLegend() {
  const entriesId = useId();
  const [open, setOpen] = useState(readOpen);

  const toggle = () => {
    setOpen(!open);
    writeOpen(!open);
  };

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
        <li>Colour = severity</li>
      </ul>
    </div>
  );
}

// Storage can be missing or throw (private window, blocked site data): the legend then opens and
// toggles as usual, it is just not remembered.

function readOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function writeOpen(open: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(open));
  } catch {
    // Not remembered; see above.
  }
}
