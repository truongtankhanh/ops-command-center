import type { TelemetryPillState } from '../telemetry/telemetryState';
import type { ConnectionState } from '../../store';

/*
 * The words of the two connection pills (frames 01 and 05). The header's pills, the video wall's and the
 * status bar (`systemHealth`, V3-06.1) all say a link's state in these words, so they live here: `lib/` cannot
 * import them from a component. A `Record`, so a new state does not typecheck until it has its word.
 */

export const CONNECTION_LABEL: Record<ConnectionState, string> = {
  live: 'Live',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
};

// The wording of V2-08.1; frames 01 and 05 draw `live` and `paused`.
export const TELEMETRY_LABEL: Record<TelemetryPillState, string> = {
  connecting: 'Telemetry connecting…',
  live: 'Telemetry',
  paused: 'Telemetry paused',
  reconnecting: 'Telemetry reconnecting…',
  unavailable: 'Telemetry unavailable',
};
