import type { IncidentSeverity, LngLat } from '@occ/contracts';
import { create } from 'zustand';
import type { ReportPreset } from './lib/assets/assetReport';
import type { AssetFilter } from './lib/assets/assets';
import { readPinnedCameras, togglePinned, writePinnedCameras } from './lib/cameras/cameras';
import { readCriticalSound, writeCriticalSound } from './lib/incidents/criticalCue';
import { type Density, readDensity, writeDensity } from './lib/density';
import type { FeedFilter } from './lib/incidents/incidents';
import { readKeyboardShortcuts, writeKeyboardShortcuts } from './lib/shortcuts';
import { type TwinFault, twinCapability } from './lib/twinCapability';
import type { SceneLayerKey, SceneLayers } from './lib/twinLayers';
import { levelOf } from './lib/twinLevel';
import { effectiveView, readViewChoice, type ViewChoice, writeViewChoice } from './lib/viewChoice';
import { wallScreen } from './lib/wall/wallMode';

/**
 * At most this many incidents are held as fresh. A row stays highlighted until it is looked at or
 * acknowledged, so on a long shift the oldest unseen ones stop being highlighted instead.
 */
export const FRESH_LIMIT = 20;

/** `connecting` is the first connect only; every later attempt is `reconnecting`. */
export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';

/** The two panels of the side column (frame 01). */
export type SidePanelTab = 'incidents' | 'assets';

/**
 * Where the incident being reported is, chosen in the report form or on the map, and what the form
 * opened with. The location is kept here, not in the form, because the map (a sibling) draws the pin
 * and outlines the zone, and places the pin. The preset (V2-09.10) is read once by the form and is
 * the baseline its draft is measured from, so it lives and dies with the location: every path that
 * ends or starts a report resets both.
 */
interface ReportLocation {
  reportZoneId: string | null;
  /** The pin, always inside `reportZoneId`; `null` lets the API use the zone's centre. */
  reportPosition: LngLat | null;
  /**
   * What the report form opened with, when it was opened from an asset: its category, type and
   * title, and the zone and pin it was placed with. `null` for a form opened from the header or `N`.
   */
  reportPreset: ReportPreset | null;
  /** "Pick on map" is on: a map click places the pin, and the pin can be dragged. */
  picking: boolean;
  /** The last click or drop was outside every zone, so the pin was not placed or moved. */
  pinMissed: boolean;
}

/** A report starts, ends and is left with no location, so a cancelled pin never reappears. */
const NO_REPORT_LOCATION: ReportLocation = {
  reportZoneId: null,
  reportPosition: null,
  reportPreset: null,
  picking: false,
  pinMissed: false,
};

/** No asset, and so no part of it: the selection a level above the asset has (V2-15.2). */
const NO_ASSET = { selectedAssetCode: null, selectedPart: null, hoveredPart: null };

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
  /** The report form is open. Mutually exclusive with a selected incident and a selected asset. */
  reporting: boolean;
  /**
   * The panel the side column shows. Both stay mounted, so switching keeps the incident feed's
   * search, selection and keyboard stop. Not remembered: the console opens on incidents.
   */
  sidePanel: SidePanelTab;
  /**
   * The asset open in the inspector, by asset **code**, or `null`. Mutually exclusive with a
   * selected incident and the report form: they share the sheet (V2-09.8).
   */
  selectedAssetCode: string | null;
  /** The asset under the pointer in the list or on the map; highlights its twin. Never opens a sheet. */
  hoveredAssetCode: string | null;
  /**
   * The building zone in focus in the 3D view (V2-15.2), or `null`. Only a `building` zone is ever set.
   * Together with the selected asset and part it gives the scene level (`levelOf`); the 2D map ignores it.
   */
  focusZoneId: string | null;
  /**
   * The part of the selected asset (a node name of its model) whose callout is open, or `null`. Only held
   * while an asset is selected: every action that clears the asset clears it.
   */
  selectedPart: string | null;
  /** The part under the pointer in the 3D view or its Parts row; highlights the other. Never selects. */
  hoveredPart: string | null;
  /** The Assets tab's filter tab. */
  assetFilter: AssetFilter;
  /** The Assets list shows this zone only (a group header sets it, V2-09.6); `null` shows every zone. */
  assetZoneId: string | null;
  /**
   * The zone the building focus wrote into `assetZoneId` (V2-15.2), or `null` when the filter is the
   * operator's. Leaving the building clears the filter only while it is still this zone, so a filter the
   * operator chose (`setAssetZone`, which drops this) is never cleared by the scene.
   */
  focusFilterZoneId: string | null;
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
  /**
   * What the map stage draws: the view that is in effect, not the one asked for. A stored `3d` is
   * `2d` here while the twin cannot be drawn (`twinCapability`), and is left as stored. Remembered
   * in this browser, as an explicit choice only (V2-10.1).
   */
  view: ViewChoice;
  /**
   * The 3D view's drag tool (V3-29): `false` is Orbit (a drag rotates, the default), `true` is Pan (a drag moves the view
   * along the ground). A choice of this session only: not remembered, not cleared by `Escape` or a change of level, which
   * climb the level ladder and never change a tool. The wall's rig takes no input, so it reads nothing from this.
   */
  panTool: boolean;
  /**
   * Why the twin stopped working in this session, or `null`. Set by the 3D stage when its WebGL
   * context is lost and does not come back (V2-12.11); `useTwinCapability` reads it, so every
   * reader of the capability follows. Not remembered: a reload tries 3D again.
   */
  twinFault: TwinFault | null;
  /**
   * The video wall screen this window is (`?wall=N`, V2-21.2), or `null` for the console people operate. Read once,
   * when the store is created, and never changed in a session: a wall is a different window, not a mode that is
   * switched. In wall mode the console mounts nothing interactive, makes no toast and plays no sound.
   */
  wall: number | null;
  /**
   * The incident the video wall's camera grid follows while the wall holds one in focus (V2-21.4), or `null`.
   * Set by `useWallFocus` (V2-21.8) when a new critical incident takes the wall's camera, and cleared when the camera
   * goes home. It is the wall's own: `selectedIncidentId` is never written on a wall, because that opens the sheet.
   * Not remembered.
   */
  wallFocusId: string | null;
  /**
   * Which layers are drawn (frame 14's "Show"). Not remembered: a console opens with all of them shown,
   * so a layer hidden for a while is never found hidden by the next person (Open question 4).
   * Selecting an incident, and a new critical one arriving, turn Incidents back on. `inside` is the 3D
   * view's (V2-15.9): off draws the building in focus opaque with its equipment hidden. It governs the
   * building level only; at asset and part level the isolated asset is drawn whatever it says (`focusOf`), so
   * selecting an asset does not turn it on and `Esc` back to the building finds it as it was left. `heat` is the
   * 3D view's heat overlay (V2-17.3): the one layer that starts **off**, because it recolours the whole campus; it
   * governs campus and building level only (the overlay is not drawn with an asset isolated), and nothing offers
   * the toggle until V2-17.4. The 2D map reads this as a `LayerVisibility` and ignores both.
   */
  layers: SceneLayers;

  /**
   * Selecting an incident (not `null`) also closes the report form and the selected asset, and
   * shows the Incidents layer: the map is about to centre on a marker that must be drawn.
   */
  select(id: string | null): void;
  /**
   * Also closes the selected asset: the report form takes the sheet. With a `preset` (a fault
   * reported from an asset) the zone and pin are set at once and the form starts from its category,
   * type and title; without one the report starts empty, whatever the last report began with.
   */
  startReport(preset?: ReportPreset): void;
  closeReport(): void;
  /** The incident the wall's camera is on, or `null` for the campus view (V2-21.8). */
  setWallFocusId(id: string | null): void;
  setFilter(filter: FeedFilter): void;
  /**
   * Selects `severity`, or clears it when it is already selected. Selecting also shows the active
   * tab and the Incidents panel, because the KPI tiles count active incidents and the list they
   * filter must be the one on screen and must match the tile.
   */
  toggleSeverity(severity: IncidentSeverity): void;
  clearSeverity(): void;
  setSidePanel(tab: SidePanelTab): void;
  /**
   * Opens `code` in the inspector, which closes the selected incident and the report form (and
   * the pin, as they do) and shows the Assets layer, and clears the selected part. `focusZoneId` is the
   * building zone the asset is in (`buildingFocusOf`), or `null` for one outside every building: it
   * becomes the building in focus, and a focus on another building ends (the asset's crumbs must not
   * name a building it is not in). It never writes the Assets filter. `null` clears the asset and its
   * part only, and keeps the building in focus: it never reopens anything.
   */
  selectAsset(code: null): void;
  selectAsset(code: string, focusZoneId: string | null): void;
  /**
   * What a click on an asset does, in the 2D map and in the 3D view (V2-15.4): the selected asset is
   * deselected (the building stays in focus), any other is selected as `selectAsset(code, focusZoneId)`.
   */
  toggleAsset(code: string, focusZoneId: string | null): void;
  hoverAsset(code: string | null): void;
  /**
   * Focuses a building (a click on it, or its crumb): the building level, so the selected asset and part
   * are cleared, and the Assets list is filtered to its zone (an explicit act, so it replaces a filter
   * the operator had). `null` is `goCampus`.
   */
  focusBuilding(zoneId: string | null): void;
  /** Opens a part's callout. Does nothing without a selected asset: a part belongs to one. */
  selectPart(node: string | null): void;
  hoverPart(node: string | null): void;
  /**
   * One step up the levels, the order Escape takes (V2-15.1): the part, then the asset, then the
   * building; nothing at campus. Leaving the building clears the Assets filter it set.
   */
  goUp(): void;
  /**
   * Back to the campus level: no part, asset or building. Keeps an open incident and an open report form,
   * as `Home` does (V2-15.1); leaves the Assets filter the operator chose.
   */
  goCampus(): void;
  setAssetFilter(filter: AssetFilter): void;
  setAssetZone(zoneId: string | null): void;
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
  /**
   * An operator's choice of view. `3d` does nothing while the twin cannot be drawn, so the store
   * never holds a view the stage cannot show and never remembers a choice it could not honour.
   */
  setView(view: ViewChoice): void;
  setPanTool(on: boolean): void;
  togglePanTool(): void;
  /**
   * The twin failed during this session: records the fault (a lost context unless told otherwise; the wall's
   * `FrameGuard` says `too-slow`) and puts the stage on the 2D map. The operator's stored choice is left as it is, so a
   * reload or a restore goes back to it.
   */
  markTwinLost(fault?: TwinFault): void;
  /**
   * The twin works again: forgets the fault and returns to the view the stored choice and the
   * device allow. Nothing calls it yet; a context that restores in time never raises the fault.
   */
  clearTwinLost(): void;
  toggleLayer(key: SceneLayerKey): void;
  /** Turns a layer on and does nothing when it is. There is no "hide": only the toggle hides. */
  showLayer(key: SceneLayerKey): void;
}

/** UI state only. Server data lives in the TanStack Query cache. */
/** Read once, here: the address still has its `?wall=N` when this module is created, and `main.tsx` keeps it for the redirect. */
const WALL = wallScreen();

export const useConsole = create<ConsoleState>((set, get) => ({
  selectedIncidentId: null,
  filter: 'active',
  severity: null,
  connection: 'connecting',
  lastEventAt: null,
  offlineSince: null,
  fresh: new Set(),
  reporting: false,
  sidePanel: 'incidents',
  selectedAssetCode: null,
  hoveredAssetCode: null,
  focusZoneId: null,
  selectedPart: null,
  hoveredPart: null,
  assetFilter: 'all',
  assetZoneId: null,
  focusFilterZoneId: null,
  noteDrafts: {},
  viewerCameraId: null,
  pinnedCameraIds: readPinnedCameras(),
  // A wall makes no sound (ADR-0020, V2-21.1): nobody can unlock audio there, and the preference stays as stored.
  criticalSound: WALL === null && readCriticalSound(),
  keyboardShortcuts: readKeyboardShortcuts(),
  shortcutHelpOpen: false,
  density: readDensity(),
  // Reads only: a choice this build cannot honour stays in storage for a build that can.
  view: effectiveView(readViewChoice(), twinCapability()),
  panTool: false,
  twinFault: null,
  wall: WALL,
  wallFocusId: null,
  layers: { incidents: true, cameras: true, assets: true, inside: true, heat: false },
  ...NO_REPORT_LOCATION,

  select: (id) =>
    set((state) => {
      const closed = { selectedIncidentId: id, reporting: false, ...NO_REPORT_LOCATION };
      // Closing the incident (`null`) is not "deselect the asset": only a new selection takes the sheet.
      const next =
        id === null
          ? closed
          : {
              ...closed,
              ...NO_ASSET,
              layers: shown(state.layers, 'incidents'),
            };
      return id === null || !state.fresh.has(id)
        ? next
        : { ...next, fresh: without(state.fresh, id) };
    }),
  startReport: (preset) =>
    set({
      reporting: true,
      selectedIncidentId: null,
      ...NO_ASSET,
      ...NO_REPORT_LOCATION,
      ...(preset
        ? { reportZoneId: preset.zoneId, reportPosition: preset.position, reportPreset: preset }
        : {}),
    }),
  closeReport: () => set({ reporting: false, ...NO_REPORT_LOCATION }),
  setWallFocusId: (wallFocusId) => set({ wallFocusId }),
  setFilter: (filter) => set({ filter }),
  toggleSeverity: (severity) =>
    set((state) =>
      state.severity === severity
        ? { severity: null }
        : { severity, filter: 'active', sidePanel: 'incidents' },
    ),
  clearSeverity: () => set({ severity: null }),
  setSidePanel: (sidePanel) => set({ sidePanel }),
  selectAsset: (code: string | null, focusZoneId: string | null = null) =>
    set((state) =>
      code === null
        ? NO_ASSET
        : {
            ...NO_ASSET,
            selectedAssetCode: code,
            selectedIncidentId: null,
            reporting: false,
            ...NO_REPORT_LOCATION,
            // The map is about to centre on a marker that must be drawn (as `select` for incidents).
            layers: shown(state.layers, 'assets'),
            ...(focusZoneId === state.focusZoneId ? {} : { ...leave(state), focusZoneId }),
          },
    ),
  toggleAsset: (code, focusZoneId) => {
    if (get().selectedAssetCode === code) get().selectAsset(null);
    else get().selectAsset(code, focusZoneId);
  },
  hoverAsset: (hoveredAssetCode) => set({ hoveredAssetCode }),
  focusBuilding: (zoneId) => {
    if (zoneId === null) {
      get().goCampus();
      return;
    }
    set((state) =>
      state.focusZoneId === zoneId &&
      state.assetZoneId === zoneId &&
      state.selectedAssetCode === null &&
      state.hoveredPart === null
        ? state
        : {
            ...NO_ASSET,
            focusZoneId: zoneId,
            // A filter that already is this zone stays whoever set it: the marker is only for what the
            // focus wrote.
            assetZoneId: zoneId,
            focusFilterZoneId: state.assetZoneId === zoneId ? state.focusFilterZoneId : zoneId,
          },
    );
  },
  selectPart: (selectedPart) =>
    set((state) => {
      if (selectedPart !== null && state.selectedAssetCode === null) return state;
      return state.selectedPart === selectedPart ? state : { selectedPart };
    }),
  hoverPart: (hoveredPart) =>
    set((state) => (state.hoveredPart === hoveredPart ? state : { hoveredPart })),
  goUp: () =>
    set((state) => {
      switch (levelOf(state)) {
        case 'part':
          return { selectedPart: null, hoveredPart: null };
        case 'asset':
          return NO_ASSET;
        case 'building':
          return leave(state);
        case 'campus':
          return state;
      }
    }),
  goCampus: () =>
    set((state) =>
      state.focusZoneId === null && state.selectedAssetCode === null && state.hoveredPart === null
        ? state
        : { ...NO_ASSET, ...leave(state) },
    ),
  setAssetFilter: (assetFilter) => set({ assetFilter }),
  // The operator's filter: whatever the scene wrote there before is theirs now.
  setAssetZone: (assetZoneId) => set({ assetZoneId, focusFilterZoneId: null }),
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
  setPanTool: (on) => set({ panTool: on }),
  togglePanTool: () => set((state) => ({ panTool: !state.panTool })),
  setView: (view) => {
    if (view === '3d' && !twinCapability(get().twinFault).available) return;
    writeViewChoice(view);
    set({ view });
  },
  markTwinLost: (fault = 'context-lost') => set({ twinFault: fault, view: '2d' }),
  clearTwinLost: () =>
    set({ twinFault: null, view: effectiveView(readViewChoice(), twinCapability()) }),
  toggleLayer: (key) =>
    set((state) => ({ layers: { ...state.layers, [key]: !state.layers[key] } })),
  showLayer: (key) =>
    set((state) => (state.layers[key] ? state : { layers: shown(state.layers, key) })),
}));

/**
 * The patch that ends the building focus: the focus goes, and so does the Assets filter, but only while
 * it still is what the focus wrote (`focusFilterZoneId`), never one the operator chose.
 */
function leave(state: Pick<ConsoleState, 'assetZoneId' | 'focusFilterZoneId'>) {
  const ownFilter =
    state.focusFilterZoneId !== null && state.assetZoneId === state.focusFilterZoneId;
  return {
    focusZoneId: null,
    focusFilterZoneId: null,
    ...(ownFilter ? { assetZoneId: null } : {}),
  };
}

/** `layers` with `key` on; the same object when it already is, so nothing re-renders for it. */
function shown(layers: SceneLayers, key: SceneLayerKey): SceneLayers {
  return layers[key] ? layers : { ...layers, [key]: true };
}

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
