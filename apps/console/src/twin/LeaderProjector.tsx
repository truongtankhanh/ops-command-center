import { useFrame, useThree } from '@react-three/fiber';
import { type RefObject, useEffect, useRef } from 'react';
import { Box3, Vector3 } from 'three';
import { stagePoint, type StagePoint } from '../lib/twin-core/twinLabels';
import {
  type LeaderLine,
  type LeaderStart,
  leaderLine,
  NO_LINE,
  sameLine,
} from '../lib/twin-core/twinLeader';
import { NO_SELECTION, type SelectedPart } from '../lib/twin-core/twinHover';
import type { ModelInstance } from './AssetModel';

/** One box and one vector for every frame: no allocation per drawn frame. */
const bounds = new Box3();
const centre = new Vector3();

/** Writes `line` into the SVG elements, in place. A function of its own so the hook body does not touch DOM it does not own. */
function write(element: SVGLineElement, dot: SVGCircleElement | null, line: LeaderLine): void {
  const visibility = line.visible ? 'visible' : 'hidden';
  element.setAttribute('x1', String(line.x1));
  element.setAttribute('y1', String(line.y1));
  element.setAttribute('x2', String(line.x2));
  element.setAttribute('y2', String(line.y2));
  element.setAttribute('visibility', visibility);
  if (dot === null) return;
  dot.setAttribute('cx', String(line.x2));
  dot.setAttribute('cy', String(line.y2));
  dot.setAttribute('visibility', visibility);
}

interface LeaderProjectorProps {
  /** The model instances the scene shows: the selected asset's holds the part. */
  instances: readonly Pick<ModelInstance, 'assetCode' | 'object'>[];
  /** The selected part (`useSelectedPartRef`). */
  selection: RefObject<SelectedPart>;
  /** The overlay's line and dot (`LeaderOverlay`, which `TwinStage` renders): the elements this writes into. */
  lineRef: RefObject<SVGLineElement | null>;
  dotRef: RefObject<SVGCircleElement | null>;
  /** Where the line starts, the card's right edge: set by the stage from what the card measured; `null` without a card. */
  startRef: RefObject<LeaderStart | null>;
}

/**
 * Draws the leader from the part callout to its part (V2-15.10, frames 03, 08 and 17). Rendered inside the canvas, it
 * renders nothing: on every frame that is **drawn**, and only while a part is selected, it takes the centre of the
 * part's world bounds (so a spinning blade's anchor moves with it), projects it through the camera as the zone labels
 * are (`stagePoint`) and writes the SVG line's end and the dot through refs, only when the rounded line changed
 * (`leaderLine`, `sameLine`). No React state, so a moving camera costs no React render.
 *
 * - `frameloop="demand"` draws only when asked, and this runs only on a drawn frame. The camera moving, a reading
 *   arriving and the selection changing (`useSelectedPartRef`) ask for one; the stage asks too when the card has been
 *   measured or has changed size (it holds the canvas's `invalidate`).
 * - The line is hidden when there is no selection, no card measured yet, the selected asset is not shown, the model has
 *   no such node, or the anchor is behind the camera or off the stage.
 * - `camera.updateMatrixWorld()` first, as the labels do: the rig may have moved the camera earlier in this frame.
 *
 * Frame demand: one-shot. An effect asks for one frame on mount, for a stage that comes up with a part already
 *   selected; the leader is drawn in frames somebody else asked for (the card's report, the selection, the camera).
 */
export function LeaderProjector({
  instances,
  selection,
  lineRef,
  dotRef,
  startRef,
}: LeaderProjectorProps) {
  const invalidate = useThree((state) => state.invalidate);
  const written = useRef<LeaderLine>(NO_LINE);

  // A frame for a stage that comes up with a part already selected.
  useEffect(() => {
    invalidate();
  }, [invalidate]);

  useFrame(({ camera, size }) => {
    const element = lineRef.current;
    // The overlay is not there yet: nothing was written, so nothing is remembered as written.
    if (element === null) return;
    const picked = selection.current;
    let end: StagePoint | null = null;
    if (picked !== NO_SELECTION && picked.part !== null) {
      const instance = instances.find(({ assetCode }) => assetCode === picked.asset);
      const node = instance?.object.getObjectByName(picked.part);
      if (node !== undefined) {
        bounds.setFromObject(node);
        if (!bounds.isEmpty()) {
          bounds.getCenter(centre);
          camera.updateMatrixWorld();
          centre.project(camera);
          end = stagePoint([centre.x, centre.y, centre.z], size.width, size.height);
        }
      }
    }
    const line = leaderLine(startRef.current, end);
    if (sameLine(written.current, line)) return;
    written.current = line;
    write(element, dotRef.current, line);
  });

  return null;
}
