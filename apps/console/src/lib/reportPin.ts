import type { LngLat, Zone } from '@occ/contracts';
import { useConsole } from '../store';
import { zoneAt } from './geo';

/**
 * Places the report's pin at `point` if it lies in a zone, else reports a miss. True if placed. The one rule for both
 * views (V2-16.7): the 2D map's click and drag (`CampusMap`) and the 3D view's click and drop (`twin/Pointer`) end
 * here, and zones are found by the API's own rule (`zoneAt`), so a placed pin is never refused for lying outside its
 * zone. It reads and writes the console store: the location lives there, because the map and the stage draw the pin
 * and outline the zone from it.
 */
export function placePinAt(point: LngLat, zones: readonly Zone[] | undefined): boolean {
  const zone = zoneAt(point, zones ?? []);
  const { placePin, missPin } = useConsole.getState();
  if (zone) placePin(point, zone.id);
  else missPin();
  return zone !== undefined;
}
