/*
 * The one writer of `ScaleBar` (V3-10.3), in a file of its own so `ScaleBar.tsx` exports only the component (Fast Refresh).
 * It relies on that component's markup: the root carries `data-ready` and the `--scale-bar-width` variable, and the label is
 * the root's last child.
 */

/** What the bar shows: a label ("50 m") and how wide the bar is drawn, in CSS px. */
export interface ScaleReading {
  label: string;
  widthPx: number;
}

/**
 * Shows `reading` on the bar under `root`, or hides the bar for `null`. Idempotent and cheap enough for a frame loop: the
 * width is rounded to a whole pixel and written, and the label set, only when they differ from what is there, so a camera
 * that has settled writes nothing and a label changes only when the length does. A missing `root` (the stage has not
 * mounted the bar yet, or has unmounted it) is ignored.
 */
export function writeScale(root: HTMLElement | null, reading: ScaleReading | null): void {
  if (!root) return;
  root.toggleAttribute('data-ready', reading !== null);
  if (!reading) return;
  const width = `${Math.round(reading.widthPx)}px`;
  if (root.style.getPropertyValue('--scale-bar-width') !== width) {
    root.style.setProperty('--scale-bar-width', width);
  }
  const label = root.lastElementChild;
  if (label && label.textContent !== reading.label) label.textContent = reading.label;
}
