import { useFrame, useThree } from '@react-three/fiber';
import { type RefObject, useEffect } from 'react';
import { Vector3 } from 'three';
import { labelTransform, stagePoint } from '../lib/twinLabels';
import type { LabelAnchor } from '../lib/twinScene';

/** One vector for every projection: no allocation per label per frame. */
const scratch = new Vector3();

interface LabelProjectorProps {
  anchors: readonly LabelAnchor[];
  /** The element `ZoneLabels` renders; its child `i` is the label of `anchors[i]`. */
  layerRef: RefObject<HTMLDivElement | null>;
}

/**
 * Places the zone labels (V2-12.7). Rendered inside the canvas, it renders nothing: on every frame that
 * is drawn it projects each anchor through the camera and writes the matching DOM label's `transform`
 * and `visibility` directly. No React state, so a moving camera costs no React render (acceptance
 * criterion 3).
 *
 * - `frameloop="demand"` draws only when asked, and this runs only on a drawn frame. The camera moving
 *   or the canvas resizing asks for one; a new set of anchors does not, so it asks itself.
 * - A label is written only when its string changed, and positions are rounded to 0.1 px
 *   (`labelTransform`), so a camera that has settled touches the DOM not at all.
 * - A label behind the camera or outside the stage (with a margin) is hidden, not removed.
 * - `camera.updateMatrixWorld()` first: another `useFrame` (the rig of V2-12.9) may have moved the
 *   camera earlier in this same frame, before the renderer refreshes its matrices.
 *
 * Frame demand: one-shot. An effect asks for one frame when the anchors or the canvas size change; the labels are
 *   placed in frames the camera (or that request) asked for.
 */
export function LabelProjector({ anchors, layerRef }: LabelProjectorProps) {
  const invalidate = useThree((state) => state.invalidate);
  const { width, height } = useThree((state) => state.size);

  useEffect(() => {
    invalidate();
  }, [anchors, width, height, invalidate]);

  useFrame(({ camera, size }) => {
    const layer = layerRef.current;
    if (!layer) return;
    camera.updateMatrixWorld();
    anchors.forEach(({ position }, index) => {
      const label = layer.children[index];
      if (!(label instanceof HTMLElement)) return;
      scratch.set(...position).project(camera);
      const point = stagePoint([scratch.x, scratch.y, scratch.z], size.width, size.height);
      if (point.visible) {
        const transform = labelTransform(point.x, point.y);
        if (label.style.transform !== transform) label.style.transform = transform;
        if (label.style.visibility !== 'visible') label.style.visibility = 'visible';
      } else if (label.style.visibility !== 'hidden') {
        label.style.visibility = 'hidden';
      }
    });
  });

  return null;
}
