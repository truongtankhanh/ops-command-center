import { useAssets, useIncident } from '../api/queries';
import { deriveWatchSet, incidentWatchCode } from '../lib/telemetryWatch';
import { useTelemetryWatch } from '../realtime/useTelemetry';
import { useConsole } from '../store';

/**
 * What the console asks the API for every reading of: the asset open in the inspector, then the
 * asset of the open incident while a telemetry rule's incident is unresolved (V2-11.2), and nothing
 * when neither applies. The set is left in place when a caller unmounts (`useTelemetryWatch`), so
 * closing a sheet clears it by this component passing `[]`.
 *
 * On a video wall (V2-21.8) the only slot is the incident the camera is on: the wall watches the focused asset while it
 * is focused and nothing when it is idle, inside the same limit.
 *
 * The one owner of the set: the evidence block on the incident sheet only reads, because two callers
 * would overwrite each other's set. The store keeps the inspector and the incident sheet exclusive
 * today, so both slots are filled only when that changes; the server already delivers both (V2-08.2).
 * A component of its own and long lived, mounted by `App` for the whole session.
 */
export function TelemetryWatchSet() {
  const inspected = useConsole((s) => s.selectedAssetCode);
  const selectedIncidentId = useConsole((s) =>
    s.wall === null ? s.selectedIncidentId : s.wallFocusId,
  );
  // The same query as the incident sheet's, so this adds no request; `assets` is the catalogue the
  // map and the lists already load.
  const { data: incident } = useIncident(selectedIncidentId);
  const { data: assets } = useAssets();
  const watched = incident && assets ? incidentWatchCode(incident, assets) : null;
  useTelemetryWatch(deriveWatchSet({ inspected, incident: watched }));
  return null;
}
