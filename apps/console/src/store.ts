import type { IncidentSeverity } from '@occ/contracts';
import { create } from 'zustand';
import type { FeedFilter } from './lib/incidents';

/** `connecting` is the first connect only; every later attempt is `reconnecting`. */
export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';

interface ConsoleState {
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
  /** Incidents that arrived live and have not been looked at yet. */
  fresh: ReadonlySet<string>;
  /** The report form is open. Mutually exclusive with a selected incident. */
  reporting: boolean;
  /**
   * Unsent timeline notes by incident id. Kept here, not in the detail, so switching to another
   * incident or to the report form and back never loses one: only Close and a sent note clear it.
   */
  noteDrafts: Readonly<Record<string, string>>;

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
  setConnection(state: ConnectionState): void;
  markAlive(at?: number): void;
  markFresh(id: string): void;
  /** Stores the note as typed; an empty note removes the entry. */
  setNote(incidentId: string, note: string): void;
  clearNote(incidentId: string): void;
}

/** UI state only. Server data lives in the TanStack Query cache. */
export const useConsole = create<ConsoleState>((set) => ({
  selectedIncidentId: null,
  filter: 'active',
  severity: null,
  connection: 'connecting',
  lastEventAt: null,
  fresh: new Set(),
  reporting: false,
  noteDrafts: {},

  select: (id) =>
    set((state) => {
      if (id === null || !state.fresh.has(id)) return { selectedIncidentId: id, reporting: false };
      const fresh = new Set(state.fresh);
      fresh.delete(id);
      return { selectedIncidentId: id, fresh, reporting: false };
    }),
  startReport: () => set({ reporting: true, selectedIncidentId: null }),
  closeReport: () => set({ reporting: false }),
  setFilter: (filter) => set({ filter }),
  toggleSeverity: (severity) =>
    set((state) =>
      state.severity === severity ? { severity: null } : { severity, filter: 'active' },
    ),
  clearSeverity: () => set({ severity: null }),
  setConnection: (connection) => set({ connection }),
  markAlive: (at = Date.now()) => set({ lastEventAt: at }),
  markFresh: (id) => set((state) => ({ fresh: new Set(state.fresh).add(id) })),
  setNote: (incidentId, note) =>
    set((state) =>
      note === ''
        ? { noteDrafts: withoutKey(state.noteDrafts, incidentId) }
        : { noteDrafts: { ...state.noteDrafts, [incidentId]: note } },
    ),
  clearNote: (incidentId) =>
    set((state) => ({ noteDrafts: withoutKey(state.noteDrafts, incidentId) })),
}));

function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const rest = { ...record };
  delete rest[key];
  return rest;
}
