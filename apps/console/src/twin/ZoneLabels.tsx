import type { RefObject } from 'react';
import type { LabelAnchor } from '../lib/twinScene';
import styles from './ZoneLabels.module.css';

interface ZoneLabelsProps {
  anchors: readonly LabelAnchor[];
  /** The layer's element; `LabelProjector` (inside the canvas) places its children. */
  layerRef: RefObject<HTMLDivElement | null>;
}

/**
 * The zone names over the 3D stage (V2-12.7): one DOM label per anchor, in the anchors' order (the
 * projector places the child at index `i` for `anchors[i]`). They are DOM, not canvas text (ADR-0020):
 * the console's font and tokens, no new dependency, crisp at any pixel ratio.
 *
 * - Where each label goes is not React state: `LabelProjector` writes the style of these elements in
 *   the canvas's frame loop, so a moving camera re-renders nothing here. Until it has placed a label
 *   it stays hidden (`ZoneLabels.module.css`).
 * - Decoration for the eye only: `aria-hidden` and no pointer events. The names reach assistive tech
 *   through the incident feed, the Assets tab and the report's zone list, as the 2D map's labels do.
 * - Not a layer: nothing toggles them.
 * - Under the stage tools, the banners and the sheet without any `z-index`: the stage is
 *   `isolation: isolate` (`StageView.module.css`), so everything inside it paints below them.
 */
export function ZoneLabels({ anchors, layerRef }: ZoneLabelsProps) {
  return (
    <div ref={layerRef} className={styles.layer} aria-hidden="true">
      {anchors.map(({ zoneId, name }) => (
        <span key={zoneId} className={styles.label}>
          {name}
        </span>
      ))}
    </div>
  );
}
