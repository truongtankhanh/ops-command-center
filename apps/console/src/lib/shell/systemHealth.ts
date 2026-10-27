import type { ConnectionState } from '../../store';
import type { TelemetryPillState } from '../telemetry/telemetryState';
import { TWIN_UNAVAILABLE_COPY, type TwinCapability } from '../twin-core/twinCapability';
import { CONNECTION_LABEL, TELEMETRY_LABEL } from './connectionLabels';
import type { ViewChoice } from './viewChoice';

/*
 * The console's health in one sentence (V3 brief § Status bar, V3-06.1). It adds no source of truth: the five facts
 * are the ones the header pills, the banners and the 3D fallback already read, handed in as primitives, so this stays
 * a pure function and the hook that reads them is the status bar's (V3-06.2). The words are the pills' and the twin
 * copy's, so the bar and the surfaces it summarises never disagree.
 */

export const HEALTHY_SUMMARY = 'System healthy';
export const SESSION_EXPIRED_SUMMARY = 'Session expired';

const ENGINE_UNAVAILABLE = '3D unavailable';
// A healthy link reads "Live" on its segment; the telemetry pill's own word for it, "Telemetry", would repeat the label.
const LIVE = 'Live';

/** `ok` works; `warn` is impaired but the console is holding on; `off` is down. */
export type HealthState = 'ok' | 'warn' | 'off';

export interface HealthSegment {
  label: string;
  state: HealthState;
  text: string;
}

export interface SystemHealthInput {
  connection: ConnectionState;
  telemetry: TelemetryPillState;
  sessionExpired: boolean;
  twin: TwinCapability;
  view: ViewChoice;
}

/**
 * The session has no segment: it is the first problem in `summary` and nothing else. The tier word of the engine
 * (V3-18) and the alarm load (V3-21) plug in without changing this shape.
 */
export interface SystemHealth {
  level: 'healthy' | 'degraded';
  summary: string;
  segments: { events: HealthSegment; telemetry: HealthSegment; engine: HealthSegment };
}

// `connecting` is the first connect, a link being made and not bad news (the pills draw it neutral); a refused first
// connect goes on to `offline` (`store.ts`), which is. `Record`s, so a new state has no health until it is given one.
const EVENTS_STATE: Record<ConnectionState, HealthState> = {
  live: 'ok',
  connecting: 'ok',
  reconnecting: 'warn',
  offline: 'off',
};

const TELEMETRY_STATE: Record<TelemetryPillState, HealthState> = {
  live: 'ok',
  connecting: 'ok',
  reconnecting: 'warn',
  paused: 'warn',
  unavailable: 'off',
};

// A reason the build does not know reads as the 3D fallback it is, not as a crash (the copy is a closed `Record`, so
// the index is widened to be asked about a key it may not have).
const TWIN_COPY: Partial<Record<string, { title: string }>> = TWIN_UNAVAILABLE_COPY;

/**
 * `problem` is whether the engine counts against the level. A device that has no WebGL 2 is a limit, not a fault: it
 * would read "degraded" for the whole session and teach operators to ignore the bar. A lost context or a slow frame
 * is a fault.
 */
function engineSegment(
  twin: TwinCapability,
  view: ViewChoice,
): { segment: HealthSegment; problem: boolean } {
  const label = '3D';
  if (twin.available) {
    return {
      segment: { label, state: 'ok', text: view === '3d' ? '3D view' : '2D map' },
      problem: false,
    };
  }
  const text = TWIN_COPY[twin.reason]?.title ?? ENGINE_UNAVAILABLE;
  if (twin.reason === 'no-webgl2')
    return { segment: { label, state: 'off', text }, problem: false };
  return { segment: { label, state: 'warn', text }, problem: true };
}

/**
 * The health from the five facts. The summary is "System healthy", or the first problem in the order of what an
 * operator can do least without: the session, the events, the telemetry, the engine. Every segment still shows its own
 * state when there are several.
 */
export function systemHealth(input: SystemHealthInput): SystemHealth {
  const { connection, telemetry, sessionExpired, twin, view } = input;
  const events: HealthSegment = {
    label: 'Events',
    state: EVENTS_STATE[connection],
    text: CONNECTION_LABEL[connection],
  };
  const telemetrySegment: HealthSegment = {
    label: 'Telemetry',
    state: TELEMETRY_STATE[telemetry],
    text: telemetry === 'live' ? LIVE : TELEMETRY_LABEL[telemetry],
  };
  const engine = engineSegment(twin, view);

  let problem: string | undefined;
  if (sessionExpired) problem = SESSION_EXPIRED_SUMMARY;
  else if (events.state !== 'ok') problem = events.text;
  else if (telemetrySegment.state !== 'ok') problem = telemetrySegment.text;
  else if (engine.problem) problem = engine.segment.text;

  return {
    level: problem === undefined ? 'healthy' : 'degraded',
    summary: problem ?? HEALTHY_SUMMARY,
    segments: { events, telemetry: telemetrySegment, engine: engine.segment },
  };
}
