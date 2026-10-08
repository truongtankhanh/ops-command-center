import type { IncidentSeverity, LngLat } from '@occ/contracts';
import { create } from 'zustand';
import { readPinnedCameras, togglePinned, writePinnedCameras } from './lib/cameras';
import { readCriticalSound, writeCriticalSound } from './lib/criticalCue';
import { type Density, readDensity, writeDensity } from './lib/density';
import type { FeedFilter } from './lib/incidents';
import { readKeyboardShortcuts, writeKeyboardShortcuts } from './lib/shortcuts';

/**
 * At most this many incidents are held as fresh. A row stays highlighted until it is looked at or
 * acknowledged, so on a long shift the oldest unseen ones stop being highlighted instead.
 */
export const FRESH_LIMIT = 20;

/** `connecting` is the first connect only; every later attempt is `reconnecting`. */
export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';

/**
 * Where the incident being reported is, chosen in the report form or on the map. Kept here, not in
 * the form, because the map (a sibling) draws the pin and outlines the zone, and places the pin.
 */
interface ReportLocation {
  reportZoneId: string | null;
  /** The pin, always inside `reportZoneId`; `null` lets the API use the zone's centre. */
  reportPosition: LngLat | null;
  /** "Pick on map" is on: a map click places the pin, and the pin can be dragged. */
  picking: boolean;
  /** The last click or drop was outside every zone, so the pin was not placed or moved. */
  pinMissed: boolean;
}

/** A report starts, ends and is left with no location, so a cancelled pin never reappears. */
const NO_REPORT_LOCATION: ReportLocation = {
  reportZoneId: null,
  reportPosition: null,
  picking: false,
  pinMissed: false,
};

interface ConsoleState extends ReportLocation {
  selectedIncidentId: string | null;
  filter: FeedFilter;
  /** Feed filter by severity, set from the header's KPI tiles; `null` shows every severity. */
  severity: IncidentSeverity | null;
  connection: ConnectionState;
  /**
   * Last sign of life from the live connection (connect, heartbeat or incident event), in epoch ms.
   * While the link is healthy its age stays under the heartbeat interval; a growing age is the warning.
   */
  lastEventAt: number | null;
  /**
   * When the live connection was lost (epoch ms), or `null` while it is up or still being made for
   * the first time. Kept through every reconnect attempt: since then, the data may be stale.
   */
  offlineSince: number | null;
  /**
   * Incidents that arrived live and have not been looked at yet, oldest first, at most
   * `FRESH_LIMIT`. One leaves when it is selected or no longer open.
   */
  fresh: ReadonlySet<string>;
  /** The report form is open. Mutually exclusive with a selected incident. */
  reporting: boolean;
  /**
   * Unsent timeline notes by incident id. Kept here, not in the detail, so switching to another
   * incident or to the report form and back never loses one: only Close and a sent note clear it.
   */
  noteDrafts: Readonly<Record<string, string>>;
  /**
   * The camera open in the viewer, or `null`. Independent of the sheet: opening the viewer over a
   * detail or a report draft leaves it as it was.
   */
  viewerCameraId: string | null;
  /** Cameras pinned to the strip, in pin order; remembered in this browser. */
  pinnedCameraIds: readonly string[];
  /** A sound plays when a critical incident arrives. Off by default; remembered in this browser. */
  criticalSound: boolean;
  /**
   * Single-key shortcuts (`N`, `/`, `A`, `R`, `?`) work. On by default; remembered in this browser.
   * Off is for speech input, which can type a shortcut by accident (WCAG 2.1.4).
   */
  keyboardShortcuts: boolean;
  /** The keyboard shortcuts help is open. */
  shortcutHelpOpen: boolean;
  /** How tightly the console is spaced. Comfortable by default; remembered in this browser. */
  density: Density;

  select(id: string | null): void;
  startReport(): void;
  closeReport(): void;
  setFilter(filter: FeedFilter): void;
  /**
   * Selects `severity`, or clears it when it is already selected. Selecting also shows the active
   * tab, because the KPI tiles count active incidents and the list must match the tile.
   */
  toggleSeverity(severity: IncidentSeverity): void;
  clearSeverity(): void;
  /** Also keeps `offlineSince`: set on the first state after a loss, cleared once `live`. */
  setConnection(state: ConnectionState, at?: number): void;
  markAlive(at?: number): void;
  /** Adds `id` to `fresh`, dropping the oldest ids beyond `FRESH_LIMIT`. */
  markFresh(id: string): void;
  forgetFresh(id: string): void;
  /** Stores the note as typed; an empty note removes the entry. */
  setNote(incidentId: string, note: string): void;
  clearNote(incidentId: string): void;
  /** Chooses the report's zone; choosing another zone removes the pin, which lay in the old one. */
  setReportZone(zoneId: string): void;
  /** Places or moves the pin, with the zone it lies in. */
  placePin(position: LngLat, zoneId: string): void;
  /** A click or drop outside every zone: the pin stays where it was. */
  missPin(): void;
  clearPin(): void;
  setPicking(picking: boolean): void;
  openViewer(cameraId: string): void;
  closeViewer(): void;
  /**
   * Pins a camera to the strip, or unpins it; does nothing when the strip is full. `knownIds` are
   * the cameras that exist now, so pins of removed cameras are dropped (`togglePinned`).
   */
  toggleCameraPin(cameraId: string, knownIds: readonly string[]): void;
  setCriticalSound(on: boolean): void;
  setKeyboardShortcuts(on: boolean): void;
  openShortcutHelp(): void;
  closeShortcutHelp(): void;
  setDensity(density: Density): void;
}

/** UI state only. Server data lives in the TanStack Query cache. */
export const useConsole = create<ConsoleState>((set, get) => ({
  selectedIncidentId: null,
  filter: 'active',
  severity: null,
  connection: 'connecting',
  lastEventAt: null,
  offlineSince: null,
  fresh: new Set(),
  reporting: false,
  noteDrafts: {},
  viewerCameraId: null,
  pinnedCameraIds: readPinnedCameras(),
  criticalSound: readCriticalSound(),
  keyboardShortcuts: readKeyboardShortcuts(),
  shortcutHelpOpen: false,
  density: readDensity(),
  ...NO_REPORT_LOCATION,

  select: (id) =>
    set((state) => {
      const closed = { selectedIncidentId: id, reporting: false, ...NO_REPORT_LOCATION };
      return id === null || !state.fresh.has(id)
        ? closed
        : { ...closed, fresh: without(state.fresh, id) };
    }),
  startReport: () => set({ reporting: true, selectedIncidentId: null, ...NO_REPORT_LOCATION }),
  closeReport: () => set({ reporting: false, ...NO_REPORT_LOCATION }),
  setFilter: (filter) => set({ filter }),
  toggleSeverity: (severity) =>
    set((state) =>
      state.severity === severity ? { severity: null } : { severity, filter: 'active' },
    ),
  clearSeverity: () => set({ severity: null }),
  setConnection: (connection, at = Date.now()) =>
    set((state) => ({
      connection,
      offlineSince: nextOfflineSince(state.offlineSince, connection, at),
    })),
  markAlive: (at = Date.now()) => set({ lastEventAt: at }),
  markFresh: (id) =>
    set((state) => {
      // A `Set` iterates in insertion order, so the first ids are the oldest.
      const fresh = [...new Set(state.fresh).add(id)];
      return { fresh: new Set(fresh.slice(-FRESH_LIMIT)) };
    }),
  forgetFresh: (id) =>
    set((state) => (state.fresh.has(id) ? { fresh: without(state.fresh, id) } : state)),
  setNote: (incidentId, note) =>
    set((state) =>
      note === ''
        ? { noteDrafts: withoutKey(state.noteDrafts, incidentId) }
        : { noteDrafts: { ...state.noteDrafts, [incidentId]: note } },
    ),
  clearNote: (incidentId) =>
    set((state) => ({ noteDrafts: withoutKey(state.noteDrafts, incidentId) })),
  setReportZone: (zoneId) =>
    set((state) =>
      state.reportZoneId === zoneId
        ? state
        : { reportZoneId: zoneId, reportPosition: null, pinMissed: false },
    ),
  placePin: (position, zoneId) =>
    set({ reportPosition: position, reportZoneId: zoneId, pinMissed: false }),
  missPin: () => set({ pinMissed: true }),
  clearPin: () => set({ reportPosition: null, pinMissed: false }),
  setPicking: (picking) => set(picking ? { picking } : { picking, pinMissed: false }),
  openViewer: (cameraId) => set({ viewerCameraId: cameraId }),
  closeViewer: () => set({ viewerCameraId: null }),
  toggleCameraPin: (cameraId, knownIds) => {
    const pinnedCameraIds = togglePinned(get().pinnedCameraIds, cameraId, knownIds);
    writePinnedCameras(pinnedCameraIds);
    set({ pinnedCameraIds });
  },
  setCriticalSound: (on) => {
    writeCriticalSound(on);
    set({ criticalSound: on });
  },
  setKeyboardShortcuts: (on) => {
    writeKeyboardShortcuts(on);
    set({ keyboardShortcuts: on });
  },
  openShortcutHelp: () => set({ shortcutHelpOpen: true }),
  closeShortcutHelp: () => set({ shortcutHelpOpen: false }),
  setDensity: (density) => {
    writeDensity(density);
    set({ density });
  },
}));

/**
 * `connecting` is the first connect only, before any data could be stale; a refused first connect
 * goes on to `offline`, which starts the clock like a dropped link does.
 */
function nextOfflineSince(
  since: number | null,
  connection: ConnectionState,
  at: number,
): number | null {
  switch (connection) {
    case 'live':
      return null;
    case 'connecting':
      return since;
    case 'reconnecting':
    case 'offline':
      return since ?? at;
  }
}

function without(ids: ReadonlySet<string>, id: string): Set<string> {
  const rest = new Set(ids);
  rest.delete(id);
  return rest;
}

function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const rest = { ...record };
  delete rest[key];
  return rest;
}
