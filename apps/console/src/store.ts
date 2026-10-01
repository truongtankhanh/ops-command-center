import { create } from 'zustand';
import type { FeedFilter } from './lib/incidents';

export type ConnectionState = 'connecting' | 'live' | 'offline';

interface ConsoleState {
  selectedIncidentId: string | null;
  filter: FeedFilter;
  connection: ConnectionState;
  /** Incidents that arrived live and have not been looked at yet. */
  fresh: ReadonlySet<string>;
  /** The report form is open. Mutually exclusive with a selected incident. */
  reporting: boolean;

  select(id: string | null): void;
  startReport(): void;
  closeReport(): void;
  setFilter(filter: FeedFilter): void;
  setConnection(state: ConnectionState): void;
  markFresh(id: string): void;
}

/** UI state only. Server data lives in the TanStack Query cache. */
export const useConsole = create<ConsoleState>((set) => ({
  selectedIncidentId: null,
  filter: 'active',
  connection: 'connecting',
  fresh: new Set(),
  reporting: false,

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
  setConnection: (connection) => set({ connection }),
  markFresh: (id) => set((state) => ({ fresh: new Set(state.fresh).add(id) })),
}));
