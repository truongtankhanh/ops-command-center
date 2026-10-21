import type { Incident } from '@occ/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIncidents } from '../../api/queries';
import { twinCommands } from '../../lib/twinCommands';
import {
  next,
  secondsLeft,
  WALL_CAMPUS,
  type WallFocusState,
  wallFocusEvents,
} from '../../lib/wallFocus';
import { useConsole } from '../../store';

/** The countdown's step, and the clock the hold is checked on: one tick a second, and only while a focus is held. */
const TICK_MS = 1000;

export interface WallFocus {
  /** The incident the camera is on, or `null` on the campus view. */
  incidentId: string | null;
  /** Whole seconds until the camera goes home: 60 when the hold begins, 0 on the campus view. */
  secondsLeft: number;
  /** True once the camera has been to an incident and is back on the campus view; false before the first flight. */
  returned: boolean;
}

/**
 * What moves the video wall's camera (V2-21.8, ADR-0020 "Settled in V2-21.1"): it feeds the difference between two
 * reads of the incident list into the pure rules (`lib/wallFocus.ts`), runs the clock, and turns the result into the
 * camera's commands and the store's `wallFocusId`.
 *
 * - **The clock** is `performance.now()`, which does not go backwards, and the rules never read one. One interval of a
 *   second runs **only while a focus is held**: an idle wall has no timer at all.
 * - **Entering a focus** flies to the incident's beacon (`twinCommands.flyToIncident`), a second critical flies to its
 *   own, and **leaving** one goes home. The rig is locked, which stops people and not commands. A flight asked for before
 *   the beacon reached the canvas waits for it (`Rig`).
 * - **`selectedIncidentId` is never written**: that opens the detail sheet. The wall's own `wallFocusId` is what the
 *   beacon's ring, the camera grid, the list's row and the telemetry watch follow.
 * - A critical that was created while the link was down and is read after it is flown to as if it were new, however old:
 *   it is still open and still unacknowledged, so the wall showing it is not wrong.
 *
 * Mounted by `WallApp` only. Outside wall mode (`wall === null`) it reads nothing, sets nothing and sends no command, so
 * the console, whose camera only a person moves, cannot be moved by it.
 */
export function useWallFocus(): WallFocus {
  const wall = useConsole((s) => s.wall);
  const setWallFocusId = useConsole((s) => s.setWallFocusId);
  const { data: incidents } = useIncidents();

  const [focus, setFocus] = useState<WallFocusState>(WALL_CAMPUS);
  const [now, setNow] = useState(() => performance.now());
  const [flown, setFlown] = useState(false);
  // The state as the last event left it, for the code that folds several events in one read.
  const current = useRef<WallFocusState>(WALL_CAMPUS);
  const previous = useRef<readonly Incident[] | undefined>(undefined);

  const apply = useCallback((state: WallFocusState, at: number) => {
    setNow(at);
    if (state === current.current) return;
    current.current = state;
    setFocus(state);
    if (state.phase === 'focus') setFlown(true);
  }, []);

  useEffect(() => {
    if (wall === null || incidents === undefined) return;
    const events = wallFocusEvents(previous.current, incidents);
    previous.current = incidents;
    if (events.length === 0) return;
    const at = performance.now();
    apply(
      events.reduce((state, event) => next(state, event, at), current.current),
      at,
    );
  }, [incidents, wall, apply]);

  const holding = focus.phase === 'focus';
  useEffect(() => {
    if (wall === null || !holding) return;
    const timer = setInterval(() => {
      const at = performance.now();
      apply(next(current.current, { type: 'tick' }, at), at);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [wall, holding, apply]);

  const incidentId = focus.phase === 'focus' ? focus.incidentId : null;
  const flying = useRef(false);
  useEffect(() => {
    if (wall === null) return;
    setWallFocusId(incidentId);
    if (incidentId !== null) {
      flying.current = true;
      twinCommands.flyToIncident(incidentId);
    } else if (flying.current) {
      flying.current = false;
      twinCommands.home();
    }
  }, [wall, incidentId, setWallFocusId]);
  useEffect(() => () => useConsole.getState().setWallFocusId(null), []);

  return {
    incidentId,
    secondsLeft: secondsLeft(focus, now),
    returned: flown && incidentId === null,
  };
}
