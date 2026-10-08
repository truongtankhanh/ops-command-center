import type { IncidentSeverity } from '@occ/contracts';
import { create } from 'zustand';
import type { Glyph } from './icons';

/**
 * Short notifications drawn by `ToastRegion` (frame 04's `.toasts`). A store of its own, not part of
 * `useConsole`, so `src/ui/` holds no app state and can move to `packages/ui` (OCC-20).
 *
 * UI-12 added the success toast ("Reported INC-…"); UI-14 the severity tint, urgent toasts that
 * stay until dismissed (critical incidents), an action ("View incident") and toasts keyed to a
 * subject.
 */

/** How long a toast stays when nobody is pointing at it or focused inside it. */
export const TOAST_MS = 6000;

/**
 * At most this many at once, so a burst never fills the stage. The oldest non-urgent toast goes
 * first; an urgent one goes only when every toast is urgent.
 */
const MAX_TOASTS = 3;

export interface Toast {
  id: number;
  /**
   * What the toast is about, e.g. an incident id. Showing a toast with the same key replaces the
   * one already shown, so one subject never has two toasts.
   */
  key?: string;
  /** A small line above the title, e.g. "New critical · Fire alarm". */
  kicker?: string;
  title: string;
  detail?: string;
  /** Tints the toast in that severity's colour (`data-severity`). */
  severity?: IncidentSeverity;
  /** The glyph in the icon tile; a check mark when omitted. */
  icon?: Glyph;
  /**
   * Needs the operator: it stays until dismissed, is read out at once (assertive), sits above the
   * other toasts, and is the last to go when there are too many.
   */
  urgent?: boolean;
  /** One action button beside Dismiss; the toast is dismissed after it runs. */
  action?: { label: string; onAction(): void };
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
    set((state) => {
      const next = { ...toast, id: ++lastId };
      const at = toast.key === undefined ? -1 : state.toasts.findIndex((t) => t.key === toast.key);
      const toasts = at === -1 ? [...state.toasts, next] : state.toasts.with(at, next);
      return { toasts: withinLimit(toasts) };
    }),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

/** Drops the oldest non-urgent toasts, then the oldest urgent ones, until `MAX_TOASTS` remain. */
function withinLimit(toasts: readonly Toast[]): readonly Toast[] {
  let kept = toasts;
  while (kept.length > MAX_TOASTS) {
    const oldestNormal = kept.findIndex((toast) => !toast.urgent);
    kept = kept.toSpliced(oldestNormal === -1 ? 0 : oldestNormal, 1);
  }
  return kept;
}

/** Shows a toast from anywhere, e.g. a mutation's `onSuccess`. */
export const showToast = (toast: Omit<Toast, 'id'>) => useToasts.getState().show(toast);

export const dismissToast = (id: number) => useToasts.getState().dismiss(id);

/** A toast about `key` is shown right now. */
export const hasToast = (key: string) => useToasts.getState().toasts.some((t) => t.key === key);
