import type { Incident, IncidentSeverity, IncidentStatus } from '@occ/contracts';

/*
 * Which incident the video wall's camera goes to, and when it comes back (V2-21.7, ADR-0020 "Settled in V2-21.1",
 * bullet "Which incident, and when it goes back"; brief principle 4: it flies to the incident, shows a countdown and
 * returns to its fixed campus view after 60 s, or once the incident is acknowledged, and never rotates when idle).
 *
 * Pure: no timer, no clock, no store, no React. The caller (V2-21.8) owns the time and says what it is: every function
 * takes `now` in milliseconds, from any clock that does not go backwards (`performance.now()`), and the machine never
 * reads one itself. That keeps every case below testable with injected numbers.
 */

/** How long the wall holds an incident before it returns to the campus view. */
export const WALL_HOLD_MS = 60_000;

/**
 * The wall is on the campus view, or holds one incident. `version` is the version of the incident as the machine last
 * saw it: an update that does not carry a higher one is a copy it already has (REST and live events arrive out of
 * order, `Incident.version`), and `since` is when the hold began, on the caller's clock.
 */
export type WallFocusState =
  { phase: 'campus' } | { phase: 'focus'; incidentId: string; version: number; since: number };

/** The state of a wall that has never been asked to fly. */
export const WALL_CAMPUS: WallFocusState = { phase: 'campus' };

/** What happened to the incidents, in the machine's words. `tick` is the passing of time and carries none. */
export type WallFocusEvent =
  | {
      type: 'incident-created';
      id: string;
      severity: IncidentSeverity;
      status: IncidentStatus;
      version: number;
    }
  | { type: 'incident-updated'; id: string; status: IncidentStatus; version: number }
  | { type: 'incident-removed'; id: string }
  | { type: 'tick' };

/**
 * The state after `event` at `now`. The same object comes back when nothing changed, so a caller that keeps it in React
 * state does not render for an event that meant nothing.
 *
 * - **A new `critical` takes the focus**, and a newer one replaces it and restarts the 60 s. Only a new one does: an
 *   incident already open when the wall ends a hold is not flown to, and a creation that arrives already acknowledged or
 *   resolved (a refetch after the link was down) is not an emergency. Any other severity is ignored.
 * - **Acknowledged, resolved or removed ends the hold** of the incident held. The same events for any other incident
 *   change nothing, and neither does an update that leaves it open (a change of title or zone).
 * - **An update that does not carry a higher `version` than the one the machine has is ignored** (a duplicate, or a copy
 *   that was read before a live event), so it can neither end a hold nor keep one alive.
 * - **`tick` ends the hold at exactly 60 s** (`>=`). If the clock reads earlier than the hold began (it was reset, or
 *   the caller switched clocks), the hold starts again from `now` rather than lasting until time catches up, or ending
 *   at once on a one-second correction.
 */
export function next(state: WallFocusState, event: WallFocusEvent, now: number): WallFocusState {
  switch (event.type) {
    case 'incident-created': {
      if (event.severity !== 'critical' || event.status !== 'open') return state;
      // A creation seen again (a replay of the same list) is the copy the machine has.
      if (
        state.phase === 'focus' &&
        state.incidentId === event.id &&
        event.version <= state.version
      ) {
        return state;
      }
      return { phase: 'focus', incidentId: event.id, version: event.version, since: now };
    }
    case 'incident-updated': {
      if (state.phase !== 'focus' || state.incidentId !== event.id) return state;
      if (event.version <= state.version) return state;
      if (event.status !== 'open') return WALL_CAMPUS;
      return { ...state, version: event.version };
    }
    case 'incident-removed':
      return state.phase === 'focus' && state.incidentId === event.id ? WALL_CAMPUS : state;
    case 'tick': {
      if (state.phase !== 'focus') return state;
      if (now < state.since) return { ...state, since: now };
      return now - state.since >= WALL_HOLD_MS ? WALL_CAMPUS : state;
    }
  }
}

/**
 * The whole seconds the banner shows: the hold's time left, rounded up so it reads 60 when the hold begins and 1 until
 * the instant it ends, and never outside 0 – 60 whatever the clock does. 0 on the campus view.
 */
export function secondsLeft(state: WallFocusState, now: number): number {
  if (state.phase !== 'focus') return 0;
  const elapsed = Math.max(0, now - state.since);
  const left = Math.ceil((WALL_HOLD_MS - elapsed) / 1000);
  return Math.min(WALL_HOLD_MS / 1000, Math.max(0, left));
}

/**
 * The events between two reads of the incident list the cache holds, which is where the wall gets its input (V2-21.7).
 * Not `useLiveIncidents`: that hook makes the toast and the sound, which a wall must not, and it sees only the live
 * events, while the cache is also what a refetch after a lost link writes, through the same version rule
 * (`upsertIncident`, `mergeIncidentLists`). So a change the wall missed arrives as a difference between two lists.
 *
 * - **The first list is a baseline, not news** (`previous` is `undefined`): an incident that was already open when the
 *   wall started is not flown to.
 * - **Order:** removed, updated, then created, and the created ones oldest first by `reportedAt` (then `id`), so that when
 *   several critical incidents arrive in one read the newest is the one the machine ends on, and an acknowledgement of
 *   the incident held in the same read comes before the new one takes over.
 * - An incident whose `version` did not go up produces nothing.
 */
export function wallFocusEvents(
  previous: readonly Incident[] | undefined,
  current: readonly Incident[],
): WallFocusEvent[] {
  if (previous === undefined) return [];
  const before = new Map(previous.map((incident) => [incident.id, incident]));
  const ids = new Set(current.map((incident) => incident.id));

  const removed: WallFocusEvent[] = previous
    .filter((incident) => !ids.has(incident.id))
    .map(({ id }) => ({ type: 'incident-removed', id }));
  const updated: WallFocusEvent[] = [];
  const created: Incident[] = [];
  for (const incident of current) {
    const old = before.get(incident.id);
    if (old === undefined) created.push(incident);
    else if (incident.version > old.version) {
      updated.push({
        type: 'incident-updated',
        id: incident.id,
        status: incident.status,
        version: incident.version,
      });
    }
  }
  created.sort((a, b) => a.reportedAt.localeCompare(b.reportedAt) || a.id.localeCompare(b.id));
  return [
    ...removed,
    ...updated,
    ...created.map(({ id, severity, status, version }): WallFocusEvent => ({
      type: 'incident-created',
      id,
      severity,
      status,
      version,
    })),
  ];
}
