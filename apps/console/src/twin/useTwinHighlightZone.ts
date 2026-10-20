import { useIncidents } from '../api/queries';
import { highlightZoneOf } from '../lib/twinHighlight';
import { useConsole } from '../store';
import type { TwinScene } from './useTwinScene';

/**
 * The zone to outline on the 3D ground (V2-16.4): the report's zone while the report form is open, else the selected
 * incident's zone, the 2D map's rule (`highlightZoneOf`). Read by the stage and handed to the canvas, because
 * `<Canvas>` renders in its own reconciler where a query hook has no client (as `useTwinBeacons`): the incident's zone
 * is in the incidents query. The store's fields are plain selectors, so a render happens only when one of them
 * changes. `null` while the scene is on its way.
 */
export function useTwinHighlightZone(scene: TwinScene | null): string | null {
  const { data: incidents } = useIncidents();
  const reporting = useConsole((state) => state.reporting);
  const reportZoneId = useConsole((state) => state.reportZoneId);
  const selectedIncidentId = useConsole((state) => state.selectedIncidentId);

  return scene === null
    ? null
    : highlightZoneOf({ reporting, reportZoneId, selectedIncidentId, incidents });
}
