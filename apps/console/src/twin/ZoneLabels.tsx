import type { RefObject } from 'react';
import type { HeatScene } from '../lib/twinHeat';
import type { LabelAnchor } from '../lib/twinScene';
import { useConsole } from '../store';
import styles from './ZoneLabels.module.css';

interface ZoneLabelsProps {
  anchors: readonly LabelAnchor[];
  /** The layer's element; `LabelProjector` (inside the canvas) places its children. */
  layerRef: RefObject<HTMLDivElement | null>;
  /** The heat overlay (V2-17.3, `useHeatScene`), or `null` while it is not shown: a building's label gets its temperature. */
  heat: HeatScene | null;
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
 * - With a building in focus (V2-15.8, at building, asset and part level) every label but the building's own fades
 *   (`data-faded`, `--tw-label-faded-opacity`, 0.35 as TwinScene draws it), so the see-through building's name is the
 *   one that reads. With none in focus, including an asset isolated outside every building, nothing fades. The fade is
 *   store state, not per-frame: a React attribute is the right size for it, and the projector still owns the position.
 * - With the heat overlay shown (V2-17.3, frame 13) a building's label has a second line under its name: its temperature
 *   ("22.0 °C"), or "No data" for a building whose sensor is silent. The line is a child of the label, out of flow
 *   (`ZoneLabels.module.css .heat`), so the name keeps its place on the anchor and the projector's one-label-per-anchor,
 *   by-index contract is untouched; it fades with its label. A zone that is not a building has no line. The overlay is
 *   `null` at asset and part level, where the labels are as they were (ADR-0020 "Settled in V2-17.3").
 * - Under the stage tools, the banners and the sheet without any `z-index`: the stage is
 *   `isolation: isolate` (`StageView.module.css`), so everything inside it paints below them.
 */
export function ZoneLabels({ anchors, layerRef, heat }: ZoneLabelsProps) {
  const focusZoneId = useConsole((state) => state.focusZoneId);
  return (
    <div ref={layerRef} className={styles.layer} aria-hidden="true">
      {anchors.map(({ zoneId, name }) => {
        const temperature = heat?.labels.get(zoneId);
        return (
          <span
            key={zoneId}
            className={styles.label}
            data-faded={focusZoneId !== null && zoneId !== focusZoneId}
          >
            {name}
            {temperature !== undefined && <span className={styles.heat}>{temperature}</span>}
          </span>
        );
      })}
    </div>
  );
}
