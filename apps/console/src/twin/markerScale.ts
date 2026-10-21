import { createContext, useContext, useEffect, useState } from 'react';
import { wallScale } from '../lib/wallScale';

/**
 * How much bigger than the console's own the screen-sized markers are drawn (V2-21.6): `1` everywhere but on the video
 * wall, where the camera markers and the beacons follow the wall's `--ui-scale` (`lib/wallScale.ts`, 1.35 at 1920 px) as
 * the zone labels do through CSS. A context, not a prop, because the markers sit several layers below `TwinCanvas` and
 * `Markers` is the one place that turns it into pixels. Beside the provider's file, as `PickContext.ts` is, so React Fast
 * Refresh keeps its components.
 */
export const MarkerScaleContext = createContext(1);

export function useMarkerScale(): number {
  return useContext(MarkerScaleContext);
}

/**
 * The marker scale of a wall (`wallScale` of the window's width, kept in step with the window), or `1` when this is not
 * a wall. The factor moves in steps, so most resizes set the value it already has and render nothing.
 */
export function useWallMarkerScale(wall: boolean): number {
  const [scale, setScale] = useState(() => (wall ? wallScale(window.innerWidth) : 1));
  useEffect(() => {
    if (!wall) return;
    const apply = () => setScale(wallScale(window.innerWidth));
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [wall]);
  return wall ? scale : 1;
}
