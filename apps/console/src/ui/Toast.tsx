import { type FocusEvent, useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';
import { Check, X } from './icons';
import styles from './Toast.module.css';
import { dismissToast, type Toast, TOAST_MS, useToasts } from './toasts';

/** Which control of a toast had focus, so the same one in a neighbouring toast can take it. */
type ToastControl = 'action' | 'dismiss';

/**
 * Where toasts appear (frame 04): the top right of the stage, beside the open sheet. Mounted once
 * and always present, with two stable live lists inside: urgent toasts are read out at once
 * (assertive), the others politely. A toast added to a list is read out; none of them is a live
 * region of its own that could be missed as it mounts.
 *
 * When a toast that holds focus goes, focus moves to the same control in the next toast, else in
 * the previous one, else back to where it was before it entered the region, else to
 * `fallbackFocus()` — never to the page body.
 */
export function ToastRegion({ fallbackFocus }: { fallbackFocus?: () => HTMLElement | null }) {
  const toasts = useToasts((s) => s.toasts);
  const regionRef = useRef<HTMLElement>(null);
  const focusedBefore = useRef<HTMLElement | null>(null);

  // Focus arriving from outside the region: remember where it came from.
  const onFocus = (event: FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    focusedBefore.current = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
  };

  /** Moves focus out of `toast` if it is inside, before the toast is removed. */
  const handOffFocus = (toast: HTMLElement) => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || !toast.contains(focused)) return;
    const control = focused.dataset.toastControl as ToastControl | undefined;
    const items = [...(regionRef.current?.querySelectorAll<HTMLElement>('[data-toast]') ?? [])];
    const at = items.indexOf(toast);
    const neighbour = items[at + 1] ?? items[at - 1];
    const before = focusedBefore.current?.isConnected ? focusedBefore.current : null;
    const target =
      (neighbour && controlIn(neighbour, control)) ?? before ?? fallbackFocus?.() ?? null;
    target?.focus();
  };

  const urgent = toasts.filter((toast) => toast.urgent);
  const normal = toasts.filter((toast) => !toast.urgent);

  return (
    <section ref={regionRef} className={styles.region} aria-label="Notifications" onFocus={onFocus}>
      <div className={styles.list} aria-live="assertive">
        {urgent.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onLeave={handOffFocus} />
        ))}
      </div>
      <div className={styles.list} aria-live="polite">
        {normal.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onLeave={handOffFocus} />
        ))}
      </div>
    </section>
  );
}

/** The same control in another toast, or its first button when it has no such control. */
function controlIn(toast: HTMLElement, control: ToastControl | undefined): HTMLElement | null {
  return (
    (control && toast.querySelector<HTMLElement>(`[data-toast-control="${control}"]`)) ||
    toast.querySelector<HTMLElement>('button')
  );
}

/**
 * One toast. A non-urgent one goes after `TOAST_MS`, counted again from the start once the pointer
 * leaves it and focus is out of it, so it never vanishes while being read or while one of its
 * buttons has focus. An urgent one stays until dismissed.
 *
 * With an `action`, it has frame 04's actions row (the action, then Dismiss); without, UI-12's
 * icon-only Dismiss button. The action runs after focus has left the toast, so whatever the action
 * opens records a target that still exists as the place to return focus to.
 */
function ToastItem({ toast, onLeave }: { toast: Toast; onLeave: (element: HTMLElement) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;

  useEffect(() => {
    if (paused || toast.urgent) return;
    const timer = window.setTimeout(() => dismissToast(toast.id), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [paused, toast.urgent, toast.id]);

  // Focus moving between elements inside the toast is not leaving it.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
  };

  const dismiss = () => {
    if (ref.current) onLeave(ref.current);
    dismissToast(toast.id);
  };

  const act = () => {
    if (ref.current) onLeave(ref.current);
    toast.action?.onAction();
    dismissToast(toast.id);
  };

  return (
    <div
      ref={ref}
      className={styles.toast}
      data-toast=""
      data-severity={toast.severity}
      data-actions={toast.action ? '' : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={onBlur}
    >
      <span className={styles.icon}>
        <Icon glyph={toast.icon ?? Check} size={20} />
      </span>
      <div className={styles.text}>
        {toast.kicker && <p className={styles.kicker}>{toast.kicker}</p>}
        <p className={styles.title}>{toast.title}</p>
        {toast.detail && <p className={styles.detail}>{toast.detail}</p>}
      </div>
      {toast.action ? (
        <div className={styles.actions}>
          <Button variant="primary" size="sm" data-toast-control="action" onClick={act}>
            {toast.action.label}
          </Button>
          <Button variant="ghost" size="sm" data-toast-control="dismiss" onClick={dismiss}>
            Dismiss
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          icon={X}
          aria-label="Dismiss notification"
          className={styles.dismiss}
          data-toast-control="dismiss"
          onClick={dismiss}
        />
      )}
    </div>
  );
}
