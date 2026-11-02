import type { RefObject } from 'react';
import { ScaleBar } from '../ui/ScaleBar';

/**
 * Frame 01's scale bar for the 3D stage (V3-10.3): the DOM half, beside the canvas like the compass. It draws nothing until
 * `ScaleSync`, inside the canvas, writes its first reading through `scaleRef`, and then shows a round length marked "≈"
 * ("≈ 50 m"): the figure is true at the camera's target and approximate everywhere else on a perspective picture
 * (Open question 9 of the phase file).
 *
 * The measurement is made in the canvas and not here because only the canvas has the live camera and its own height; the
 * command API answers with the camera's end pose and no viewport. `TwinStage` mounts this with the scene and behind
 * `!wall`: a video wall mounts none of its chrome. The caller places it (`className`).
 */
export function TwinScale({
  scaleRef,
  className,
}: {
  scaleRef: RefObject<HTMLDivElement | null>;
  className?: string;
}) {
  return <ScaleBar ref={scaleRef} className={className} />;
}
