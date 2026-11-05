import { useConsole } from '../../store';
import { useDisplayMode } from '../shell/useDisplayMode';
import { effectiveFeedView } from './feedView';

/**
 * The table section's element id (V3-24.5). `FeedViewSwitch` reads it to tell whether focus is in the table before `T`
 * removes it, so focus can move to the switch instead of dropping to the page. Here, beside the "table shown" rule, and
 * not in `IncidentTable.tsx`: the table already imports the switch's id, and the two components must not import each
 * other.
 */
export const INCIDENT_TABLE_ID = 'incident-table';

/**
 * Whether the incident table is drawn over the stage (V3-24.4): the one home of the rule, read by `App` for the mount and for
 * making the covered map and strip `inert`, and by V3-24.5 for Esc and the `T` key.
 *
 * - The operator chose the table (`feedView`, remembered per browser, V3-24.3) and the screen is not a phone, where the stage
 *   is stacked above the feed and an overlay does not fit (`effectiveFeedView`).
 * - The Incidents panel is the one shown. The table is a view of the incident list, and the Assets list moves the map: an
 *   asset picked there would fly a camera under an opaque table. The stored choice is kept and comes back with the tab, as the
 *   switch itself hides on the Assets panel.
 * - Not on a video wall. `WallApp` never mounts the console's stage, so this is defence in depth, not the rule that hides it.
 */
export function useIncidentTableShown(): boolean {
  const feedView = useConsole((s) => s.feedView);
  const incidentsPanel = useConsole((s) => s.sidePanel === 'incidents');
  const onWall = useConsole((s) => s.wall !== null);
  const mode = useDisplayMode();
  return effectiveFeedView(feedView, mode) === 'table' && incidentsPanel && !onWall;
}
