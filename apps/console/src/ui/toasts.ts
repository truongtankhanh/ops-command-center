import { create } from 'zustand';

/**
 * Short notifications drawn by `ToastRegion` (frame 04's `.toasts`). A store of its own, not part of
 * `useConsole`, so `src/ui/` holds no app state and can move to `packages/ui` (OCC-20).
 *
 * UI-12 shows only a success toast ("Reported INC-…"). UI-14 adds the severity tint, toasts that stay
 * until dismissed (critical incidents) and an action ("View").
 */

/** How long a toast stays when nobody is pointing at it or focused inside it. */
export const TOAST_MS = 6000;

/** At most this many at once; the oldest goes first, so a burst never fills the stage. */
const MAX_TOASTS = 3;

export interface Toast {
  id: number;
  title: string;
  detail?: string;
}

interface ToastState {
  toasts: readonly Toast[];
  show(toast: Omit<Toast, 'id'>): void;
  dismiss(id: number): void;
}

let lastId = 0;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  show: (toast) =>
    set((state) => ({ toasts: [...state.toasts, { ...toast, id: ++lastId }].slice(-MAX_TOASTS) })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

/** Shows a toast from anywhere, e.g. a mutation's `onSuccess`. */
export const showToast = (toast: Omit<Toast, 'id'>) => useToasts.getState().show(toast);

export const dismissToast = (id: number) => useToasts.getState().dismiss(id);
