import type { Camera } from '@occ/contracts';
import { useMemo } from 'react';
import type { MarkerForm } from '../lib/mapImages';
import { presenceOf } from '../lib/twinLevel';
import { GHOST_OPACITY } from '../lib/twinMaterials';
import { cameraMarkers } from '../lib/twinMarkers';
import type { Frame } from '../lib/twinScene';
import { useConsole } from '../store';
import { Markers } from './Markers';
import { useMarkerAtlas } from './useMarkerAtlas';
import { useSceneFocus } from './useSceneFocus';

/** The two looks of a camera, the 2D map's own: online, and offline (dashed edge, crossed-out glyph). */
const CAMERA_FORMS: readonly MarkerForm[] = [
  { kind: 'camera', online: true },
  { kind: 'camera', online: false },
];

interface CameraMarkersProps {
  cameras: readonly Camera[];
  frame: Frame;
}

/**
 * Every camera as a screen-sized marker on its pole (V2-12.8, frame 01), from the 2D map's own bitmaps. An offline
 * camera differs by shape, not only by colour: a dashed edge and a crossed-out glyph. Hidden, all of them and
 * their stems and nothing else, when the Cameras layer is off (`layers.cameras`, the store the "Show" control
 * writes); the store is a plain external store, so the hook is safe inside the canvas.
 *
 * While an asset is isolated (V2-15.7) the markers are faded to `--tw-ghost-opacity` with the rest of the campus
 * (`presenceOf`): a symbol that is always drawn over the scene would otherwise shout over the asset. At building level
 * they stay as they are (V2-15.8): the frames' scene draws them so, and the Cameras layer is a toggle of its own.
 *
 * Nothing is drawn until the bitmaps have decoded, and no view cone: the 2D map draws those, frame 01 does not.
 */
export function CameraMarkers({ cameras, frame }: CameraMarkersProps) {
  const atlas = useMarkerAtlas(CAMERA_FORMS);
  const sprites = useMemo(() => cameraMarkers(cameras, frame), [cameras, frame]);
  const visible = useConsole((state) => state.layers.cameras);
  const focus = useSceneFocus();
  const opacity = presenceOf({ kind: 'marker' }, focus) === 'faded' ? GHOST_OPACITY : 1;

  if (atlas === null) return null;
  return <Markers sprites={sprites} atlas={atlas} visible={visible} opacity={opacity} />;
}
