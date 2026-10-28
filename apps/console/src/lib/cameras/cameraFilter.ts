import type { Camera } from '@occ/contracts';

/** Which cameras the strip lists (V3-08.2): all of them, those that are online, or those that are not. */
export type CameraFilter = 'all' | 'live' | 'offline';

/**
 * Every filter, in tab order, with the word its tab shows. "Live" is `camera.online` (see `countCameras`), so the
 * label promises no more than "online".
 */
export const CAMERA_FILTERS: readonly { value: CameraFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'live', label: 'Live' },
  { value: 'offline', label: 'Offline' },
];

/**
 * How many cameras each filter lists, from one pass over the list, so `live + offline` is always `all`.
 * "Live" is `camera.online`, which is all the contract says about a camera's health: an online camera whose stream
 * is unavailable (`feedState`) still counts as live, so a label must not promise more than "online".
 */
export function countCameras(cameras: readonly Camera[]): Record<CameraFilter, number> {
  let live = 0;
  for (const camera of cameras) if (camera.online) live++;
  return { all: cameras.length, live, offline: cameras.length - live };
}

/**
 * The cameras `filter` lists, in the order they came in: the strip's own order (`prioritise`, pins first) is applied
 * after the filter, not by it. No `default`: a filter added to the union fails to compile here until it has a
 * meaning, and is never read as "all".
 */
export function filterCameras(cameras: readonly Camera[], filter: CameraFilter): Camera[] {
  switch (filter) {
    case 'all':
      return [...cameras];
    case 'live':
      return cameras.filter((camera) => camera.online);
    case 'offline':
      return cameras.filter((camera) => !camera.online);
  }
}
