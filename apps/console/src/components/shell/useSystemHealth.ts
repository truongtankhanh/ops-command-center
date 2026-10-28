import { useMemo } from 'react';
import { useSession } from '../../auth/store';
import { type SystemHealth, systemHealth } from '../../lib/shell/systemHealth';
import type { ViewChoice } from '../../lib/shell/viewChoice';
import type { TelemetryPillState } from '../../lib/telemetry/telemetryState';
import type { TwinCapability } from '../../lib/twin-core/twinCapability';
import { useTwinCapability } from '../../lib/twin-core/useTwinCapability';
import { useTelemetryStatus } from '../../realtime/telemetryStore';
import { type ConnectionState, useConsole } from '../../store';

/** What the status bar draws: the health, and the raw states its two link glyphs and its engine glyph are picked from. */
export interface SystemHealthView {
  health: SystemHealth;
  connection: ConnectionState;
  telemetry: TelemetryPillState;
  /** The 3D view is the one on the stage (capable device and the operator's choice; a wall's choice is always 3D), so the engine glyph is the 3D box. */
  drawing3d: boolean;
}

/**
 * The console's health for the status bar (V3-06.2). It adds no source of truth (V3 brief § Status bar): the five facts
 * are the ones the header pills, the banners and the 3D fallback already read, handed to the pure `systemHealth`
 * (V3-06.1). One selector each, so the bar renders when one of them changes and not for anything else in the stores.
 *
 * `useTwinCapability` returns a new object on every render, so the memo depends on its reason (a string or `null`) and
 * rebuilds the capability from it; depending on the object itself would never hold.
 *
 * On a video wall (V3-06.4) the view is 3D whenever the capability allows it: `store.view` is the operator's stored 2D/3D
 * choice, which a wall does not follow (`WallStage` lets only the capability decide, V2-21.9), so reading it would say "2D map"
 * over a 3D picture. After a fault `markTwinLost` has already set the view to 2D and the capability's reason wins, as on the console.
 */
export function useSystemHealth(): SystemHealthView {
  const connection = useConsole((s) => s.connection);
  const wall = useConsole((s) => s.wall);
  const choice = useConsole((s) => s.view);
  const view: ViewChoice = wall !== null ? '3d' : choice;
  const sessionExpired = useSession((s) => s.expired);
  const { pill: telemetry } = useTelemetryStatus();
  const twin = useTwinCapability();
  const reason = twin.available ? null : twin.reason;

  return useMemo(() => {
    const capability: TwinCapability =
      reason === null ? { available: true } : { available: false, reason };
    return {
      health: systemHealth({ connection, telemetry, sessionExpired, twin: capability, view }),
      connection,
      telemetry,
      drawing3d: reason === null && view === '3d',
    };
  }, [connection, telemetry, sessionExpired, reason, view]);
}
