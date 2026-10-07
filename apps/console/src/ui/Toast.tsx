import { type FocusEvent, useEffect, useState } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';
import { Check, X } from './icons';
import styles from './Toast.module.css';
import { dismissToast, type Toast, TOAST_MS, useToasts } from './toasts';

/**
 * Where toasts appear (frame 04): the top right of the stage, beside the open sheet. Mounted once
 * and always present, so the list inside is one stable polite live region: a toast added to it is
 * read out, and none of them is a live region of its own that could be missed as it mounts.
 */
export function ToastRegion() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <section className={styles.region} aria-label="Notifications">
      <div className={styles.list} aria-live="polite">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} />
        ))}
      </div>
    </section>
  );
}

/**
 * One toast. It goes after `TOAST_MS`, counted again from the start once the pointer leaves it and
 * focus is out of it, so it never vanishes while being read or while its Dismiss button has focus.
 */
function ToastItem({ toast }: { toast: Toast }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;

  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => dismissToast(toast.id), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [paused, toast.id]);

  // Focus moving between elements inside the toast is not leaving it.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
  };

  return (
    <div
      className={styles.toast}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={onBlur}
    >
      <span className={styles.icon}>
        <Icon glyph={Check} size={20} />
      </span>
      <div className={styles.text}>
        <p className={styles.title}>{toast.title}</p>
        {toast.detail && <p className={styles.detail}>{toast.detail}</p>}
      </div>
      <Button
        variant="ghost"
        size="sm"
        icon={X}
        aria-label="Dismiss notification"
        className={styles.dismiss}
        onClick={() => dismissToast(toast.id)}
      />
    </div>
  );
}
