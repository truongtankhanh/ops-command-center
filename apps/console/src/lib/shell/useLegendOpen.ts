import { useState } from 'react';

/**
 * Per browser, like any view preference. One preference for both legends: the 2D map's (`MapLegend`) and
 * the 3D stage's (`TwinLegend`), so a legend closed in one view is closed in the other.
 */
const STORAGE_KEY = 'occ.console.mapLegendOpen';

/**
 * Whether a legend is open, and how to toggle it. Open by default; an operator who closes it keeps it closed
 * after a reload. Storage can be missing or throw (private window, blocked site data): the legend then opens
 * and toggles as usual, it is just not remembered.
 */
export function useLegendOpen(): [open: boolean, toggle: () => void] {
  const [open, setOpen] = useState(readOpen);

  const toggle = () => {
    setOpen(!open);
    writeOpen(!open);
  };

  return [open, toggle];
}

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
