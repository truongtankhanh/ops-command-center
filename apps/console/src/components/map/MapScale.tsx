import type { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { mapMetresPerPixel, scaleReading } from '../../lib/map/scaleBar';
import { ScaleBar } from '../../ui/ScaleBar';
import { writeScale } from '../../ui/writeScale';

interface MapScaleProps {
  map: MapLibreMap | null;
  /**
   * The latitude the scale is true at: the site's, not the view's centre. Over a campus a few hundred metres wide (and a
   * map that will not zoom out past 15) `cos(lat)` moves far less than a pixel, and reading the site's keeps the bar
   * off `map.getCenter()`. `undefined` until the site (or its first zone) is known: no bar then.
   */
  latitude: number | undefined;
  /** Places the bar; the bar itself sets no layout. */
  className?: string;
}

/**
 * Frame 09's scale bar for the 2D map (V3-10.3): a round length (1 / 2 / 5 × 10ⁿ m) at MapLibre's own ground resolution
 * for the current zoom. It follows `map` `zoom` (which also fires when the view is fitted or eased) and renders nothing
 * after the first render: each event is written straight to the bar (`writeScale`), which touches the DOM only when the
 * pixel width or the label differ, so the label changes only when the length does and a zoom animation re-renders nothing.
 *
 * Not on a video wall: `CampusMap` mounts it behind `!wall`, with the rest of the map's chrome.
 */
export function MapScale({ map, latitude, className }: MapScaleProps) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!map || latitude === undefined) {
      writeScale(root.current, null);
      return;
    }
    const show = () =>
      writeScale(root.current, scaleReading(mapMetresPerPixel(map.getZoom(), latitude)));
    show();
    map.on('zoom', show);
    return () => {
      map.off('zoom', show);
    };
  }, [map, latitude]);

  return <ScaleBar ref={root} className={className} />;
}
